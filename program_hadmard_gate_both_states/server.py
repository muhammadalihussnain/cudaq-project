#!/usr/bin/env python3
"""
CUDA-Q Circuit Lab — API + Static File Server
=============================================
Serves the frontend on GET /  and handles POST /api/run to run circuits
on a real CUDA-Q backend (qpp-cpu or nvidia GPU).

Usage:
    conda activate cudaq-env
    python3 server.py [port]          # default port 8082

POST /api/run  — request body (JSON):
    {
      "qubits":  3,
      "shots":   1000,
      "backend": "nvidia",            # or "qpp-cpu"
      "states":  ["0","0","0"],       # per-qubit initial state
      "gates":   [
        {"gate":"H","column":0,"target":0,"control":-1,"angle":0},
        ...
      ]
    }

Response (JSON):
    {
      "backend":    "nvidia",
      "elapsed_ms": 24.16,
      "confirmed":  true,
      "ran_on_gpu": false,
      "proof":      { ... },
      "counts":     {"00":512,"11":488},
      "stats":      { ... }
    }

State encoding:
    "0"  → |0⟩ (default)
    "1"  → |1⟩  (X applied)
    "+"  → |+⟩  (H applied)
    "-"  → |−⟩  (X then H)
"""

import http.server
import json
import logging
import os
import sys
import time
import traceback
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

# ─────────────────────────────────────────────────────────────────────────────
# Logging — replaces bare print() calls so severity is visible
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    format='[%(levelname)s] %(message)s',
    level=logging.INFO,
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
MIN_QUBITS = 1
MAX_QUBITS = 29
MIN_SHOTS  = 1
MAX_SHOTS  = 100_000

# ─────────────────────────────────────────────────────────────────────────────
# Optional resource-monitoring libraries (Null-Object pattern)
# ─────────────────────────────────────────────────────────────────────────────
try:
    import psutil as _psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    log.warning('psutil not found — CPU stats disabled. pip install psutil')

try:
    import warnings as _warnings
    with _warnings.catch_warnings():
        _warnings.simplefilter('ignore')
        import pynvml as _pynvml
    _pynvml.nvmlInit()
    NVML_AVAILABLE = True
except Exception:
    NVML_AVAILABLE = False
    log.warning('pynvml not found or NVIDIA driver unavailable — GPU stats disabled.')

# ─────────────────────────────────────────────────────────────────────────────
# Frontend directory
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(SCRIPT_DIR, 'frontend')

# ─────────────────────────────────────────────────────────────────────────────
# CUDA-Q availability guard
# ─────────────────────────────────────────────────────────────────────────────
try:
    import cudaq as _cudaq_module
    CUDAQ_AVAILABLE = True
except ImportError:
    CUDAQ_AVAILABLE = False
    log.warning('cudaq not found — all /api/run calls will return 501.')


# ═════════════════════════════════════════════════════════════════════════════
# DATA CLASSES  (typed payload — replaces raw dict access everywhere)
# ═════════════════════════════════════════════════════════════════════════════

@dataclass
class GateSpec:
    """One gate from the frontend circuit editor."""
    gate:    str
    column:  int   = 0
    target:  int   = 0
    control: int   = -1
    angle:   float = 0.0

    @classmethod
    def from_dict(cls, d: dict) -> 'GateSpec':
        return cls(
            gate    = str(d.get('gate', '')).upper().strip(),
            column  = int(d.get('column',  0)),
            target  = int(d.get('target',  0)),
            control = int(d.get('control', -1)),
            angle   = float(d.get('angle', 0.0)),
        )


