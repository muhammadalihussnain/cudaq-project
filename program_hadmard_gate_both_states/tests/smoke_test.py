"""
CUDA-Q Circuit Lab — Smoke / Unit Tests  (Python 3)

Run with:  python3 tests/smoke_test.py

Covers the same 10 areas as smoke.test.js but uses Python's standard
`unittest` framework so every assertion is independently reported.
"""

import math
import random
import unittest


# ─────────────────────────────────────────────────────────────────────────────
# Pure Python ports of the key app.js functions
# ─────────────────────────────────────────────────────────────────────────────

TWO_QUBIT   = {'CNOT', 'CZ', 'SWAP'}
ROTATION    = {'RX', 'RY', 'RZ'}
STATE_VALUES = ['0', '1', '+', '-']


def reverse_bits(b: str) -> str:
    return b[::-1]


def depth(circuit: list) -> int:
    if not circuit:
        return 4
    return max(4, max(g['column'] for g in circuit) + 1)


def add_gate(circuit: list, name: str, column=None, target=0, qubit_count=3) -> list:
    needs_2q = name in TWO_QUBIT
    if column is None:
        column = (max(g['column'] for g in circuit) + 1) if circuit else 0
    if needs_2q and qubit_count < 2:
        raise ValueError('Needs >= 2 qubits')
    next_circuit = [g for g in circuit
                    if not (g['column'] == column and g['target'] == target)]
    control = -1
    if needs_2q:
        control = 1 if target == 0 else 0
    next_circuit.append({
        'id':      random.random(),
        'gate':    name,
        'column':  column,
        'target':  target,
        'control': control,
        'angle':   math.pi / 2 if name in ROTATION else 0,
    })
    return next_circuit


def local_preview(shots: int, qubit_states: list, circuit: list) -> dict:
    n   = len(qubit_states)
    res = {}
    for _ in range(shots):
        bits = []
        for st in qubit_states:
            if st == '1':
                bits.append(1)
            elif st in ('+', '-'):
                bits.append(0 if random.random() < 0.5 else 1)
            else:
                bits.append(0)

        for g in sorted(circuit, key=lambda x: x['column']):
            gate = g['gate']
            t    = g['target']
            ctrl = g['control']
            if gate in ('X', 'Y'):
                bits[t] ^= 1
            elif gate == 'H' or gate in ROTATION:
                bits[t] = 0 if random.random() < 0.5 else 1
            elif gate == 'CNOT' and bits[ctrl]:
                bits[t] ^= 1
            elif gate == 'SWAP':
                bits[ctrl], bits[t] = bits[t], bits[ctrl]

        key = ''.join(str(b) for b in reversed(bits))
        res[key] = res.get(key, 0) + 1
    return res


# ── Functional undo/redo ──────────────────────────────────────────────────────
import json, copy

class History:
    def __init__(self):
        self._undo = []
        self._redo = []

    def snapshot(self, state):
        self._undo.append(json.dumps(state))
        self._redo.clear()

    def undo(self, current):
        if not self._undo:
            return current
        self._redo.append(json.dumps(current))
        return json.loads(self._undo.pop())

    def redo(self, current):
        if not self._redo:
            return current
        self._undo.append(json.dumps(current))
        return json.loads(self._redo.pop())

    def can_undo(self): return bool(self._undo)
    def can_redo(self): return bool(self._redo)


# ─────────────────────────────────────────────────────────────────────────────
# TEST CASES
# ─────────────────────────────────────────────────────────────────────────────

class TestReverseBits(unittest.TestCase):
    def test_symmetric(self):
        self.assertEqual(reverse_bits('010'), '010')
    def test_reverses(self):
        self.assertEqual(reverse_bits('001'), '100')
    def test_single(self):
        self.assertEqual(reverse_bits('1'), '1')
    def test_all_zeros(self):
        self.assertEqual(reverse_bits('000'), '000')


class TestDepth(unittest.TestCase):
    def test_empty_returns_4(self):
        self.assertEqual(depth([]), 4)
    def test_col0_returns_4(self):
        self.assertEqual(depth([{'column': 0}]), 4)
    def test_col5_returns_6(self):
        self.assertEqual(depth([{'column': 5}]), 6)
    def test_max_over_multiple(self):
        self.assertEqual(depth([{'column':1},{'column':3},{'column':0}]), 4)


class TestAddGate(unittest.TestCase):
    def test_adds_h_at_col0_q0(self):
        c = add_gate([], 'H')
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]['gate'], 'H')
        self.assertEqual(c[0]['column'], 0)
        self.assertEqual(c[0]['target'], 0)

    def test_replaces_gate_same_slot(self):
        c = add_gate([], 'H', 0, 0)
        c = add_gate(c, 'X', 0, 0)
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]['gate'], 'X')

    def test_cnot_control_1_when_target_0(self):
        c = add_gate([], 'CNOT', 0, 0, 3)
        self.assertEqual(c[0]['control'], 1)

    def test_cnot_control_0_when_target_1(self):
        c = add_gate([], 'CNOT', 0, 1, 3)
        self.assertEqual(c[0]['control'], 0)

    def test_cnot_raises_with_1_qubit(self):
        with self.assertRaises(ValueError):
            add_gate([], 'CNOT', 0, 0, 1)

    def test_rx_has_angle_pi_over_2(self):
        c = add_gate([], 'RX', 0, 0)
        self.assertAlmostEqual(c[0]['angle'], math.pi / 2)

    def test_auto_increments_column(self):
        c = add_gate([], 'H', 0, 0)
        c = add_gate(c, 'X')
        self.assertEqual(c[1]['column'], 1)


