#include <algorithm>
#include <chrono>
#include <cudaq.h>
#include <iostream>
#include <map>
#include <numeric>

// Define a quantum kernel that returns an integer
__qpu__ int ghz_kernel(int qubit_count) {
  // Allocate qubits
  cudaq::qvector qubits(qubit_count);

  // Create GHZ state
  h(qubits[0]);
  for (int i = 1; i < qubit_count; ++i) {
    x<cudaq::ctrl>(qubits[0], qubits[i]);
  }

  // Measure and count the number of qubits in state |1⟩
  int result = 0;
  for (int i = 0; i < qubit_count; ++i) {
    if (mz(qubits[i])) {
      result += 1;
    }
  }

  return result;
}

int main() {
  int qubit_count = 3;
  constexpr int shots = 10;

  cudaq::set_target_backend("nvidia");
  auto gpu_start = std::chrono::steady_clock::now();
  auto gpu_results = cudaq::run(shots, ghz_kernel, qubit_count);
  auto gpu_end = std::chrono::steady_clock::now();

  cudaq::set_target_backend("qpp-cpu");
  auto cpu_start = std::chrono::steady_clock::now();
  auto cpu_results = cudaq::run(shots, ghz_kernel, qubit_count);
  auto cpu_end = std::chrono::steady_clock::now();

  const auto gpu_time = std::chrono::duration<double, std::milli>(gpu_end - gpu_start);
  const auto cpu_time = std::chrono::duration<double, std::milli>(cpu_end - cpu_start);

  std::cout << "GPU (nvidia): " << gpu_results.size() << " shots in "
            << gpu_time.count() << " ms\nResults: ";
  for (auto result : gpu_results) {
    std::cout << result << " ";
  }
  std::cout << "\n\nCPU (qpp-cpu): " << cpu_results.size() << " shots in "
            << cpu_time.count() << " ms\nResults: ";
  for (auto result : cpu_results) {
    std::cout << result << " ";
  }
  std::cout << "\n";
}