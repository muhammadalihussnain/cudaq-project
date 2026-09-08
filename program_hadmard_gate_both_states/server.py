#!/usr/bin/env python3
"""
CUDA-Q Circuit Lab — API + Static File Server
=============================================
Serves the frontend on GET /  and handles POST /api/run to run circuits
on a real CUDA-Q backend (qpp-cpu or nvidia GPU).

Usage:
    conda activate cudaq-env
    python3 server.py [port]          # default port 8082

The server responds to POST /api/run with JSON body:
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

Response:
    {
      "backend":    "nvidia",
      "elapsed_ms": 24.16,
      "confirmed":  true,             # always true when this server responds
      "counts":     {"00":512,"11":488}
    }

State encoding:
    "0"  → |0⟩ (default)
    "1"  → |1⟩  (X applied)
    "+"  → |+⟩  (H applied)
    "-"  → |−⟩  (X then H)
"""

import http.server
import json
import os
import sys
import time
import traceback
from urllib.parse import urlparse

# ── Locate the frontend directory relative to this file ──────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(SCRIPT_DIR, 'frontend')

# ── Import CUDA-Q (warn gracefully if not available) ─────────────────────────
try:
    import cudaq as _cudaq_module
    CUDAQ_AVAILABLE = True
except ImportError:
    CUDAQ_AVAILABLE = False
    print('[server] WARNING: cudaq not found — all runs will return 501')


# ═════════════════════════════════════════════════════════════════════════════
# CIRCUIT BUILDER
# ═════════════════════════════════════════════════════════════════════════════

def build_and_run(payload: dict) -> dict:
    """
    Build a CUDA-Q kernel from the JSON payload, run it on the requested
    backend, and return a result dict.
    """
    import cudaq  # local import so the module-level guard works

    qubit_count: int       = int(payload['qubits'])
    shots:       int       = int(payload.get('shots', 1000))
    backend:     str       = payload.get('backend', 'qpp-cpu').strip()
    states:      list[str] = payload.get('states', ['0'] * qubit_count)
    gates:       list[dict]= payload.get('gates', [])

    if qubit_count < 1 or qubit_count > 29:
        raise ValueError(f'qubit_count must be 1–29, got {qubit_count}')
    if shots < 1 or shots > 100_000:
        raise ValueError(f'shots must be 1–100 000, got {shots}')

    # ── Set target ────────────────────────────────────────────────────────────
    cudaq.set_target(backend)

    # ── Build kernel with make_kernel() builder API ───────────────────────────
    # (does NOT require inspect / source files — works from any context)
    kernel = cudaq.make_kernel()
    qubits = kernel.qalloc(qubit_count)

    # Apply initial states
    for idx in range(qubit_count):
        st = states[idx] if idx < len(states) else '0'
        if st == '1':
            kernel.x(qubits[idx])
        elif st == '+':
            kernel.h(qubits[idx])
        elif st == '-':
            kernel.x(qubits[idx])
            kernel.h(qubits[idx])
        # '0' needs nothing

    # Sort gates by column so they execute in circuit order
    sorted_gates = sorted(gates, key=lambda g: int(g.get('column', 0)))

    for g in sorted_gates:
        name   = str(g.get('gate', '')).upper()
        tgt    = int(g.get('target', 0))
        ctrl   = int(g.get('control', -1))
        angle  = float(g.get('angle', 0.0))

        if name == 'I':
            pass  # identity — no-op
        elif name == 'MEASURE':
            pass  # visual annotation — mz() is always appended at the end
        elif name == 'X':
            kernel.x(qubits[tgt])
        elif name == 'Y':
            kernel.y(qubits[tgt])
        elif name == 'Z':
            kernel.z(qubits[tgt])
        elif name == 'H':
            kernel.h(qubits[tgt])
        elif name == 'S':
            kernel.s(qubits[tgt])
        elif name == 'T':
            kernel.t(qubits[tgt])
        elif name == 'RX':
            kernel.rx(angle, qubits[tgt])
        elif name == 'RY':
            kernel.ry(angle, qubits[tgt])
        elif name == 'RZ':
            kernel.rz(angle, qubits[tgt])
        elif name == 'CNOT':
            if ctrl < 0:
                raise ValueError('CNOT requires a control qubit')
            kernel.cx(qubits[ctrl], qubits[tgt])
        elif name == 'CZ':
            if ctrl < 0:
                raise ValueError('CZ requires a control qubit')
            kernel.cz(qubits[ctrl], qubits[tgt])
        elif name == 'SWAP':
            if ctrl < 0:
                raise ValueError('SWAP requires a control qubit')
            kernel.swap(qubits[ctrl], qubits[tgt])
        elif name == 'CCX':
            # Toffoli gate — PyKernel has no ccx(), so we use the standard
            # 6-CNOT gate decomposition: H·CX·T/Tdg·CX·T·CX·Tdg·CX·T·T·H·CX·T·Tdg·CX
            ctrl2 = int(g.get('control2', -1))
            if ctrl < 0 or ctrl2 < 0:
                raise ValueError('CCX (Toffoli) requires two control qubits (control and control2)')
            if len({tgt, ctrl, ctrl2}) < 3:
                raise ValueError(f'CCX: target={tgt}, ctrl={ctrl}, ctrl2={ctrl2} must all be distinct')
            c1, c2, t_q = qubits[ctrl], qubits[ctrl2], qubits[tgt]
            kernel.h(t_q)
            kernel.cx(c2,  t_q);  kernel.tdg(t_q)
            kernel.cx(c1,  t_q);  kernel.t(t_q)
            kernel.cx(c2,  t_q);  kernel.tdg(t_q)
            kernel.cx(c1,  t_q)
            kernel.t(c2);         kernel.t(t_q);  kernel.h(t_q)
            kernel.cx(c1,  c2);   kernel.t(c1);   kernel.tdg(c2)
            kernel.cx(c1,  c2)
        else:
            raise ValueError(f'Unsupported gate: {name}')

    # Measure all qubits
    kernel.mz(qubits)

    # ── Sample ────────────────────────────────────────────────────────────────
    t0     = time.perf_counter()
    result = cudaq.sample(kernel, shots_count=shots)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    # ── Extract counts ────────────────────────────────────────────────────────
    # SampleResult supports iteration over bitstrings
    counts: dict[str, int] = {}
    for bitstring in result:
        counts[bitstring] = result.count(bitstring)

    return {
        'backend':    backend,
        'elapsed_ms': round(elapsed_ms, 3),
        'confirmed':  True,   # server always confirms — it actually ran CUDA-Q
        'counts':     counts,
    }