@dataclass
class CircuitRequest:
    """Validated, typed representation of a POST /api/run payload."""
    qubit_count: int
    shots:       int
    backend:     str
    states:      list[str]
    gates:       list[GateSpec]

    @classmethod
    def from_payload(cls, payload: dict) -> 'CircuitRequest':
        """Parse and validate the raw JSON payload.

        Raises:
            KeyError:   if a required field is missing.
            ValueError: if any value is out of the allowed range.
        """
        if 'qubits' not in payload:
            raise KeyError("Request body must include 'qubits'")

        qubit_count = int(payload['qubits'])
        shots       = int(payload.get('shots', 1000))
        backend     = str(payload.get('backend', 'qpp-cpu')).strip()
        states      = list(payload.get('states', ['0'] * qubit_count))
        raw_gates   = list(payload.get('gates',  []))

        # ── Range checks ──────────────────────────────────────────────────
        if not (MIN_QUBITS <= qubit_count <= MAX_QUBITS):
            raise ValueError(
                f'qubit_count must be {MIN_QUBITS}–{MAX_QUBITS}, got {qubit_count}')
        if not (MIN_SHOTS <= shots <= MAX_SHOTS):
            raise ValueError(
                f'shots must be {MIN_SHOTS}–{MAX_SHOTS}, got {shots}')
        if len(states) != qubit_count:
            raise ValueError(
                f'states length ({len(states)}) must equal qubit_count ({qubit_count})')

        gates = [GateSpec.from_dict(g) for g in raw_gates]

        # ── Gate bounds checks ────────────────────────────────────────────
        two_qubit = {'CNOT', 'CZ', 'SWAP', 'CCX'}
        for gs in gates:
            if not (0 <= gs.target < qubit_count):
                raise ValueError(
                    f'Gate "{gs.gate}" target={gs.target} out of range '
                    f'[0, {qubit_count - 1}]')
            if gs.gate in two_qubit and not (0 <= gs.control < qubit_count):
                raise ValueError(
                    f'Gate "{gs.gate}" control={gs.control} out of range '
                    f'[0, {qubit_count - 1}]')
            if gs.gate in two_qubit and gs.control == gs.target:
                raise ValueError(
                    f'Gate "{gs.gate}" control and target must be different qubits')

        return cls(
            qubit_count = qubit_count,
            shots       = shots,
            backend     = backend,
            states      = states,
            gates       = gates,
        )


# ═════════════════════════════════════════════════════════════════════════════
# KERNEL CONSTRUCTION  (Single Responsibility — build only, no I/O)
# ═════════════════════════════════════════════════════════════════════════════

def _apply_initial_states(kernel, qubits, states: list[str]) -> None:
    """Prepare per-qubit initial states before the gate circuit."""
    for idx, st in enumerate(states):
        if st == '1':
            kernel.x(qubits[idx])
        elif st == '+':
            kernel.h(qubits[idx])
        elif st == '-':
            kernel.x(qubits[idx])
            kernel.h(qubits[idx])
        elif st == '0':
            pass  # |0⟩ is the default — no-op
        else:
            raise ValueError(
                f'Unknown initial state "{st}" for qubit {idx}. '
                'Valid values: "0", "1", "+", "-"')


def _apply_gates(kernel, qubits, gates: list[GateSpec]) -> None:
    """Apply circuit gates in column order using a dispatch table."""
    import cudaq  # local import keeps module-level guard working

    # ── Single-qubit gate dispatch table (Strategy pattern) ──────────────
    single_qubit_dispatch = {
        'X': lambda q: kernel.x(q),
        'Y': lambda q: kernel.y(q),
        'Z': lambda q: kernel.z(q),
        'H': lambda q: kernel.h(q),
        'S': lambda q: kernel.s(q),
        'T': lambda q: kernel.t(q),
    }

    sorted_gates = sorted(gates, key=lambda g: g.column)

    for gs in sorted_gates:
        name = gs.gate

        if name in ('I', 'MEASURE'):
            continue  # identity / visual annotation — no-op

        # Single-qubit gates
        if name in single_qubit_dispatch:
            single_qubit_dispatch[name](qubits[gs.target])
            continue

        # Rotation gates
        if name == 'RX':
            kernel.rx(gs.angle, qubits[gs.target]); continue
        if name == 'RY':
            kernel.ry(gs.angle, qubits[gs.target]); continue
        if name == 'RZ':
            kernel.rz(gs.angle, qubits[gs.target]); continue

        # Two-qubit gates
        if name == 'CNOT':
            kernel.cx(qubits[gs.control], qubits[gs.target]); continue
        if name == 'CZ':
            kernel.cz(qubits[gs.control], qubits[gs.target]); continue
        if name == 'SWAP':
            kernel.swap(qubits[gs.control], qubits[gs.target]); continue

        # Toffoli (CCX) — decomposed into standard gates
        if name == 'CCX':
            ctrl2 = int(gs.angle)  # frontend packs control2 into angle field
            c1, c2, tq = qubits[gs.control], qubits[ctrl2], qubits[gs.target]
            kernel.h(tq)
            kernel.cx(c2, tq);  kernel.tdg(tq)
            kernel.cx(c1, tq);  kernel.t(tq)
            kernel.cx(c2, tq);  kernel.tdg(tq)
            kernel.cx(c1, tq)
            kernel.t(c2);  kernel.t(tq);  kernel.h(tq)
            kernel.cx(c1, c2);  kernel.t(c1);  kernel.tdg(c2)
            kernel.cx(c1, c2)
            continue

        raise ValueError(f'Unsupported gate: "{name}"')


