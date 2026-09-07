#include <cudaq.h>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

constexpr int kMaxQubits = 29;

struct Gate {
  std::string name;
  int target;
  int control = -1;
  double angle = 0.0;
};

// Build a CUDA-Q kernel from the circuit assembled by the web application.
auto build_kernel(int qubit_count, const std::vector<int> &initial_states,
                  const std::vector<Gate> &gates) {
  auto kernel = cudaq::make_kernel();
  auto qubits = kernel.qalloc(static_cast<std::size_t>(qubit_count));
  for (int index = 0; index < qubit_count; ++index) {
    if (initial_states[index] == 1) kernel.x(qubits[index]);
    if (initial_states[index] == 2) kernel.h(qubits[index]);
    if (initial_states[index] == 3) {
      kernel.x(qubits[index]);
      kernel.h(qubits[index]);
    }
  }
  for (const auto &gate : gates) {
    if (gate.name == "I") continue;
    if (gate.name == "X") kernel.x(qubits[gate.target]);
    else if (gate.name == "Y") kernel.y(qubits[gate.target]);
    else if (gate.name == "Z") kernel.z(qubits[gate.target]);
    else if (gate.name == "H") kernel.h(qubits[gate.target]);
    else if (gate.name == "S") kernel.s(qubits[gate.target]);
    else if (gate.name == "T") kernel.t(qubits[gate.target]);
    else if (gate.name == "RX") kernel.rx(gate.angle, qubits[gate.target]);
    else if (gate.name == "RY") kernel.ry(gate.angle, qubits[gate.target]);
    else if (gate.name == "RZ") kernel.rz(gate.angle, qubits[gate.target]);
    else if (gate.name == "CNOT") kernel.x<cudaq::ctrl>(qubits[gate.control], qubits[gate.target]);
    else if (gate.name == "CZ") kernel.z<cudaq::ctrl>(qubits[gate.control], qubits[gate.target]);
    else if (gate.name == "SWAP") kernel.swap(qubits[gate.control], qubits[gate.target]);
    else throw std::invalid_argument("unsupported gate: " + gate.name);
  }
  kernel.mz(qubits);
  return kernel;
}

int main(int argc, char **argv) {
  const std::string backend = argc > 1 ? argv[1] : "qpp-cpu";
  const int shots = argc > 2 ? std::stoi(argv[2]) : 100;
  cudaq::set_target_backend(backend.c_str());
  const std::vector<int> initial_states{0};
  const std::vector<Gate> gates{{"H", 0}};
  auto kernel = build_kernel(1, initial_states, gates);
  const auto started = std::chrono::steady_clock::now();
  const auto result = cudaq::sample(shots, kernel);
  const auto finished = std::chrono::steady_clock::now();
  const auto elapsed = std::chrono::duration<double, std::milli>(finished - started).count();
  std::cout << "backend=" << backend << '\n';
  std::cout << "executed_by=CUDA-Q target " << backend << '\n';
  std::cout << "elapsed_ms=" << elapsed << '\n';
  for (const auto &[bits, count] : result) std::cout << bits << ": " << count << '\n';
}