# ═════════════════════════════════════════════════════════════════════════════
# HTTP REQUEST HANDLER
# ═════════════════════════════════════════════════════════════════════════════

class CudaQHandler(http.server.SimpleHTTPRequestHandler):
    """Serves frontend static files AND handles /api/run POST."""

    def __init__(self, *args, **kwargs):
        # Serve files from the frontend directory
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    # ── suppress default access log noise (keep errors) ──────────────────────
    def log_message(self, fmt, *args):
        code = args[1] if len(args) > 1 else '???'
        try:
            code_int = int(code)
        except (ValueError, TypeError):
            code_int = 0
        if code_int >= 400:
            super().log_message(fmt, *args)
        else:
            # Print a tidy one-liner
            method = self.command
            path   = self.path
            print(f'  {code}  {method} {path}')

    def do_OPTIONS(self):
        """Handle CORS pre-flight."""
        self.send_response(200)
        self._add_cors_headers()
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/api/run':
            self.send_error(404, 'Not found')
            return

        # ── Read body ─────────────────────────────────────────────────────────
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            self._json_response(400, {'error': f'Invalid JSON: {exc}'})
            return

        # ── Check CUDA-Q availability ─────────────────────────────────────────
        if not CUDAQ_AVAILABLE:
            self._json_response(501, {'error': 'cudaq not installed in this Python environment'})
            return

        # ── Run circuit ───────────────────────────────────────────────────────
        try:
            result = build_and_run(payload)
            self._json_response(200, result)
        except Exception as exc:
            tb = traceback.format_exc()
            print(f'[server] ERROR running circuit:\n{tb}')
            self._json_response(500, {'error': str(exc)})

    # ── Helpers ───────────────────────────────────────────────────────────────
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
    import socket
    for port in range(preferred, preferred + 20):
        with socket.socket() as s:
            s.settimeout(0.1)
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return preferred


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
    port = find_free_port(port)

    # Print LAN-accessible URL
    import socket
    try:
        lan_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        lan_ip = '127.0.0.1'

    print()
    print('  ┌─────────────────────────────────────────────────────┐')
    print(f'  │  CUDA-Q Circuit Lab                                 │')
    print(f'  │  Local:   http://127.0.0.1:{port}                     │')
    print(f'  │  Network: http://{lan_ip}:{port}                  │')
    print(f'  │  GPU:     {"Available ✓" if CUDAQ_AVAILABLE else "cudaq NOT installed ✗"}                             │')
    print('  └─────────────────────────────────────────────────────┘')
    print()

    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), CudaQHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[server] Stopped.')


if __name__ == '__main__':
    main()
