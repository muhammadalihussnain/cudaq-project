// ─────────────────────────────────────────────────────────────────────────────
// CUDA-Q Circuit Lab — app.js
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

// ═════════════════════════════════════════════════════════════════════════════
// GATE REGISTRY
// ═════════════════════════════════════════════════════════════════════════════
const GATE_META = {
  I:       { label: 'Identity',     desc: 'No-op placeholder.' },
  X:       { label: 'Pauli X',      desc: 'Bit-flip: |0⟩ ↔ |1⟩.' },
  Y:       { label: 'Pauli Y',      desc: 'Bit + phase flip.' },
  Z:       { label: 'Pauli Z',      desc: 'Phase flip: |1⟩ → −|1⟩.' },
  H:       { label: 'Hadamard',     desc: 'Creates equal superposition.\n|0⟩ → (|0⟩+|1⟩)/√2' },
  S:       { label: 'Phase (S)',     desc: 'π/2 phase on |1⟩.' },
  T:       { label: 'T gate',       desc: 'π/4 phase on |1⟩.' },
  RX:      { label: 'Rotate X',     desc: 'Rotation around X-axis (π/2).' },
  RY:      { label: 'Rotate Y',     desc: 'Rotation around Y-axis (π/2).' },
  RZ:      { label: 'Rotate Z',     desc: 'Rotation around Z-axis (π/2).' },
  CNOT:    { label: 'Controlled-X', desc: 'Flips target when ctrl=|1⟩.\nDrag control dot to move it.' },
  CZ:      { label: 'Controlled-Z', desc: 'Z on target when ctrl=|1⟩.\nDrag control dot to move it.' },
  SWAP:    { label: 'SWAP',         desc: 'Exchanges two qubits.\nDrag control dot to move it.' },
  CCX:     { label: 'Toffoli',      desc: 'Flips target when BOTH controls=|1⟩.\nNeeds ≥3 qubits.\nDrag either control dot to move it.' },
  MEASURE: { label: 'Measure',      desc: 'Explicit mid-circuit measurement marker.\nAll qubits are always measured at the end.\nThis gate is a visual annotation.' },
};

// Gate category sets
const TWO_QUBIT   = new Set(['CNOT', 'CZ', 'SWAP']);
const THREE_QUBIT = new Set(['CCX']);
const MULTI_QUBIT = new Set([...TWO_QUBIT, ...THREE_QUBIT]);
const ROTATION    = new Set(['RX', 'RY', 'RZ']);
const MEASURE_SET = new Set(['MEASURE']);   // visual-only annotation gate
const stateValues = ['0', '1', '+', '-'];

// 8 distinct bar colors — one per basis state row in the results panel
const BAR_COLORS = [
  '#55d6c2',  // 0 — cyan
  '#f4b860',  // 1 — amber
  '#a78bfa',  // 2 — violet
  '#34d399',  // 3 — emerald
  '#f87171',  // 4 — rose
  '#60a5fa',  // 5 — sky blue
  '#fb923c',  // 6 — orange
  '#e879f9',  // 7 — fuchsia
];

// ── App state ─────────────────────────────────────────────────────────────────
let selectedBackend = 'qpp-cpu';
let circuit         = [];
let qubitStates     = ['0', '0', '0'];
let activeQubit     = null;
let undoStack       = [];
let redoStack       = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  workspace:          $('workspace'),
  sidebar:            $('sidebar'),
  resultsPanel:       $('resultsPanel'),
  sidebarToggle:      $('sidebarToggle'),
  resultsPanelToggle: $('resultsPanelToggle'),
  themeToggle:        $('themeToggle'),
  helpButton:         $('helpButton'),
  helpModal:          $('helpModal'),
  helpModalClose:     $('helpModalClose'),
  undoButton:         $('undoButton'),
  redoButton:         $('redoButton'),
  clearButton:        $('clearButton'),
  runButton:          $('runButton'),
  compareButton:      $('compareButton'),
  qubitCount:         $('qubitCount'),
  shots:              $('shots'),
  gatePalette:        $('gatePalette'),
  circuitBoard:       $('circuitBoard'),
  stateControls:      $('stateControls'),
  stateFormula:       $('stateFormula'),
  activeQubitHint:    $('activeQubitHint'),
  connectorSvg:       $('connectorSvg'),
  gateTooltip:        $('gateTooltip'),
  gateCount:          $('gateCount'),
  registerMeta:       $('registerMeta'),
  depthMeta:          $('depthMeta'),
  connectionState:    $('connectionState'),
  liveBadge:          $('liveBadge'),
  resultEmpty:        $('resultEmpty'),
  resultView:         $('resultView'),
  compareView:        $('compareView'),
  resultTarget:       $('resultTarget'),
  resultShots:        $('resultShots'),
  resultTime:         $('resultTime'),
  bars:               $('bars'),
  bitBreakdown:       $('bitBreakdown'),
  resultNote:         $('resultNote'),
  mostLikely:         $('mostLikely'),
  compareRows:        $('compareRows'),
  clock:              $('clock'),
  gpuConfirmBanner:   $('gpuConfirmBanner'),
};

// ═════════════════════════════════════════════════════════════════════════════
// THEME
// ═════════════════════════════════════════════════════════════════════════════
let darkMode = true;
try { if (localStorage.getItem('cudaq-theme') === 'light') darkMode = false; } catch (_) {}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  el.themeToggle.textContent = darkMode ? '☀' : '☽';
  el.themeToggle.title       = darkMode ? 'Switch to light mode' : 'Switch to dark mode';
  try { localStorage.setItem('cudaq-theme', darkMode ? 'dark' : 'light'); } catch (_) {}
}
function toggleTheme() { darkMode = !darkMode; applyTheme(); }
applyTheme();
el.themeToggle.addEventListener('click', toggleTheme);