def build_kernel(req: CircuitRequest):
    """Construct and return a CUDA-Q kernel from a CircuitRequest.

    This function is pure — it has no side effects beyond allocating the
    kernel object.  It does not set the target or run anything.
    """
    import cudaq

    kernel = cudaq.make_kernel()
    qubits = kernel.qalloc(req.qubit_count)

    _apply_initial_states(kernel, qubits, req.states)
    _apply_gates(kernel, qubits, req.gates)

    kernel.mz(qubits)  # measure all qubits at the end
    return kernel


# ═════════════════════════════════════════════════════════════════════════════
# VRAM SAMPLING  (isolated helper — replaces inline try/except in build_and_run)
# ═════════════════════════════════════════════════════════════════════════════

def _sample_vram_mb() -> Optional[float]:
    """Return current VRAM usage in MB, or None if unavailable."""
    if not NVML_AVAILABLE:
        return None
    try:
        handle = _pynvml.nvmlDeviceGetHandleByIndex(0)
        mem    = _pynvml.nvmlDeviceGetMemoryInfo(handle)
        return round(mem.used / 1024 / 1024, 1)
    except Exception as exc:
        log.debug('VRAM sampling failed: %s', exc)
        return None


# ═════════════════════════════════════════════════════════════════════════════
# CIRCUIT EXECUTION  (separated from kernel construction)
# ═════════════════════════════════════════════════════════════════════════════

def run_circuit(req: CircuitRequest) -> dict:
    """Set the CUDAQ target, build the kernel, run it, and return raw results.

    Returns a dict with keys: counts, elapsed_ms, active_target, vram_before_mb,
    vram_after_mb.
    """
    import cudaq

    cudaq.set_target(req.backend)

    active_target = cudaq.get_target()
    if active_target.name != req.backend:
        raise RuntimeError(
            f'Target mismatch: requested "{req.backend}" but '
            f'active target is "{active_target.name}". '
            'Check that the backend is installed.')

    kernel = build_kernel(req)

    is_gpu = req.backend.startswith('nvidia')
    vram_before = _sample_vram_mb() if is_gpu else None

    t0     = time.perf_counter()
    result = cudaq.sample(kernel, shots_count=req.shots)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    vram_after = _sample_vram_mb() if is_gpu else None

    counts: dict[str, int] = {
        bitstring: result.count(bitstring)
        for bitstring in result
    }

    return {
        'counts':        counts,
        'elapsed_ms':    round(elapsed_ms, 3),
        'active_target': active_target,
        'vram_before_mb': vram_before,
        'vram_after_mb':  vram_after,
    }


# ═════════════════════════════════════════════════════════════════════════════
# PROOF BUILDER  (audit record — separated from execution logic)
# ═════════════════════════════════════════════════════════════════════════════

def build_proof(req: CircuitRequest, run_result: dict) -> dict:
    """Assemble a verifiable proof record from request + execution result."""
    active_target = run_result['active_target']
    vram_before   = run_result['vram_before_mb']
    vram_after    = run_result['vram_after_mb']

    vram_delta = (
        round(vram_after - vram_before, 1)
        if vram_before is not None and vram_after is not None
        else None
    )

    return {
        'requested_backend': req.backend,
        'active_target':     active_target.name,
        'simulator_name':    active_target.simulator,
        'ran_on_gpu':        req.backend.startswith('nvidia'),
        'target_confirmed':  active_target.name == req.backend,
        'vram_delta_mb':     vram_delta,
        'elapsed_ms':        run_result['elapsed_ms'],
    }


