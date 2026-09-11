#include <cudaq.h>
#include <chrono>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
constexpr int kMaxQubits  = 29;
constexpr int kMinQubits  = 1;
constexpr int kMinShots   = 1;
constexpr int kMaxShots   = 100'000;

// ─────────────────────────────────────────────────────────────────────────────
// Gate descriptor — mirrors the JSON payload from the web frontend
// ─────────────────────────────────────────────────────────────────────────────
struct Gate {
    std::string name;
    int         target  = 0;
    int         control = -1;
    double      angle   = 0.0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Input validation — separated from kernel construction (Single Responsibility)
// ─────────────────────────────────────────────────────────────────────────────
static void validate_inputs(int qubit_count,
                             int shots,
                             const std::vector<int>  &initial_states,
                             const std::vector<Gate> &gates)
{
    if (qubit_count < kMinQubits || qubit_count > kMaxQubits)
        throw std::invalid_argument(
            "qubit_count must be " + std::to_string(kMinQubits) +
            "–" + std::to_string(kMaxQubits) +
            ", got " + std::to_string(qubit_count));

    if (shots < kMinShots || shots > kMaxShots)
        throw std::invalid_argument(
            "shots must be " + std::to_string(kMinShots) +
            "–" + std::to_string(kMaxShots) +
            ", got " + std::to_string(shots));

    if (static_cast<int>(initial_states.size()) != qubit_count)
        throw std::invalid_argument(
            "initial_states length (" +
            std::to_string(initial_states.size()) +
            ") must equal qubit_count (" +
            std::to_string(qubit_count) + ")");

    for (const auto &gate : gates) {
        if (gate.target < 0 || gate.target >= qubit_count)
            throw std::out_of_range(
                "gate \"" + gate.name + "\" target=" +
                std::to_string(gate.target) +
                " is out of range [0, " +
                std::to_string(qubit_count - 1) + "]");

        // Two-qubit gates require a valid control qubit
        const bool needs_ctrl =
            (gate.name == "CNOT" || gate.name == "CZ" || gate.name == "SWAP");
        if (needs_ctrl) {
            if (gate.control < 0 || gate.control >= qubit_count)
                throw std::out_of_range(
                    "gate \"" + gate.name + "\" control=" +
                    std::to_string(gate.control) +
                    " is out of range [0, " +
                    std::to_string(qubit_count - 1) + "]");
            if (gate.control == gate.target)
                throw std::invalid_argument(
                    "gate \"" + gate.name +
                    "\" control and target must be different qubits");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial-state preparation
// ─────────────────────────────────────────────────────────────────────────────
// Encoding matches the Python server and frontend:
//   0 → |0⟩  (no-op)
//   1 → |1⟩  (X)
//   2 → |+⟩  (H)
//   3 → |−⟩  (X then H)
static void apply_initial_states(cudaq::kernel_builder<> &kernel,
                                  cudaq::QuakeValue       &qubits,
                                  const std::vector<int>  &initial_states)
{
    for (int i = 0; i < static_cast<int>(initial_states.size()); ++i) {
        switch (initial_states[i]) {
        case 0: break;                              // |0⟩ — default
        case 1: kernel.x(qubits[i]); break;        // |1⟩
        case 2: kernel.h(qubits[i]); break;        // |+⟩
        case 3: kernel.x(qubits[i]);               // |−⟩
                kernel.h(qubits[i]); break;
        default:
            throw std::invalid_argument(
                "Unknown initial state " + std::to_string(initial_states[i]) +
                " for qubit " + std::to_string(i) +
                ". Valid values: 0=|0⟩, 1=|1⟩, 2=|+⟩, 3=|−⟩");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate dispatch — replaces the long if-else chain with a lookup table
// (Strategy pattern: each gate maps to a callable that applies it)
// ─────────────────────────────────────────────────────────────────────────────
static void apply_gates(cudaq::kernel_builder<>   &kernel,
                         cudaq::QuakeValue          &qubits,
                         const std::vector<Gate>   &gates)
{
    // Single-qubit gate dispatch table
    using SingleApplier = std::function<void(cudaq::QuakeValue)>;
    const std::unordered_map<std::string, SingleApplier> single_qubit = {
        {"X",  [&](cudaq::QuakeValue q){ kernel.x(q); }},
        {"Y",  [&](cudaq::QuakeValue q){ kernel.y(q); }},
        {"Z",  [&](cudaq::QuakeValue q){ kernel.z(q); }},
        {"H",  [&](cudaq::QuakeValue q){ kernel.h(q); }},
        {"S",  [&](cudaq::QuakeValue q){ kernel.s(q); }},
        {"T",  [&](cudaq::QuakeValue q){ kernel.t(q); }},
    };

    for (const auto &gate : gates) {
        if (gate.name == "I") continue;  // identity — explicit no-op

        // ── Single-qubit gates ────────────────────────────────────────────
        auto it = single_qubit.find(gate.name);
        if (it != single_qubit.end()) {
            it->second(qubits[gate.target]);
            continue;
        }

        // ── Rotation gates (need angle parameter) ────────────────────────
        if (gate.name == "RX") { kernel.rx(gate.angle, qubits[gate.target]); continue; }
        if (gate.name == "RY") { kernel.ry(gate.angle, qubits[gate.target]); continue; }
        if (gate.name == "RZ") { kernel.rz(gate.angle, qubits[gate.target]); continue; }

        // ── Two-qubit gates ───────────────────────────────────────────────
        if (gate.name == "CNOT") {
            kernel.x<cudaq::ctrl>(qubits[gate.control], qubits[gate.target]);
            continue;
        }
        if (gate.name == "CZ") {
            kernel.z<cudaq::ctrl>(qubits[gate.control], qubits[gate.target]);
            continue;
        }
        if (gate.name == "SWAP") {
            kernel.swap(qubits[gate.control], qubits[gate.target]);
            continue;
        }

        throw std::invalid_argument("Unsupported gate: \"" + gate.name + "\"");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kernel builder — clean single-responsibility function
// ─────────────────────────────────────────────────────────────────────────────
static auto build_kernel(int                      qubit_count,
                          const std::vector<int>  &initial_states,
                          const std::vector<Gate> &gates)
{
    auto kernel = cudaq::make_kernel();
    auto qubits = kernel.qalloc(static_cast<std::size_t>(qubit_count));

    apply_initial_states(kernel, qubits, initial_states);
    apply_gates(kernel, qubits, gates);

    kernel.mz(qubits);   // measure all qubits at the end
    return kernel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result printer
// ─────────────────────────────────────────────────────────────────────────────
static void print_results(const std::string          &backend,
                            double                      elapsed_ms,
                            const cudaq::sample_result &result)
{
    std::cout << "backend="     << backend     << '\n';
    std::cout << "executed_by=CUDA-Q target " << backend << '\n';
    std::cout << "elapsed_ms="  << elapsed_ms  << '\n';
    std::cout << "counts:\n";
    for (const auto &[bits, count] : result)
        std::cout << "  " << bits << ": " << count << '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// main — exercises the full pipeline with a real Bell-state circuit
// (two qubits, H on q0 then CNOT q0→q1, expected |00⟩ ≈ |11⟩ 50/50)
// ─────────────────────────────────────────────────────────────────────────────
int main(int argc, char **argv)
{
    const std::string backend = (argc > 1) ? argv[1] : "qpp-cpu";
    const int         shots   = (argc > 2) ? std::stoi(argv[2]) : 1000;

    // ── Bell-state circuit definition ─────────────────────────────────────
    const int              qubit_count    = 2;
    const std::vector<int> initial_states = {0, 0};      // both start in |0⟩
    const std::vector<Gate> gates = {
        {"H",    0, -1, 0.0},   // Hadamard on q0
        {"CNOT", 1,  0, 0.0},   // CNOT: control=q0, target=q1
    };

    try {
        // Validate before touching CUDAQ
        validate_inputs(qubit_count, shots, initial_states, gates);

        cudaq::set_target_backend(backend.c_str());

        auto kernel = build_kernel(qubit_count, initial_states, gates);

        const auto t0     = std::chrono::steady_clock::now();
        const auto result = cudaq::sample(shots, kernel);
        const auto t1     = std::chrono::steady_clock::now();

        const double elapsed_ms =
            std::chrono::duration<double, std::milli>(t1 - t0).count();

        print_results(backend, elapsed_ms, result);

    } catch (const std::invalid_argument &e) {
        std::cerr << "[error] Invalid input: " << e.what() << '\n';
        return 1;
    } catch (const std::out_of_range &e) {
        std::cerr << "[error] Out of range: " << e.what() << '\n';
        return 1;
    } catch (const std::exception &e) {
        std::cerr << "[error] " << e.what() << '\n';
        return 1;
    }

    return 0;
}