// ═════════════════════════════════════════════════════════════════════════════
// PANEL COLLAPSE
// ═════════════════════════════════════════════════════════════════════════════
const SIDEBAR_W = 260, RESULTS_W = 260;
let sidebarOpen = true, resultsOpen = true;

function updateWorkspaceLayout() {
  const lw = sidebarOpen ? SIDEBAR_W : 0;
  const rw = resultsOpen ? RESULTS_W : 0;
  el.workspace.style.gridTemplateColumns = `${lw}px minmax(0,1fr) ${rw}px`;
  el.sidebarToggle.style.left       = lw + 'px';
  el.resultsPanelToggle.style.right = rw + 'px';
  el.sidebarToggle.textContent      = sidebarOpen ? '‹' : '›';
  el.resultsPanelToggle.textContent = resultsOpen ? '›' : '‹';
  el.sidebar.classList.toggle('is-collapsed', !sidebarOpen);
  el.resultsPanel.classList.toggle('is-collapsed', !resultsOpen);
  requestAnimationFrame(drawConnectors);
}

function toggleSidebar()      { sidebarOpen = !sidebarOpen; updateWorkspaceLayout(); }
function toggleResultsPanel() { resultsOpen = !resultsOpen; updateWorkspaceLayout(); }

el.sidebarToggle.addEventListener('click', toggleSidebar);
el.resultsPanelToggle.addEventListener('click', toggleResultsPanel);
updateWorkspaceLayout();

// ═════════════════════════════════════════════════════════════════════════════
// UNDO / REDO
// ═════════════════════════════════════════════════════════════════════════════
function snapshot() {
  undoStack.push(JSON.stringify({ circuit, qubitStates }));
  redoStack = [];
  if (undoStack.length > 60) undoStack.shift();
  syncUndoButtons();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify({ circuit, qubitStates }));
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify({ circuit, qubitStates }));
  restore(redoStack.pop());
}
function restore(json) {
  const s = JSON.parse(json);
  circuit = s.circuit; qubitStates = s.qubitStates;
  renderStates(); renderBoard(); updateMeta(); syncUndoButtons();
}
function syncUndoButtons() {
  el.undoButton.disabled = undoStack.length === 0;
  el.redoButton.disabled = redoStack.length === 0;
}
el.undoButton.addEventListener('click', undo);
el.redoButton.addEventListener('click', redo);

// ═════════════════════════════════════════════════════════════════════════════
// TOOLTIP
// ═════════════════════════════════════════════════════════════════════════════
let tooltipTimer = null;
function showTooltip(anchor, gateName) {
  const meta = GATE_META[gateName];
  if (!meta) return;
  el.gateTooltip.textContent = `${gateName} — ${meta.label}\n${meta.desc}`;
  el.gateTooltip.classList.add('visible');
  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 8, left = r.left;
  if (left + 230 > window.innerWidth - 10) left = window.innerWidth - 240;
  if (top  + 80  > window.innerHeight)     top  = r.top - 90;
  el.gateTooltip.style.top  = top  + 'px';
  el.gateTooltip.style.left = left + 'px';
}
function hideTooltip() { clearTimeout(tooltipTimer); el.gateTooltip.classList.remove('visible'); }

// ═════════════════════════════════════════════════════════════════════════════
// HELP MODAL
// ═════════════════════════════════════════════════════════════════════════════
const openHelp  = () => el.helpModal.classList.remove('hidden');
const closeHelp = () => el.helpModal.classList.add('hidden');
el.helpButton.addEventListener('click', openHelp);
el.helpModalClose.addEventListener('click', closeHelp);
el.helpModal.addEventListener('click', e => { if (e.target === el.helpModal) closeHelp(); });

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVE QUBIT SELECTION
// ═════════════════════════════════════════════════════════════════════════════
function setActiveQubit(idx) {
  activeQubit = (activeQubit === idx) ? null : idx;
  updateActiveQubitHint();
  renderStateButtonHighlights();
  document.querySelectorAll('.wire-row').forEach((row, i) =>
    row.classList.toggle('is-active-row', i === activeQubit));
  document.querySelectorAll('.qubit-label').forEach((lbl, i) =>
    lbl.classList.toggle('is-active-row', i === activeQubit));
}
function updateActiveQubitHint() {
  if (activeQubit === null) {
    el.activeQubitHint.textContent = 'Click a qubit row to select it, then click a gate to place it there.';
    el.activeQubitHint.classList.remove('has-selection');
  } else {
    el.activeQubitHint.textContent = `q${activeQubit} selected — click any gate to place it on q${activeQubit}.`;
    el.activeQubitHint.classList.add('has-selection');
  }
}
function renderStateButtonHighlights() {
  document.querySelectorAll('.state-button').forEach(btn =>
    btn.classList.toggle('is-active-qubit', Number(btn.dataset.qubit) === activeQubit));
}