# ═════════════════════════════════════════════════════════════════════════════
# RESOURCE STATS  (unchanged logic, named exceptions instead of bare except)
# ═════════════════════════════════════════════════════════════════════════════

def get_resource_stats() -> dict:
    """Return CPU and GPU resource usage as a flat dict.

    All fields default to None when the corresponding library is unavailable
    or a query fails, so callers never receive a partial/missing dict.
    """
    stats: dict = {
        'cpu_used_mb':  None,
        'cpu_total_mb': None,
        'cpu_ram_pct':  None,
        'cpu_core_pct': None,
        'cpu_cores':    None,
        'gpu_used_mb':  None,
        'gpu_total_mb': None,
        'gpu_name':     None,
        'gpu_util_pct': None,
        'gpu_temp_c':   None,
    }

    # ── CPU / RAM ─────────────────────────────────────────────────────────
    if PSUTIL_AVAILABLE:
        try:
            proc = _psutil.Process(os.getpid())
            vm   = _psutil.virtual_memory()
            stats['cpu_used_mb']  = round(proc.memory_info().rss / 1024 / 1024, 1)
            stats['cpu_total_mb'] = round(vm.total / 1024 / 1024, 1)
            stats['cpu_ram_pct']  = round(vm.percent, 1)
            stats['cpu_core_pct'] = round(_psutil.cpu_percent(interval=None), 1)
            stats['cpu_cores']    = _psutil.cpu_count(logical=True)
        except _psutil.Error as exc:
            log.debug('psutil query failed: %s', exc)

    # ── GPU / VRAM ────────────────────────────────────────────────────────
    if NVML_AVAILABLE:
        try:
            handle   = _pynvml.nvmlDeviceGetHandleByIndex(0)
            mem_info = _pynvml.nvmlDeviceGetMemoryInfo(handle)
            name_raw = _pynvml.nvmlDeviceGetName(handle)
            gpu_name = name_raw.decode() if isinstance(name_raw, bytes) else str(name_raw)

            stats['gpu_total_mb'] = round(mem_info.total / 1024 / 1024, 1)
            stats['gpu_used_mb']  = round(mem_info.used  / 1024 / 1024, 1)
            stats['gpu_name']     = gpu_name

            try:
                util = _pynvml.nvmlDeviceGetUtilizationRates(handle)
                stats['gpu_util_pct'] = util.gpu
            except _pynvml.NVMLError as exc:
                log.debug('GPU utilisation query failed: %s', exc)

            try:
                stats['gpu_temp_c'] = _pynvml.nvmlDeviceGetTemperature(
                    handle, _pynvml.NVML_TEMPERATURE_GPU)
            except _pynvml.NVMLError as exc:
                log.debug('GPU temperature query failed: %s', exc)

        except _pynvml.NVMLError as exc:
            log.debug('NVML device query failed: %s', exc)

    return stats


# ═════════════════════════════════════════════════════════════════════════════
# TOP-LEVEL ORCHESTRATOR  (thin — delegates to the functions above)
# ═════════════════════════════════════════════════════════════════════════════

def build_and_run(payload: dict) -> dict:
    """Parse the request, run the circuit, and assemble the full response.

    This is the only public entry point called by the HTTP handler.
    It delegates all real work to focused, single-responsibility functions.
    """
    req        = CircuitRequest.from_payload(payload)
    run_result = run_circuit(req)
    proof      = build_proof(req, run_result)
    stats      = get_resource_stats()

    # Embed VRAM delta into stats so the frontend sees a single stats block
    stats['vram_before_mb'] = run_result['vram_before_mb']
    stats['vram_after_mb']  = run_result['vram_after_mb']
    stats['vram_delta_mb']  = proof['vram_delta_mb']

    return {
        'backend':    req.backend,
        'elapsed_ms': run_result['elapsed_ms'],
        'confirmed':  True,
        'ran_on_gpu': proof['ran_on_gpu'],
        'proof':      proof,
        'counts':     run_result['counts'],
        'stats':      stats,
    }