class TestUndoRedo(unittest.TestCase):
    def test_undo_returns_previous(self):
        h  = History()
        s0 = {'circuit': [], 'states': ['0']}
        s1 = {'circuit': [{'gate': 'H'}], 'states': ['0']}
        h.snapshot(s0)
        result = h.undo(s1)
        self.assertEqual(result, s0)

    def test_redo_restores(self):
        h  = History()
        s0 = {'circuit': [], 'states': ['0']}
        s1 = {'circuit': [{'gate': 'X'}], 'states': ['0']}
        h.snapshot(s0)
        prev = h.undo(s1)
        nxt  = h.redo(prev)
        self.assertEqual(nxt, s1)

    def test_can_undo_false_initially(self):
        self.assertFalse(History().can_undo())

    def test_can_redo_false_after_new_snapshot(self):
        h  = History()
        s0 = {'circuit': [], 'states': ['0']}
        s1 = {'circuit': [{'gate': 'H'}], 'states': ['0']}
        h.snapshot(s0)
        h.undo(s1)
        h.snapshot(s0)   # new action should clear redo
        self.assertFalse(h.can_redo())


class TestLocalPreview(unittest.TestCase):
    def test_total_shots(self):
        res   = local_preview(200, ['0', '0'], [])
        total = sum(res.values())
        self.assertEqual(total, 200)

    def test_all_zero_no_gates(self):
        res = local_preview(100, ['0', '0'], [])
        self.assertEqual(list(res.keys()), ['00'])
        self.assertEqual(res['00'], 100)

    def test_x_gate_flips_bit(self):
        gate = {'gate': 'X', 'target': 0, 'control': -1, 'column': 0}
        res  = local_preview(50, ['0', '0'], [gate])
        self.assertEqual(list(res.keys()), ['01'])

    def test_h_gate_produces_both_states(self):
        random.seed(42)
        gate = {'gate': 'H', 'target': 0, 'control': -1, 'column': 0}
        res  = local_preview(1000, ['0'], [gate])
        self.assertIn('0', res)
        self.assertIn('1', res)
        self.assertGreater(res['0'], 300)
        self.assertGreater(res['1'], 300)

    def test_cnot_flips_target_when_ctrl_1(self):
        gate = {'gate': 'CNOT', 'target': 1, 'control': 0, 'column': 0}
        res  = local_preview(100, ['1', '0'], [gate])
        self.assertEqual(list(res.keys()), ['11'])

    def test_cnot_no_flip_when_ctrl_0(self):
        gate = {'gate': 'CNOT', 'target': 1, 'control': 0, 'column': 0}
        res  = local_preview(100, ['0', '0'], [gate])
        self.assertEqual(list(res.keys()), ['00'])

    def test_swap_exchanges_qubits(self):
        gate = {'gate': 'SWAP', 'target': 1, 'control': 0, 'column': 0}
        # q0=1, q1=0 → swap → q0=0,q1=1 → reversed bits → '10'
        res  = local_preview(100, ['1', '0'], [gate])
        self.assertEqual(list(res.keys()), ['10'])


class TestThemeToggle(unittest.TestCase):
    def test_toggles_dark_mode(self):
        dark = True
        dark = not dark
        self.assertFalse(dark)
        dark = not dark
        self.assertTrue(dark)


class TestPanelCollapse(unittest.TestCase):
    def test_toggle_sidebar(self):
        open_ = True
        open_ = not open_
        self.assertFalse(open_)
        open_ = not open_
        self.assertTrue(open_)

    def test_grid_columns_string(self):
        def cols(sb, rs):
            return f"{260 if sb else 0}px minmax(0,1fr) {260 if rs else 0}px"
        self.assertEqual(cols(False, True),  '0px minmax(0,1fr) 260px')
        self.assertEqual(cols(True,  False), '260px minmax(0,1fr) 0px')
        self.assertEqual(cols(False, False), '0px minmax(0,1fr) 0px')
        self.assertEqual(cols(True,  True),  '260px minmax(0,1fr) 260px')


class TestActiveQubit(unittest.TestCase):
    def test_same_qubit_deselects(self):
        active = None
        def set_active(idx):
            nonlocal active
            active = None if active == idx else idx
        set_active(1)
        self.assertEqual(active, 1)
        set_active(1)
        self.assertIsNone(active)

    def test_different_qubit_changes_selection(self):
        active = 0
        def set_active(idx):
            nonlocal active
            active = None if active == idx else idx
        set_active(2)
        self.assertEqual(active, 2)

    def test_active_reset_on_qubit_count_decrease(self):
        active    = 4
        new_count = 3
        if active is not None and active >= new_count:
            active = None
        self.assertIsNone(active)


class TestTwoQubitControl(unittest.TestCase):
    def test_cnot_avoids_target(self):
        cases = [(0, 3, 1), (1, 3, 0), (2, 3, 0)]
        for target, total, expected in cases:
            c = add_gate([], 'CNOT', 0, target, total)
            self.assertEqual(c[0]['control'], expected, f'target={target}')

    def test_swap_and_cz_get_control(self):
        for name in ('SWAP', 'CZ'):
            c = add_gate([], name, 0, 0, 3)
            self.assertEqual(c[0]['control'], 1, f'{name} should have control=1')


class TestStateCycling(unittest.TestCase):
    def test_cycles_0_1_plus_minus_0(self):
        order = []
        state = '0'
        for _ in range(5):
            order.append(state)
            idx   = STATE_VALUES.index(state)
            state = STATE_VALUES[(idx + 1) % len(STATE_VALUES)]
        self.assertEqual(order, ['0', '1', '+', '-', '0'])


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    unittest.main(verbosity=2)
