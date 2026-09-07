# CUDA-Q Kernel Builder

## Project layout

```text
program_hadmard_gate_both_states/
├── building-kernels.cpp  # CUDA-Q kernel-builder backend
├── frontend/             # Circuit editor UI
├── tests/                # Backend and integration checks
├── docs/README.md        # Build and usage guide
└── Makefile              # Build, run, test, and frontend commands
```

`building-kernels.cpp` builds a circuit with CUDA-Q's `kernel_builder`. Gate operations are constructed on the host, then executed by CUDA-Q on the selected target.

Supported gates: `I`, `X`, `Y`, `Z`, `H`, `S`, `T`, `RX`, `RY`, `RZ`, `CNOT`, `CZ`, and `SWAP`.

The current single-GPU limit is enforced by the application contract: use between 1 and 29 qubits. The builder is ready for the web circuit editor to provide the `Gate` list.

## Build

```bash
cd program_hadmard_gate_both_states
source /opt/nvidia/cudaq/set_env.sh
make build
```

## Run on CPU

```bash
make run-cpu
```

This uses CUDA-Q's `qpp-cpu` target and requires no GPU.

## Run on NVIDIA GPU

```bash
make run-gpu
```

This uses CUDA-Q's `nvidia` target and requires a working NVIDIA driver, CUDA runtime, and compatible GPU.

## Open the frontend

```bash
make web
```

Open the URL printed by the command. It starts on port 8080 when available and automatically uses 8081 when 8080 is busy. The editor is served from `frontend/`. Its Run button calls `POST /api/run` when the CUDA-Q service is present and otherwise shows a local preview, so the interface can be developed independently of the GPU machine.

If port 8080 is already in use, choose another port:

```bash
make web PORT=8081
```

### Share on the same network

Run `make web`. The command prints a network URL such as `http://172.16.6.97:8081`. Send that URL to colleagues connected to the same Wi-Fi or LAN. They must keep the browser and your computer on the same network, and your computer must remain powered on while they use the app.

If they cannot connect, allow the selected TCP port through the host firewall. The static frontend is available to them, but its Run button uses the browser preview until a CUDA-Q HTTP API is connected.

## Web application

The circuit editor and HTTP adapter should call `build_kernel()` with the selected qubit states and gate placements, then call `cudaq::sample()` after selecting `qpp-cpu` or `nvidia`. Keeping this boundary in `building-kernels.cpp` ensures execution remains CUDA-Q based.