# ═════════════════════════════════════════════════════════════════════════════
# HTTP REQUEST HANDLER
# ═════════════════════════════════════════════════════════════════════════════

class CudaQHandler(http.server.SimpleHTTPRequestHandler):
    """Serves frontend static files AND handles /api/run POST requests."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    # ── Suppress noisy access log; keep errors visible ────────────────────
    def log_message(self, fmt, *args):
        code = args[1] if len(args) > 1 else '???'
        try:
            code_int = int(code)
        except (ValueError, TypeError):
            code_int = 0

        if code_int >= 400:
            super().log_message(fmt, *args)
        else:
            print(f'  {code}  {self.command} {self.path}')

    def do_OPTIONS(self):
        """Handle CORS pre-flight."""
        self.send_response(200)
        self._add_cors_headers()
        self.end_headers()

    def do_GET(self):
        """Serve /api/stats as JSON; serve static files for everything else."""
        if urlparse(self.path).path == '/api/stats':
            self._json_response(200, get_resource_stats())
            return
        super().do_GET()

    def end_headers(self):
        """Inject no-cache headers so browsers always fetch the latest JS/CSS."""
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma',  'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if urlparse(self.path).path != '/api/run':
            self.send_error(404, 'Not found')
            return

        # ── Read body ─────────────────────────────────────────────────────
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            self._json_response(400, {'error': f'Invalid JSON: {exc}'})
            return

        if not CUDAQ_AVAILABLE:
            self._json_response(501, {
                'error': 'cudaq not installed in this Python environment'})
            return

        # ── Run circuit ───────────────────────────────────────────────────
        try:
            result = build_and_run(payload)
            self._json_response(200, result)

        except (KeyError, ValueError) as exc:
            # Bad request — client sent invalid data
            self._json_response(400, {'error': str(exc)})

        except RuntimeError as exc:
            # Backend / target mismatch or CUDAQ runtime error
            log.error('Circuit runtime error: %s', exc)
            self._json_response(500, {'error': str(exc)})

        except Exception as exc:
            # Unexpected server error — log full traceback for debugging
            log.error('Unexpected error running circuit:\n%s', traceback.format_exc())
            self._json_response(500, {'error': str(exc)})

    # ── Helpers ───────────────────────────────────────────────────────────
    def _add_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json_response(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type',   'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._add_cors_headers()
        self.end_headers()
        self.wfile.write(body)


# ═════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═════════════════════════════════════════════════════════════════════════════

def find_free_port(preferred: int) -> int:
    """Return the first free port at or above `preferred`."""
    import socket
    for port in range(preferred, preferred + 20):
        with socket.socket() as s:
            s.settimeout(0.1)
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return preferred


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
    port = find_free_port(port)

    # Prime psutil CPU % — first call always returns 0.0
    if PSUTIL_AVAILABLE:
        try:
            _psutil.cpu_percent(interval=None)
        except _psutil.Error:
            pass

    import socket
    try:
        lan_ip = socket.gethostbyname(socket.gethostname())
    except OSError:
        lan_ip = '127.0.0.1'

    print()
    print('  ┌─────────────────────────────────────────────────────┐')
    print( '  │  CUDA-Q Circuit Lab                                 │')
    print(f'  │  Local:   http://127.0.0.1:{port}                     │')
    print(f'  │  Network: http://{lan_ip}:{port}                  │')
    print(f'  │  CUDAQ:   {"Available ✓" if CUDAQ_AVAILABLE else "NOT installed ✗"}                             │')
    print(f'  │  Stats:   CPU {"✓" if PSUTIL_AVAILABLE else "✗ (pip install psutil)"}  '
          f'GPU {"✓" if NVML_AVAILABLE else "✗ (pip install pynvml)"}                    │')
    print('  └─────────────────────────────────────────────────────┘')
    print()

    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), CudaQHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[server] Stopped.')


if __name__ == '__main__':
    main()
