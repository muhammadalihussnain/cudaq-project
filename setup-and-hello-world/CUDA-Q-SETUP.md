# CUDA-Q 0.13.0 Setup Guide

This guide prepares a Linux x86_64 machine to run CUDA-Q 0.13.0 programs in both Python and C++. It also shows how to run one program first on an NVIDIA GPU and then on the CPU, while measuring the time for each run.

The commands below assume Ubuntu or another Debian-based Linux distribution, an NVIDIA GPU, and the workspace directory:

```text
~/Downloads/Ali
```

CUDA-Q can run CPU simulations without an NVIDIA GPU. The `nvidia` target, however, requires a working NVIDIA driver and CUDA Toolkit.

## 1. Install basic tools

Open a new terminal and install the compiler, Python, and utility packages:

```bash
sudo apt update
sudo apt install -y build-essential python3 python3-venv python3-pip wget curl
```

Successful result: the command finishes without an `E:` error.

Check the tools:

```bash
python3 --version
g++ --version
```

Expected result: Python 3.10 or newer and a working GNU C++ compiler.

## 2. Check the NVIDIA driver and CUDA Toolkit

Check the GPU driver:

```bash
nvidia-smi
```

Successful result: a table showing the NVIDIA GPU, driver version, and CUDA version. If `nvidia-smi` is not found or cannot communicate with the driver, install a compatible NVIDIA driver before continuing with GPU execution.

Check the CUDA compiler:

```bash
nvcc --version
```

