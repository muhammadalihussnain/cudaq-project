const gates = [
  ['I', 'Identity'], ['X', 'Pauli X'], ['Y', 'Pauli Y'], ['Z', 'Pauli Z'], ['H', 'Hadamard'],
  ['S', 'Phase'], ['T', 'T gate'], ['RX', 'Rotate X'], ['RY', 'Rotate Y'], ['RZ', 'Rotate Z'],
  ['CNOT', 'Controlled X'], ['CZ', 'Controlled Z'], ['SWAP', 'Exchange']
];
const stateValues = ['0', '1', '+', '-'];
let selectedBackend = 'qpp-cpu';
let circuit = [];
let qubitStates = ['0', '0', '0'];

const $ = (id) => document.getElementById(id);
const palette = $('gatePalette');
const board = $('circuitBoard');

function renderPalette() {
  palette.innerHTML = gates.map(([name, label]) => `<button class="gate-tile" draggable="true" data-gate="${name}" title="Drag ${label}"><strong>${name}</strong><small>${label}</small></button>`).join('');
  palette.querySelectorAll('.gate-tile').forEach((tile) => {
    tile.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', tile.dataset.gate));
    tile.addEventListener('click', () => addGate(tile.dataset.gate));
  });
}
function depth() { return Math.max(4, circuit.length ? Math.max(...circuit.map((gate) => gate.column)) + 1 : 4); }
function renderStates() {
  $('stateControls').innerHTML = qubitStates.map((state, index) => `<button class="state-button" data-qubit="${index}">q${index} |${state}&gt;</button>`).join('');
  $('stateControls').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.qubit); qubitStates[index] = stateValues[(stateValues.indexOf(qubitStates[index]) + 1) % stateValues.length]; renderStates();
  }));
}
function renderBoard() {
  const columnCount = depth(); board.style.setProperty('--depth', columnCount);
  board.innerHTML = Array.from({ length: Number($('qubitCount').value) }, (_, qubit) => `<div class="wire-row"><span class="qubit-label"><b>q${qubit}</b> / |${qubitStates[qubit] || '0'}&gt;</span>${Array.from({ length: columnCount }, (_, column) => {
    const gate = circuit.find((item) => item.column === column && item.target === qubit);
    return `<div class="slot" data-column="${column}" data-qubit="${qubit}">${gate ? `<button class="placed-gate ${['RX', 'RY', 'RZ'].includes(gate.gate) ? 'rotation' : ''}" title="Remove ${gate.gate}" data-remove="${gate.id}">${gate.gate}</button>` : '<span class="placeholder"></span>'}</div>`;
  }).join('')}</div>`).join('');
  board.querySelectorAll('.slot').forEach((slot) => {
    slot.addEventListener('dragover', (event) => { event.preventDefault(); slot.classList.add('drop-active'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-active'));
    slot.addEventListener('drop', (event) => { event.preventDefault(); slot.classList.remove('drop-active'); addGate(event.dataTransfer.getData('text/plain'), Number(slot.dataset.column), Number(slot.dataset.qubit)); });
  });
  board.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { circuit = circuit.filter((gate) => gate.id !== Number(button.dataset.remove)); renderBoard(); updateMeta(); }));
}
function addGate(name, column, target) {
  const qubits = Number($('qubitCount').value); const requiresControl = ['CNOT', 'CZ', 'SWAP'].includes(name);
  if (column === undefined) column = circuit.length ? Math.max(...circuit.map((gate) => gate.column)) + 1 : 0;
  if (target === undefined) target = 0;
  if (requiresControl && qubits < 2) return alert('This gate needs at least two qubits.');
  circuit = circuit.filter((gate) => !(gate.column === column && gate.target === target));
  circuit.push({ id: Date.now() + Math.random(), gate: name, column, target, control: requiresControl ? (target === 0 ? 1 : 0) : -1, angle: ['RX', 'RY', 'RZ'].includes(name) ? Math.PI / 2 : 0 });
  renderBoard(); updateMeta();
}
function updateMeta() { $('gateCount').textContent = `${circuit.length} gate${circuit.length === 1 ? '' : 's'}`; $('registerMeta').textContent = `${$('qubitCount').value} qubits`; $('depthMeta').textContent = `${circuit.length ? Math.max(...circuit.map((gate) => gate.column)) + 1 : 0} depth`; }
function payload() { return { qubits: Number($('qubitCount').value), shots: Number($('shots').value), backend: selectedBackend, states: qubitStates, gates: circuit }; }
function localPreview() {
  const shots = Number($('shots').value); const results = {}; const qubitCount = Number($('qubitCount').value);
  for (let index = 0; index < shots; index += 1) {
    const bits = qubitStates.slice(0, qubitCount).map((state) => state === '1' ? 1 : 0);
    circuit.slice().sort((left, right) => left.column - right.column).forEach((gate) => {
      if (gate.gate === 'X' || gate.gate === 'Y') bits[gate.target] ^= 1;
      if (gate.gate === 'Z' && bits[gate.target]) bits[gate.target] ^= 0;
      if (gate.gate === 'H') bits[gate.target] = index % 2;
      if (gate.gate === 'CNOT' && bits[gate.control]) bits[gate.target] ^= 1;
      if (gate.gate === 'CZ' && bits[gate.control] && bits[gate.target]) bits[gate.target] ^= 0;
      if (gate.gate === 'SWAP') [bits[gate.control], bits[gate.target]] = [bits[gate.target], bits[gate.control]];
      if (gate.gate === 'RX' || gate.gate === 'RY') bits[gate.target] = index % 2;
    });
    const state = bits.join(''); results[state] = (results[state] || 0) + 1;
  }
  return results;
}
function showResults(counts, note) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]); const maximum = entries[0]?.[1] || 1;
  $('resultEmpty').classList.add('hidden'); $('resultView').classList.remove('hidden'); $('resultTarget').textContent = selectedBackend; $('resultShots').textContent = `${Number($('shots').value).toLocaleString()} shots`; $('bars').innerHTML = entries.slice(0, 8).map(([bits, count]) => `<div class="bar-row"><span class="bar-label">|${bits}&gt;</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(3, count / maximum * 100)}%"></span></span><span class="bar-value">${count}</span></div>`).join(''); $('mostLikely').textContent = entries[0] ? `|${entries[0][0]}>` : '--'; $('resultNote').textContent = note;
}
async function runCircuit() {
  const button = $('runButton'); button.disabled = true; button.textContent = 'Running...'; $('connectionState').textContent = `Executing on ${selectedBackend}`;
  try { const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }); if (!response.ok) throw new Error('API unavailable'); const data = await response.json(); if (data.error) throw new Error(data.error); showResults(data.counts, 'Sampled by CUDA-Q'); }
  catch (error) { showResults(localPreview(), 'Local preview - connect the CUDA-Q API to run hardware'); }
  finally { button.disabled = false; button.innerHTML = '<span class="run-symbol">&#9654;</span> Run circuit'; $('connectionState').textContent = 'Local editor'; }
}
$('qubitCount').addEventListener('change', (event) => { const value = Math.min(29, Math.max(1, Number(event.target.value) || 1)); event.target.value = value; qubitStates = Array.from({ length: value }, (_, index) => qubitStates[index] || '0'); circuit = circuit.filter((gate) => gate.target < value && (gate.control < 0 || gate.control < value)); renderStates(); renderBoard(); updateMeta(); });
document.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => { $('qubitCount').value = Number($('qubitCount').value) + Number(button.dataset.step); $('qubitCount').dispatchEvent(new Event('change')); }));
document.querySelectorAll('.target-option').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.target-option').forEach((item) => item.classList.remove('active')); button.classList.add('active'); selectedBackend = button.dataset.backend; }));
$('runButton').addEventListener('click', runCircuit); $('clearButton').addEventListener('click', () => { circuit = []; qubitStates = Array.from({ length: Number($('qubitCount').value) }, () => '0'); renderStates(); renderBoard(); updateMeta(); $('resultEmpty').classList.remove('hidden'); $('resultView').classList.add('hidden'); });
$('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); renderPalette(); renderStates(); renderBoard(); updateMeta();