// ═════════════════════════════════════════════════════════════════════════════
// GATE PALETTE
// ═════════════════════════════════════════════════════════════════════════════
function renderPalette() {
  el.gatePalette.innerHTML = Object.entries(GATE_META).map(([name, meta]) =>
    `<button class="gate-tile${THREE_QUBIT.has(name) ? ' gate-tile--3q' : ''}"
             draggable="true" data-gate="${name}" aria-label="${meta.label}">
      <strong>${name}</strong><small>${meta.label}</small>
    </button>`
  ).join('');

  el.gatePalette.querySelectorAll('.gate-tile').forEach(tile => {
    const name = tile.dataset.gate;
    tile.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', name);
      e.dataTransfer.setData('x-source', 'palette');
    });
    tile.addEventListener('click', () => {
      if (activeQubit === null) {
        el.activeQubitHint.style.color = 'var(--amber)';
        el.activeQubitHint.textContent = '⬆ First click a qubit row above to select it.';
        setTimeout(() => updateActiveQubitHint(), 2200);
        return;
      }
      snapshot();
      addGate(name, undefined, activeQubit);
    });
    tile.addEventListener('mouseenter', () => { tooltipTimer = setTimeout(() => showTooltip(tile, name), 420); });
    tile.addEventListener('mouseleave', hideTooltip);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// STATE BUTTONS
// ═════════════════════════════════════════════════════════════════════════════
function depth() {
  return Math.max(4, circuit.length ? Math.max(...circuit.map(g => g.column)) + 1 : 4);
}
function renderStates() {
  el.stateControls.innerHTML = qubitStates.map((state, i) =>
    `<button class="state-button${i === activeQubit ? ' is-active-qubit' : ''}"
             data-qubit="${i}" data-state="${state}">q${i} |${state}&gt;</button>`
  ).join('');
  el.stateControls.querySelectorAll('.state-button').forEach(btn => {
    const idx = Number(btn.dataset.qubit);
    btn.addEventListener('click', () => {
      if (activeQubit === idx) {
        snapshot();
        qubitStates[idx] = stateValues[(stateValues.indexOf(qubitStates[idx]) + 1) % stateValues.length];
        renderStates(); renderBoard(); liveFormula();
      } else {
        setActiveQubit(idx);
      }
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// CIRCUIT BOARD
// ═════════════════════════════════════════════════════════════════════════════
function renderBoard() {
  const colCount   = depth();
  const qubitCount = Number(el.qubitCount.value);
  el.circuitBoard.style.setProperty('--depth', colCount);

  el.circuitBoard.innerHTML = Array.from({ length: qubitCount }, (_, qubit) => {
    const isActiveRow = qubit === activeQubit;

    const slots = Array.from({ length: colCount }, (_, col) => {
      const gate  = circuit.find(g => g.column === col && g.target === qubit);

      // Which control role does this qubit play for a gate in this column?
      const ctrl1For = circuit.find(g => g.column === col && g.control  === qubit);
      const ctrl2For = circuit.find(g => g.column === col && g.control2 === qubit);

      const isRot     = gate && ROTATION.has(gate.gate);
      const is3Q      = gate && THREE_QUBIT.has(gate.gate);
      const is2Q      = gate && TWO_QUBIT.has(gate.gate);
      const isMeasure = gate && MEASURE_SET.has(gate.gate);

      let inner;
      if (gate) {
        // ── Gate button ─────────────────────────────────────────────────────
        const tipText = is3Q
          ? `${gate.gate}: ctrl1=q${gate.control} ctrl2=q${gate.control2} → tgt=q${gate.target}\nDrag control dots to move them`
          : is2Q
            ? `${gate.gate}: ctrl=q${gate.control} → tgt=q${gate.target}\nDrag control dot to move it`
            : isMeasure
              ? `Measure q${qubit} — visual annotation\nAll qubits are always measured at the end`
              : `${gate.gate} on q${qubit} — click to remove, drag to move`;

        inner = `<button
          class="placed-gate${isRot ? ' rotation' : ''}${is3Q ? ' toffoli' : ''}${isMeasure ? ' measure-gate' : ''}"
          draggable="true"
          data-gate-id="${gate.id}"
          data-gate-name="${gate.gate}"
          title="${tipText}"
        >${isMeasure ? '<tspan>&#9646;</tspan>M' : gate.gate}</button>`;

      } else if (ctrl2For) {
        // ── Second control dot (Toffoli ctrl2) ─────────────────────────────
        inner = `<span class="control-dot control-dot--2"
          draggable="true"
          data-ctrl-gate-id="${ctrl2For.id}"
          data-ctrl-role="2"
          title="Control-2 for ${ctrl2For.gate} (q${ctrl2For.target}) — click to cycle, drag to move"
        ></span>`;

      } else if (ctrl1For) {
        // ── First (or only) control dot ─────────────────────────────────────
        inner = `<span class="control-dot control-dot--1"
          draggable="true"
          data-ctrl-gate-id="${ctrl1For.id}"
          data-ctrl-role="1"
          title="Control for ${ctrl1For.gate} (q${ctrl1For.target}) — click to cycle, drag to move"
        ></span>`;

      } else {
        inner = '<span class="placeholder"></span>';
      }

      return `<div class="slot" data-column="${col}" data-qubit="${qubit}">${inner}</div>`;
    }).join('');

    return `<div class="wire-row${isActiveRow ? ' is-active-row' : ''}" data-qubit-row="${qubit}">
      <span class="qubit-label${isActiveRow ? ' is-active-row' : ''}"
            data-qubit="${qubit}"><b>q${qubit}</b>&nbsp;|${qubitStates[qubit] || '0'}&gt;</span>
      ${slots}
    </div>`;
  }).join('');

  // ── Qubit label click → select row ─────────────────────────────────────────
  el.circuitBoard.querySelectorAll('.qubit-label').forEach(lbl =>
    lbl.addEventListener('click', () => setActiveQubit(Number(lbl.dataset.qubit))));

  // ── Slot drop events ────────────────────────────────────────────────────────
  el.circuitBoard.querySelectorAll('.slot').forEach(slot => {
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('drop-active'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-active'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drop-active');

      const source    = e.dataTransfer.getData('x-source');
      const destCol   = Number(slot.dataset.column);
      const destQubit = Number(slot.dataset.qubit);
      const total     = Number(el.qubitCount.value);

      // ── A: move a control dot ───────────────────────────────────────────────
      if (source === 'control-dot') {
        const gateId = Number(e.dataTransfer.getData('x-gate-id'));
        const role   = e.dataTransfer.getData('x-ctrl-role');  // '1' or '2'
        const g      = circuit.find(item => item.id === gateId);
        if (!g) return;

        // Destination must be in the same column as the gate
        if (destCol !== g.column) {
          flashSlot(slot, 'error');
          return;
        }
        // Destination qubit must not be the target
        if (destQubit === g.target) {
          flashSlot(slot, 'error');
          return;
        }
        // For Toffoli: new ctrl must not equal the OTHER control
        if (THREE_QUBIT.has(g.gate)) {
          const other = role === '1' ? g.control2 : g.control;
          if (destQubit === other) { flashSlot(slot, 'error'); return; }
        }

        snapshot();
        if (role === '2') {
          g.control2 = destQubit;
        } else {
          g.control = destQubit;
        }
        renderBoard(); updateMeta();
        return;
      }

      // ── B: move a placed gate ───────────────────────────────────────────────
      if (source === 'placed-gate') {
        const id = Number(e.dataTransfer.getData('x-gate-id'));
        const g  = circuit.find(item => item.id === id);
        if (!g) return;
        snapshot();
        circuit = circuit.filter(item => !(item.column === destCol && item.target === destQubit));
        g.column = destCol;
        g.target = destQubit;
        // Revalidate controls: make sure they don't equal the new target
        if (MULTI_QUBIT.has(g.gate)) {
          if (g.control === g.target) {
            g.control = pickFreeQubit(total, [g.target, g.control2 ?? -1]);
          }
          if (THREE_QUBIT.has(g.gate) && g.control2 === g.target) {
            g.control2 = pickFreeQubit(total, [g.target, g.control]);
          }
        }
        renderBoard(); updateMeta();
        return;
      }

      // ── C: fresh gate from palette ──────────────────────────────────────────
      const name = e.dataTransfer.getData('text/plain');
      if (name) { snapshot(); addGate(name, destCol, destQubit); }
    });
  });

  // ── Placed gate events ──────────────────────────────────────────────────────
  el.circuitBoard.querySelectorAll('[data-gate-id]').forEach(btn => {
    const id   = Number(btn.dataset.gateId);
    const name = btn.dataset.gateName;

    btn.addEventListener('dragstart', e => {
      e.dataTransfer.setData('x-source',  'placed-gate');
      e.dataTransfer.setData('x-gate-id', String(id));
      e.dataTransfer.setData('text/plain', name);
      btn.classList.add('dragging');
    });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));

    // click → remove
    btn.addEventListener('click', e => {
      e.stopPropagation();
      snapshot();
      circuit = circuit.filter(g => g.id !== id);
      renderBoard(); updateMeta();
    });

    // double-click → cycle primary control for 2-qubit gates
    btn.addEventListener('dblclick', e => {
      e.preventDefault();
      const g = circuit.find(item => item.id === id);
      if (!g || !MULTI_QUBIT.has(g.gate)) return;
      snapshot();
      const total = Number(el.qubitCount.value);
      const avoid = THREE_QUBIT.has(g.gate) ? [g.target, g.control2] : [g.target];
      g.control = pickFreeQubit(total, avoid, g.control);
      renderBoard(); drawConnectors();
    });

    btn.addEventListener('mouseenter', () => { tooltipTimer = setTimeout(() => showTooltip(btn, name), 360); });
    btn.addEventListener('mouseleave', hideTooltip);
  });

  // ── Control dot drag events ─────────────────────────────────────────────────
  el.circuitBoard.querySelectorAll('[data-ctrl-gate-id]').forEach(dot => {
    const gateId = dot.dataset.ctrlGateId;
    const role   = dot.dataset.ctrlRole;  // '1' or '2'

    dot.addEventListener('dragstart', e => {
      e.dataTransfer.setData('x-source',    'control-dot');
      e.dataTransfer.setData('x-gate-id',   gateId);
      e.dataTransfer.setData('x-ctrl-role', role);
      e.dataTransfer.setData('text/plain',  'control-dot');  // required by Firefox
      dot.classList.add('dragging');
    });
    dot.addEventListener('dragend', () => dot.classList.remove('dragging'));

    // click → cycle this control to next free qubit
    dot.addEventListener('click', e => {
      e.stopPropagation();
      const g     = circuit.find(item => item.id === Number(gateId));
      if (!g) return;
      snapshot();
      const total = Number(el.qubitCount.value);
      if (role === '2') {
        g.control2 = pickFreeQubit(total, [g.target, g.control], g.control2);
      } else {
        const avoid = THREE_QUBIT.has(g.gate) ? [g.target, g.control2] : [g.target];
        g.control = pickFreeQubit(total, avoid, g.control);
      }
      renderBoard(); drawConnectors();
    });
  });

  requestAnimationFrame(drawConnectors);
}

// ── Helper: pick next qubit index that isn't in `avoid`, cycling from `current`
function pickFreeQubit(total, avoid, current = -1) {
  let next = ((current < 0 ? 0 : current) + 1) % total;
  let tries = 0;
  while (avoid.includes(next) && tries++ < total) next = (next + 1) % total;
  return next;
}

// ── Brief error flash on a slot ───────────────────────────────────────────────
function flashSlot(slot, type = 'error') {
  slot.classList.add(`slot--flash-${type}`);
  setTimeout(() => slot.classList.remove(`slot--flash-${type}`), 600);
}

// ═════════════════════════════════════════════════════════════════════════════
// SVG CONNECTOR LINES
// Draws dashed vertical lines between every control dot and its gate.
// For Toffoli: draws two lines (ctrl1→gate, ctrl2→gate).
// ═════════════════════════════════════════════════════════════════════════════
function drawConnectors() {
  const svg   = el.connectorSvg;
  const board = el.circuitBoard;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const bR            = board.getBoundingClientRect();
  const boardOffLeft  = board.offsetLeft;
  const boardOffTop   = board.offsetTop;

  function dotToGateLine(dotEl, gateEl) {
    if (!dotEl || !gateEl) return;
    const dR = dotEl.getBoundingClientRect();
    const gR = gateEl.getBoundingClientRect();
    const x1 = dR.left + dR.width  / 2 - bR.left + boardOffLeft;
    const y1 = dR.top  + dR.height / 2 - bR.top  + boardOffTop;
    const x2 = gR.left + gR.width  / 2 - bR.left + boardOffLeft;
    const y2 = gR.top  + gR.height / 2 - bR.top  + boardOffTop;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('class', 'connector-line');
    svg.appendChild(line);
  }

  circuit.forEach(g => {
    if (!MULTI_QUBIT.has(g.gate)) return;
    const gateBtn = board.querySelector(`[data-gate-id="${g.id}"]`);
    // ctrl1 line
    const dot1 = board.querySelector(`[data-ctrl-gate-id="${g.id}"][data-ctrl-role="1"]`);
    dotToGateLine(dot1, gateBtn);
    // ctrl2 line (Toffoli only)
    if (THREE_QUBIT.has(g.gate)) {
      const dot2 = board.querySelector(`[data-ctrl-gate-id="${g.id}"][data-ctrl-role="2"]`);
      dotToGateLine(dot2, gateBtn);
    }
  });
}

document.querySelector('.circuit-scroll')?.addEventListener('scroll', drawConnectors);
window.addEventListener('resize', drawConnectors);

// ═════════════════════════════════════════════════════════════════════════════
// ADD GATE
// ═════════════════════════════════════════════════════════════════════════════
function addGate(name, column, target) {
  const total   = Number(el.qubitCount.value);
  const needs3Q = THREE_QUBIT.has(name);
  const needs2Q = TWO_QUBIT.has(name);

  if (column === undefined) column = circuit.length ? Math.max(...circuit.map(g => g.column)) + 1 : 0;
  if (target === undefined) target = 0;

  if (needs3Q && total < 3) { alert('Toffoli (CCX) needs at least 3 qubits.'); return; }
  if (needs2Q && total < 2) { alert('This gate needs at least 2 qubits.'); return; }

  circuit = circuit.filter(g => !(g.column === column && g.target === target));

  let control = -1, control2 = -1;
  if (needs2Q || needs3Q) control  = pickFreeQubit(total, [target]);
  if (needs3Q)            control2 = pickFreeQubit(total, [target, control]);

  circuit.push({
    id:       Date.now() + Math.random(),
    gate:     name,
    column,
    target,
    control,
    control2,
    angle:    ROTATION.has(name) ? Math.PI / 2 : 0,
  });
  renderBoard(); updateMeta();
}

// ═════════════════════════════════════════════════════════════════════════════
// META & PAYLOAD
// ═════════════════════════════════════════════════════════════════════════════
function updateMeta() {
  el.gateCount.textContent    = `${circuit.length} gate${circuit.length === 1 ? '' : 's'}`;
  el.registerMeta.textContent = `${el.qubitCount.value} qubits`;
  el.depthMeta.textContent    = `${circuit.length ? Math.max(...circuit.map(g => g.column)) + 1 : 0} depth`;
  liveFormula();
}
function payload() {
  return {
    qubits:  Number(el.qubitCount.value),
    shots:   Number(el.shots.value),
    backend: selectedBackend,
    states:  qubitStates,
    gates:   circuit,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// LOCAL SIMULATION PREVIEW
// Returns counts keyed by bitstring in q0-left order (same as CUDA-Q server).
// bits[0] = q0, bits[1] = q1, ... bits[n-1] = q(n-1)
// ═════════════════════════════════════════════════════════════════════════════
function localPreview() {
  const shots = Number(el.shots.value);
  const n     = Number(el.qubitCount.value);
  const res   = {};
  for (let s = 0; s < shots; s++) {
    const bits = qubitStates.slice(0, n).map(st => {
      if (st === '1') return 1;
      if (st === '+' || st === '-') return Math.random() < 0.5 ? 0 : 1;
      return 0;
    });
    circuit.slice().sort((a, b) => a.column - b.column).forEach(g => {
      if (g.gate === 'X' || g.gate === 'Y') bits[g.target] ^= 1;
      if (g.gate === 'H' || ROTATION.has(g.gate)) bits[g.target] = Math.random() < 0.5 ? 0 : 1;
      if (g.gate === 'CNOT' && bits[g.control])    bits[g.target] ^= 1;
      if (g.gate === 'SWAP') [bits[g.control], bits[g.target]] = [bits[g.target], bits[g.control]];
      if (g.gate === 'CCX' && bits[g.control] && bits[g.control2]) bits[g.target] ^= 1;
    });
    // q0-left: bits[0]=q0, no reversal needed — matches CUDA-Q server convention
    const key = bits.join('');
    res[key] = (res[key] || 0) + 1;
  }
  return res;
}

// ═════════════════════════════════════════════════════════════════════════════
// SYMBOLIC AMPLITUDE ENGINE
// ═════════════════════════════════════════════════════════════════════════════
function computeStateFormula() {
  const n  = Number(el.qubitCount.value);
  const S2 = 1 / Math.SQRT2;

  function qubitAmps(s) {
    if (s === '1') return [{re:0,im:0},{re:1,im:0}];
    if (s === '+') return [{re:S2,im:0},{re:S2,im:0}];
    if (s === '-') return [{re:S2,im:0},{re:-S2,im:0}];
    return [{re:1,im:0},{re:0,im:0}];
  }

  let state = new Map([['', {re:1,im:0}]]);
  for (let q = 0; q < n; q++) {
    const amps = qubitAmps(qubitStates[q] || '0');
    const next = new Map();
    state.forEach((amp, prefix) => {
      [0,1].forEach(bit => {
        const key  = prefix + bit;
        const a    = amps[bit];
        const re   = amp.re*a.re - amp.im*a.im;
        const im   = amp.re*a.im + amp.im*a.re;
        const prev = next.get(key) || {re:0,im:0};
        next.set(key, {re: prev.re+re, im: prev.im+im});
      });
    });
    state = next;
  }

  for (const g of circuit.slice().sort((a,b) => a.column - b.column)) {
    const next = new Map();
    const t = g.target, c = g.control, c2 = g.control2;
    const add = (nb, re, im) => {
      const prev = next.get(nb) || {re:0,im:0};
      next.set(nb, {re: prev.re+re, im: prev.im+im});
    };

    if (g.gate === 'H') {
      state.forEach((amp, bits) => {
        const b = Number(bits[t]);
        [0,1].forEach(out => {
          const sign = (b===1 && out===1) ? -1 : 1;
          const nb   = bits.substring(0,t)+out+bits.substring(t+1);
          add(nb, S2*sign*amp.re, S2*sign*amp.im);
        });
      });
    } else if (g.gate === 'X') {
      state.forEach((amp, bits) => {
        const nb = bits.substring(0,t)+(bits[t]==='0'?'1':'0')+bits.substring(t+1);
        add(nb, amp.re, amp.im);
      });
    } else if (g.gate === 'Y') {
      state.forEach((amp, bits) => {
        const b  = Number(bits[t]);
        const nb = bits.substring(0,t)+(b?'0':'1')+bits.substring(t+1);
        add(nb, b===0 ? -amp.im : amp.im, b===0 ? amp.re : -amp.re);
      });
    } else if (g.gate === 'Z') {
      state.forEach((amp, bits) => {
        const sign = bits[t]==='1' ? -1 : 1;
        add(bits, sign*amp.re, sign*amp.im);
      });
    } else if (g.gate === 'S') {
      state.forEach((amp, bits) => {
        let re=amp.re, im=amp.im;
        if (bits[t]==='1') { re=-amp.im; im=amp.re; }
        add(bits, re, im);
      });
    } else if (g.gate === 'T') {
      state.forEach((amp, bits) => {
        let re=amp.re, im=amp.im;
        if (bits[t]==='1') { re=S2*(amp.re-amp.im); im=S2*(amp.re+amp.im); }
        add(bits, re, im);
      });
    } else if (g.gate === 'CNOT') {
      state.forEach((amp, bits) => {
        let nb=bits;
        if (bits[c]==='1') nb=bits.substring(0,t)+(bits[t]==='0'?'1':'0')+bits.substring(t+1);
        add(nb, amp.re, amp.im);
      });
    } else if (g.gate === 'CZ') {
      state.forEach((amp, bits) => {
        const sign = (bits[c]==='1' && bits[t]==='1') ? -1 : 1;
        add(bits, sign*amp.re, sign*amp.im);
      });
    } else if (g.gate === 'SWAP') {
      state.forEach((amp, bits) => {
        const arr=[...bits]; [arr[c],arr[t]]=[arr[t],arr[c]];
        add(arr.join(''), amp.re, amp.im);
      });
    } else if (g.gate === 'CCX') {
      // Toffoli: flip target only when both controls are |1⟩
      state.forEach((amp, bits) => {
        let nb=bits;
        if (bits[c]==='1' && bits[c2]==='1')
          nb=bits.substring(0,t)+(bits[t]==='0'?'1':'0')+bits.substring(t+1);
        add(nb, amp.re, amp.im);
      });
    } else {
      state.forEach((amp, bits) => next.set(bits, amp));
    }
    state = next;
  }

  const EPS   = 1e-9;
  const terms = [];
  state.forEach((amp, bits) => {
    const mag2 = amp.re*amp.re+amp.im*amp.im;
    if (mag2 < EPS) return;
    terms.push({ displayBits: bits, re: amp.re, im: amp.im, mag2 });
  });
  terms.sort((a,b) => a.displayBits.localeCompare(b.displayBits));
  if (!terms.length) return buildFormulaHTML([], false, '', 1);

  const S2_POWS   = [1, S2, 0.5, S2*0.5, 0.25];
  const DENOM_LBL = ['', '√2', '2', '2√2', '4'];
  const firstMag  = Math.sqrt(terms[0].mag2);
  let denomLabel='', prefixDenom=1;
  for (let k=1; k<=4; k++) {
    if (Math.abs(firstMag - S2_POWS[k]) < 1e-6) {
      if (terms.every(t => Math.abs(Math.sqrt(t.mag2) - S2_POWS[k]) < 1e-6)) {
        denomLabel = DENOM_LBL[k]; prefixDenom = S2_POWS[k];
      }
      break;
    }
  }
  return buildFormulaHTML(terms, terms.length > 1, denomLabel, prefixDenom);
}

function buildFormulaHTML(terms, isSuper, denomLabel, prefixDenom) {
  const n   = Number(el.qubitCount.value);
  const EPS = 1e-6;
  const S2  = 1/Math.SQRT2;

  const gateNames = [...new Set(circuit.slice().sort((a,b)=>a.column-b.column).map(g=>g.gate))];
  const initLabel = qubitStates.slice(0,n).join('');
  const lhsGate   = circuit.length===1 ? circuit[0].gate : gateNames.join('·');
  const lhsKet    = `|${initLabel}⟩`;
  const lhsHTML   = lhsGate
    ? `<span class="fml-gate">${lhsGate}</span><span class="fml-ket-lhs">${lhsKet}</span>`
    : `<span class="fml-ket-lhs">${lhsKet}</span>`;

  function fmtCoeff(re, im) {
    if (Math.abs(im)<EPS) {
      if (Math.abs(re-1)<EPS) return '';
      if (Math.abs(re+1)<EPS) return '−';
      if (Math.abs(re-S2)<EPS) return '1/√2·';
      if (Math.abs(re+S2)<EPS) return '−1/√2·';
      return re.toFixed(3)+'·';
    }
    if (Math.abs(re)<EPS) {
      if (Math.abs(im-1)<EPS) return 'i·';
      if (Math.abs(im+1)<EPS) return '−i·';
    }
    return `(${re.toFixed(2)}+${im.toFixed(2)}i)·`;
  }

  let numHTML='';
  if (!terms.length) {
    numHTML = `<span class="fml-ket">|0⟩</span>`;
  } else {
    terms.forEach((t,i) => {
      const sRe=denomLabel?t.re/prefixDenom:t.re;
      const sIm=denomLabel?t.im/prefixDenom:t.im;
      const coeff=fmtCoeff(sRe,sIm);
      let sep='';
      if (i>0) sep=(sRe<-EPS||sIm<-EPS)?' − ':' + ';
      const dc=(i>0&&coeff.startsWith('−'))?coeff.slice(1):coeff;
      numHTML+=`${sep}<span class="fml-ket">${dc}|${t.displayBits}⟩</span>`;
    });
  }
  const rhsHTML = denomLabel
    ? `<table class="fml-frac-table" cellspacing="0" cellpadding="0"><tbody>
        <tr><td class="fml-num-cell">${numHTML}</td></tr>
        <tr><td class="fml-den-cell">${denomLabel}</td></tr>
       </tbody></table>`
    : `<span class="fml-inline">${numHTML}</span>`;

  return {
    html: `<span class="fml-lhs">${lhsHTML}</span><span class="fml-equals">=</span><span class="fml-rhs">${rhsHTML}</span>`,
    isSuper,
  };
}

function reverseBits(b) { return b.split('').reverse().join(''); }

function liveFormula() {
  const { html, isSuper } = computeStateFormula();
  el.stateFormula.innerHTML = html;
  el.stateFormula.className = 'state-formula-box'+(isSuper?' is-superposition':'');
}

// ═════════════════════════════════════════════════════════════════════════════
// GPU CONFIRMATION BANNER
// ═════════════════════════════════════════════════════════════════════════════
function updateConfirmBanner(state, backend, isPreview) {
  const b = el.gpuConfirmBanner;
  b.className = 'gpu-confirm-banner';
  if (state === 'hidden') { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  if (!isPreview) {
    const isGpu = backend === 'nvidia';
    b.classList.add('confirmed');
    b.innerHTML = `<span class="gpu-confirm-icon">${isGpu?'⚡':'✓'}</span>
      <span class="gpu-confirm-text">
        <strong>${isGpu?'NVIDIA GPU confirmed':'CPU execution confirmed'}</strong>
        Circuit ran on CUDA-Q backend: <em>${backend}</em>
      </span>`;
  } else {
    b.classList.add('preview');
    const isGpuTarget = backend === 'nvidia';
    b.innerHTML = `<span class="gpu-confirm-icon">⚠</span>
      <span class="gpu-confirm-text">
        <strong>Preview mode — ${isGpuTarget?'NVIDIA GPU not reached':'CUDA-Q not reached'}</strong>
        Results are a local simulation. Connect a CUDA-Q server to run on ${isGpuTarget?'the GPU':backend}.
      </span>`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SHOW RESULTS
// Both localPreview() and CUDA-Q server return bitstrings in q0-left order.
// No reversal needed — display directly.
// ═════════════════════════════════════════════════════════════════════════════
function showResults(counts, note, elapsed=null, backend=selectedBackend, isPreview=false) {
  // Merge counts (both sources already q0-left, no reversal)
  const merged = {};
  Object.entries(counts).forEach(([bits, count]) => {
    merged[bits] = (merged[bits] || 0) + count;
  });
  const entries = Object.entries(merged).sort((a,b) => b[1]-a[1]);
  const max     = entries[0]?.[1] || 1;
  const total   = entries.reduce((s,[,c]) => s+c, 0);
  const n       = entries[0]?.[0].length ?? Number(el.qubitCount.value);

  el.resultEmpty.classList.add('hidden');
  el.resultView.classList.remove('hidden');
  el.compareView.classList.add('hidden');
  el.resultTarget.textContent = `${backend} / CUDA-Q`;
  el.resultShots.textContent  = `${Number(el.shots.value).toLocaleString()} shots`;
  el.resultTime.textContent   = elapsed==null ? 'preview' : `${Number(elapsed).toFixed(2)} ms`;

  updateConfirmBanner(isPreview?'preview':'confirmed', backend, isPreview);

  // ── Colored bar chart ──────────────────────────────────────────────────────
  const topEntries = entries.slice(0, 8);
  el.bars.innerHTML = topEntries.map(([bits, count], i) => {
    const color   = BAR_COLORS[i % BAR_COLORS.length];
    const pct     = (count / total * 100).toFixed(1);
    const fillPct = Math.max(3, count / max * 100);
    return `<div class="bar-row" data-bits="${bits}" style="--bar-color:${color}">
      <span class="bar-label">|${bits}⟩</span>
      <span class="bar-track">
        <span class="bar-fill" style="width:${fillPct}%;background:${color}"></span>
      </span>
      <span class="bar-pct">${pct}%</span>
      <span class="bar-value">${count}</span>
    </div>`;
  }).join('');

  // ── Per-qubit bit breakdown table ─────────────────────────────────────────
  // Header row: state label + one column per qubit (q0 … qN-1)
  const qubitHeaders = Array.from({length: n}, (_, i) =>
    `<th class="bd-qubit-hdr">q${i}</th>`
  ).join('');

  const tableRows = topEntries.map(([bits, count], i) => {
    const color = BAR_COLORS[i % BAR_COLORS.length];
    const pct   = (count / total * 100).toFixed(1);

    // Each character in `bits` is q0…qN-1 (q0 leftmost)
    const cells = bits.split('').map((bit, qi) => {
      const isOne  = bit === '1';
      const cls    = isOne ? 'bd-cell bd-cell--one' : 'bd-cell bd-cell--zero';
      const label  = isOne ? '1' : '0';
      return `<td class="${cls}">${label}</td>`;
    }).join('');

    return `<tr class="bd-row">
      <td class="bd-state">
        <div class="bd-state-inner">
          <span class="bd-swatch" style="background:${color}"></span>|${bits}⟩
        </div>
      </td>
      ${cells}
      <td class="bd-shots">${count}</td>
      <td class="bd-pct">${pct}%</td>
    </tr>`;
  }).join('');

  el.bitBreakdown.innerHTML = `
    <div class="bd-heading">BIT BREAKDOWN</div>
    <div class="bd-convention">Convention: q0 (leftmost) → q${n-1} (rightmost)</div>
    <div class="bd-scroll">
      <table class="bd-table">
        <thead>
          <tr>
            <th class="bd-state-hdr">State</th>
            ${qubitHeaders}
            <th class="bd-shots-hdr">Shots</th>
            <th class="bd-pct-hdr">%</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;

  el.mostLikely.textContent = entries[0] ? `|${entries[0][0]}⟩` : '--';
  el.resultNote.textContent = note;
  if (!resultsOpen) { resultsOpen=true; updateWorkspaceLayout(); }
}

// ═════════════════════════════════════════════════════════════════════════════
// RUN + COMPARE
// ═════════════════════════════════════════════════════════════════════════════
async function runCircuit() {
  el.runButton.disabled=true; el.runButton.textContent='Running…';
  el.connectionState.textContent=`Executing on ${selectedBackend}`;
  try {
    const res=await fetch('/api/run',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload()),
    });
    if (!res.ok) throw new Error();
    const data=await res.json();
    if (data.error) throw new Error(data.error);
    showResults(data.counts,`Confirmed: CUDA-Q on ${data.backend||selectedBackend}`,data.elapsed_ms,data.backend||selectedBackend,false);
  } catch {
    showResults(localPreview(),`Preview — CUDA-Q ${selectedBackend} not reached`,null,selectedBackend,true);
  } finally {
    el.runButton.disabled=false;
    el.runButton.innerHTML='<span class="run-symbol">▶</span> Run circuit';
    el.connectionState.textContent='Local editor';
  }
}

async function compareTargets() {
  el.compareButton.disabled=true; el.compareButton.textContent='Comparing…';
  const rows=[];
  for (const backend of ['qpp-cpu','nvidia']) {
    const t0=performance.now();
    try {
      const res=await fetch('/api/run',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload(),backend}),
      });
      if (!res.ok) throw new Error();
      const data=await res.json();
      if (data.error) throw new Error();
      rows.push({backend,elapsed:data.elapsed_ms??performance.now()-t0,status:'CUDA-Q confirmed'});
    } catch {
      rows.push({backend,elapsed:performance.now()-t0,status:'Unavailable'});
    }
  }
  el.resultEmpty.classList.add('hidden');
  el.resultView.classList.add('hidden');
  el.compareView.classList.remove('hidden');
  el.compareRows.innerHTML=rows.map(r=>
    `<div class="compare-row"><strong>${r.backend}</strong><span>${Number(r.elapsed).toFixed(1)} ms</span><small>${r.status}</small></div>`
  ).join('');
  el.compareButton.disabled=false; el.compareButton.textContent='▶▶ Compare targets';
  if (!resultsOpen) { resultsOpen=true; updateWorkspaceLayout(); }
}

// ═════════════════════════════════════════════════════════════════════════════
// EVENT WIRING
// ═════════════════════════════════════════════════════════════════════════════
el.runButton.addEventListener('click', runCircuit);
el.compareButton.addEventListener('click', compareTargets);

el.qubitCount.addEventListener('change', e => {
  const val=Math.min(29,Math.max(1,Number(e.target.value)||1));
  e.target.value=val;
  snapshot();
  qubitStates=Array.from({length:val},(_,i)=>qubitStates[i]||'0');
  circuit=circuit.filter(g=>
    g.target < val &&
    (g.control  < 0 || g.control  < val) &&
    (g.control2 == null || g.control2 < 0 || g.control2 < val)
  );
  if (activeQubit!==null && activeQubit>=val) activeQubit=null;
  renderStates(); renderBoard(); updateMeta(); updateActiveQubitHint();
});

document.querySelectorAll('[data-step]').forEach(btn=>
  btn.addEventListener('click',()=>{
    el.qubitCount.value=Number(el.qubitCount.value)+Number(btn.dataset.step);
    el.qubitCount.dispatchEvent(new Event('change'));
  })
);
document.querySelectorAll('.target-option').forEach(btn=>
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.target-option').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); selectedBackend=btn.dataset.backend;
  })
);

el.clearButton.addEventListener('click',()=>{
  snapshot();
  circuit=[]; qubitStates=Array.from({length:Number(el.qubitCount.value)},()=>'0');
  activeQubit=null;
  renderStates(); renderBoard(); updateMeta(); updateActiveQubitHint();
  el.resultEmpty.classList.remove('hidden');
  el.resultView.classList.add('hidden');
  el.compareView.classList.add('hidden');
  el.mostLikely.textContent='--';
  updateConfirmBanner('hidden',selectedBackend,false);
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag=document.activeElement?.tagName??'';
  const typing=tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA';
  if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&(e.key==='z'||e.key==='Z'))  { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||e.key==='Y'))                { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey||e.metaKey)&&(e.key==='d'||e.key==='D'))                { e.preventDefault(); toggleTheme(); return; }
  if ((e.ctrlKey||e.metaKey)&&(e.key==='l'||e.key==='L'))                { e.preventDefault(); el.clearButton.click(); return; }
  if (e.key==='Escape')   { closeHelp(); activeQubit=null; updateActiveQubitHint(); renderStateButtonHighlights(); return; }
  if (e.key==='F1'||(!typing&&e.key==='?')) { e.preventDefault(); openHelp(); return; }
  if (!typing&&e.key==='Enter') { e.preventDefault(); runCircuit(); return; }
});

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  el.clock.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
updateClock(); setInterval(updateClock, 30_000);

// ── Boot ──────────────────────────────────────────────────────────────────────
renderPalette(); renderStates(); renderBoard(); updateMeta(); syncUndoButtons(); updateActiveQubitHint();

}); // end DOMContentLoaded