Successful result: CUDA 13.x is reported. Install CUDA Toolkit 13 from the [NVIDIA CUDA Toolkit download page](https://developer.nvidia.com/cuda-downloads) if `nvcc` is not found.

The CPU target does not require CUDA Toolkit. The GPU target does.

## 3. Download and install the CUDA-Q C++ toolkit

The release tag is `0.13.0`, not `v0.13.0`. Download the x86_64 CUDA 13 installer:

```bash
cd ~/Downloads
wget https://github.com/NVIDIA/cuda-quantum/releases/download/0.13.0/install_cuda_quantum_cu13.x86_64
```

Successful result: `wget` reports a completed download and creates the file `install_cuda_quantum_cu13.x86_64`.

Make it executable and install it to the default location:

```bash
chmod +x install_cuda_quantum_cu13.x86_64
sudo bash install_cuda_quantum_cu13.x86_64 --accept
```

Load CUDA-Q into the current terminal:

```bash
source /opt/nvidia/cudaq/set_env.sh
```

Verify the C++ installation:

```bash
command -v nvq++
nvq++ --version
```

Expected result:

```text
/opt/nvidia/cudaq/bin/nvq++
nvq++ Version 0.13.0
```

The `source` command must be run in each new terminal before using `nvq++`. To load it automatically for Bash terminals:

```bash
echo 'source /opt/nvidia/cudaq/set_env.sh' >> ~/.bashrc
source ~/.bashrc
```

## 4. Create the Python environment

A virtual environment keeps CUDA-Q and Jupyter packages separate from the system Python installation:

```bash
cd ~/Downloads/Ali
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install cudaq==0.13.0 jupyter ipykernel
python -m ipykernel install --user --name cudaq-013 --display-name "Python (CUDA-Q 0.13.0)"
```

Successful result: pip finishes without an error and registers the kernel `Python (CUDA-Q 0.13.0)`.

Verify Python CUDA-Q:

```bash
python -c "import cudaq; print(cudaq.__version__)"
```

Expected result:

```text
0.13.0
```

For a new terminal, activate the environment with:

```bash
cd ~/Downloads/Ali
source .venv/bin/activate
```

## 5. Run the Python example

Create `ghz.py` with this content, or put the same code in a Python notebook cell:

```python
import time
import cudaq


@cudaq.kernel
def ghz_kernel(qubit_count: int) -> int:
    qubits = cudaq.qvector(qubit_count)
    h(qubits[0])
    for index in range(1, qubit_count):
        x.ctrl(qubits[0], qubits[index])

    result = 0
    for index in range(qubit_count):
        if mz(qubits[index]):
            result += 1
    return result


qubit_count = 3
shots = 1000

cudaq.set_target("nvidia")
gpu_start = time.perf_counter()
gpu_results = cudaq.run(ghz_kernel, qubit_count, shots_count=shots)
gpu_time = (time.perf_counter() - gpu_start) * 1000

cudaq.set_target("qpp-cpu")
cpu_start = time.perf_counter()
cpu_results = cudaq.run(ghz_kernel, qubit_count, shots_count=shots)
cpu_time = (time.perf_counter() - cpu_start) * 1000

print(f"GPU (nvidia): {len(gpu_results)} shots in {gpu_time:.3f} ms")
print(f"CPU (qpp-cpu): {len(cpu_results)} shots in {cpu_time:.3f} ms")
print(f"GPU results: {gpu_results}")
print(f"CPU results: {cpu_results}")
```

Run it from the activated environment:

```bash
python ghz.py
```

Expected result: two lines showing 1000 shots and two measured times. The results should contain only `0` and `3`, because a three-qubit GHZ state produces the all-zero or all-one measurement result. Exact times and ordering are different on every machine.

To use the notebook in this workspace:

```bash
cd ~/Downloads/Ali
source .venv/bin/activate
jupyter notebook hello-world.ipynb
```

In VS Code, open `hello-world.ipynb`, select the kernel named `Python (CUDA-Q 0.13.0)`, and run the Python cell.

## 6. Run the C++ example on GPU and CPU

The supplied `sample.cpp` selects both targets at runtime using:

```cpp
cudaq::set_target_backend("nvidia");
cudaq::set_target_backend("qpp-cpu");
```

Compile it after loading the CUDA-Q environment:

```bash
cd ~/Downloads/Ali
source /opt/nvidia/cudaq/set_env.sh
nvq++ sample.cpp -o sample
```

Notice that this command does not include `--target`. The program chooses the backend at runtime, so one executable can run on both targets.

Run it:

```bash
./sample
```

Expected result:

```text
GPU (nvidia): 10 shots in ... ms
Results: 0 3 3 0 3 0 3 3 3 0

CPU (qpp-cpu): 10 shots in ... ms
Results: 3 3 0 0 3 0 0 0 3 3
```

The exact result order is random, and the timing depends on the machine. For a more useful performance comparison, increase `shots` in `sample.cpp` from `10` to `1000` or more, then recompile and run.

## 7. Troubleshooting

### `404 Not Found` while downloading

Use the release tag without `v`:

```bash
wget https://github.com/NVIDIA/cuda-quantum/releases/download/0.13.0/install_cuda_quantum_cu13.x86_64
```

### `nvq++: command not found`

Load the environment script:

```bash
source /opt/nvidia/cudaq/set_env.sh
command -v nvq++
```

### GPU target cannot start

Check both the driver and toolkit:

```bash
nvidia-smi
nvcc --version
```

The CPU target can still be tested by changing or retaining:

```cpp
cudaq::set_target_backend("qpp-cpu");
```

### Python says `No module named cudaq`

Activate the virtual environment and verify its interpreter:

```bash
cd ~/Downloads/Ali
source .venv/bin/activate
which python
python -c "import cudaq; print(cudaq.__version__)"
```

`which python` should point into `~/Downloads/Ali/.venv/`.

### C++ reports `expected '}'`

Check that `main()` ends with a closing brace. The final lines of `sample.cpp` should include:

```cpp
  std::cout << "\n";
}
```

## Quick start summary

After the one-time installation, use these commands for C++:

```bash
cd ~/Downloads/Ali
source /opt/nvidia/cudaq/set_env.sh
nvq++ sample.cpp -o sample
./sample
```

For Python:

```bash
cd ~/Downloads/Ali
source .venv/bin/activate
python ghz.py
```
