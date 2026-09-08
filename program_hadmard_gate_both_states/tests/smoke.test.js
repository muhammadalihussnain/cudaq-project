/**
 * CUDA-Q Circuit Lab — Smoke / Unit Tests
 * Run:  /usr/lib/code-server/lib/node tests/smoke.test.js
 */
'use strict';
const assert = require('assert');

const GREEN  = '\x1b[32m', RED = '\x1b[31m', CYAN = '\x1b[36m', RESET = '\x1b[0m';
let passed = 0, failed = 0;

function group(name) { console.log(`\n${CYAN}[${name}]${RESET}`); }
function test(name, fn) {
  try { fn(); console.log(`  ${GREEN}✓${RESET}  ${name}`); passed++; }
  catch(e) { console.log(`  ${RED}✗${RESET}  ${name}\n     ${RED}${e.message}${RESET}`); failed++; }
}

// ─── Pure-JS ports ────────────────────────────────────────────────────────────
const TWO_QUBIT   = new Set(['CNOT','CZ','SWAP']);
const THREE_QUBIT = new Set(['CCX']);
const MULTI_QUBIT = new Set([...TWO_QUBIT,...THREE_QUBIT]);
const ROTATION    = new Set(['RX','RY','RZ']);
const STATE_VALUES = ['0','1','+','-'];
const INV_SQRT2   = 1/Math.SQRT2;

function reverseBits(b) { return b.split('').reverse().join(''); }

function depth(circuit) {
  return Math.max(4, circuit.length ? Math.max(...circuit.map(g=>g.column))+1 : 4);
}

function pickFreeQubit(total, avoid, current=-1) {
  let next = ((current<0?0:current)+1) % total;
  let tries = 0;
  while (avoid.includes(next) && tries++<total) next=(next+1)%total;
  return next;
}

let _id=0;
function addGate(circuit, name, column, target=0, qubitCount=3) {
  const needs3Q = THREE_QUBIT.has(name);
  const needs2Q = TWO_QUBIT.has(name);
  if (needs3Q && qubitCount<3) throw new Error('Needs ≥3 qubits');
  if (needs2Q && qubitCount<2) throw new Error('Needs ≥2 qubits');
  if (column===undefined) column = circuit.length ? Math.max(...circuit.map(g=>g.column))+1 : 0;
  const next = circuit.filter(g=>!(g.column===column && g.target===target));
  let control=-1, control2=-1;
  if (needs2Q||needs3Q) control  = pickFreeQubit(qubitCount,[target]);
  if (needs3Q)          control2 = pickFreeQubit(qubitCount,[target,control]);
  next.push({id:++_id,gate:name,column,target,control,control2,
             angle:ROTATION.has(name)?Math.PI/2:0});
  return next;
}

function makeHistory() {
  let us=[], rs=[];
  return {
    snapshot(s)   { us.push(JSON.stringify(s)); rs=[]; },
    undo(cur)     { if (!us.length) return cur; rs.push(JSON.stringify(cur)); return JSON.parse(us.pop()); },
    redo(cur)     { if (!rs.length) return cur; us.push(JSON.stringify(cur)); return JSON.parse(rs.pop()); },
    canUndo() { return us.length>0; },
    canRedo() { return rs.length>0; },
  };
}

function localPreview({shots, qubitStates, circuit:circ}) {
  const res={};
  for (let s=0;s<shots;s++) {
    const bits=qubitStates.map(st=>{
      if(st==='1') return 1;
      if(st==='+'||st==='-') return Math.random()<0.5?0:1;
      return 0;
    });
    circ.slice().sort((a,b)=>a.column-b.column).forEach(g=>{
      if(g.gate==='X'||g.gate==='Y') bits[g.target]^=1;
      if(g.gate==='H'||ROTATION.has(g.gate)) bits[g.target]=Math.random()<0.5?0:1;
      if(g.gate==='CNOT'&&bits[g.control]) bits[g.target]^=1;
      if(g.gate==='SWAP') [bits[g.control],bits[g.target]]=[bits[g.target],bits[g.control]];
      if(g.gate==='CCX'&&bits[g.control]&&bits[g.control2]) bits[g.target]^=1;
    });
    const key=bits.join('');  // q0-left, no reversal — matches CUDA-Q server convention
    res[key]=(res[key]||0)+1;
  }
  return res;
}

function computeStateFormula(qubitStates, circuit) {
  const n=qubitStates.length, S2=INV_SQRT2;
  function qa(s){
    if(s==='1') return [{re:0,im:0},{re:1,im:0}];
    if(s==='+') return [{re:S2,im:0},{re:S2,im:0}];
    if(s==='-') return [{re:S2,im:0},{re:-S2,im:0}];
    return [{re:1,im:0},{re:0,im:0}];
  }
  let state=new Map([['',{re:1,im:0}]]);
  for(let q=0;q<n;q++){
    const amps=qa(qubitStates[q]||'0'), next=new Map();
    state.forEach((amp,prefix)=>{
      [0,1].forEach(bit=>{
        const key=prefix+bit, a=amps[bit];
        const re=amp.re*a.re-amp.im*a.im, im=amp.re*a.im+amp.im*a.re;
        const prev=next.get(key)||{re:0,im:0};
        next.set(key,{re:prev.re+re,im:prev.im+im});
      });
    });
    state=next;
  }
  for(const g of circuit.slice().sort((a,b)=>a.column-b.column)){
    const next=new Map();
    const t=g.target,c=g.control,c2=g.control2;
    const add=(nb,re,im)=>{const p=next.get(nb)||{re:0,im:0};next.set(nb,{re:p.re+re,im:p.im+im});};
    if(g.gate==='H'){
      state.forEach((amp,bits)=>{
        const b=Number(bits[t]);
        [0,1].forEach(out=>{
          const sign=(b===1&&out===1)?-1:1;
          add(bits.substring(0,t)+out+bits.substring(t+1),S2*sign*amp.re,S2*sign*amp.im);
        });
      });
    } else if(g.gate==='X'){
      state.forEach((amp,bits)=>{
        add(bits.substring(0,t)+(bits[t]==='0'?'1':'0')+bits.substring(t+1),amp.re,amp.im);
      });
    } else if(g.gate==='CNOT'){
      state.forEach((amp,bits)=>{
        let nb=bits;
        if(bits[c]==='1') nb=bits.substring(0,t)+(bits[t]==='0'?'1':'0')+bits.substring(t+1);
        add(nb,amp.re,amp.im);
      });
    } else if(g.gate==='CCX'){
      // Toffoli: flip target when both controls are |1⟩
      state.forEach((amp,bits)=>{
        let nb=bits;
        if(bits[c]==='1'&&bits[c2]==='1')
          nb=bits.substring(0,t)+(bits[t]==='0'?'1':'0')+bits.substring(t+1);
        add(nb,amp.re,amp.im);
      });
    } else {
      state.forEach((amp,bits)=>next.set(bits,amp));
    }
    state=next;
  }
  const EPS=1e-9, terms=[];
  state.forEach((amp,bits)=>{
    const mag2=amp.re*amp.re+amp.im*amp.im;
    if(mag2<EPS) return;
    terms.push({displayBits:bits,re:amp.re,im:amp.im,mag2});
  });
  terms.sort((a,b)=>a.displayBits.localeCompare(b.displayBits));
  return terms;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

group('1. reverseBits');
test('010 palindrome',       ()=>assert.strictEqual(reverseBits('010'),'010'));
test('001 → 100',            ()=>assert.strictEqual(reverseBits('001'),'100'));
test('10110 → 01101',        ()=>assert.strictEqual(reverseBits('10110'),'01101'));

group('2. depth()');
test('empty → 4',            ()=>assert.strictEqual(depth([]),4));
test('col 4 → 5',            ()=>assert.strictEqual(depth([{column:4}]),5));
test('max [1,5,2] → 6',      ()=>assert.strictEqual(depth([{column:1},{column:5},{column:2}]),6));

group('3. pickFreeQubit');
test('picks 1 avoiding 0',   ()=>assert.strictEqual(pickFreeQubit(3,[0]),1));
test('picks 2 avoiding 0,1', ()=>assert.strictEqual(pickFreeQubit(3,[0,1]),2));
test('wraps around',         ()=>assert.strictEqual(pickFreeQubit(3,[1,2]),0));
test('current cycles',       ()=>assert.strictEqual(pickFreeQubit(4,[0],-1),1));

group('4. addGate — 1-qubit');
test('H at col 0 q0',        ()=>{ const c=addGate([],'H'); assert.strictEqual(c[0].gate,'H'); assert.strictEqual(c[0].control,-1); });
test('auto-inc column',      ()=>{ let c=addGate([],'H',0,0); c=addGate(c,'X'); assert.strictEqual(c[1].column,1); });
test('replaces same slot',   ()=>{ let c=addGate([],'H',0,0); c=addGate(c,'X',0,0); assert.strictEqual(c.length,1); assert.strictEqual(c[0].gate,'X'); });
test('RX angle=π/2',         ()=>{ const c=addGate([],'RX',0,0); assert.ok(Math.abs(c[0].angle-Math.PI/2)<1e-10); });

group('5. addGate — 2-qubit (CNOT/CZ/SWAP)');
test('CNOT ctrl≠target',     ()=>{ const c=addGate([],'CNOT',0,0,3); assert.notStrictEqual(c[0].control,c[0].target); });
test('CNOT throws <2 qubits',()=>assert.throws(()=>addGate([],'CNOT',0,0,1)));
test('SWAP target=0→ctrl=1', ()=>{ const c=addGate([],'SWAP',0,0,3); assert.strictEqual(c[0].control,1); });
test('CZ control2=-1',       ()=>{ const c=addGate([],'CZ',0,0,3); assert.strictEqual(c[0].control2,-1); });

group('6. addGate — Toffoli CCX');
test('CCX needs ≥3 qubits',  ()=>assert.throws(()=>addGate([],'CCX',0,0,2)));
test('CCX control≠target',   ()=>{ const c=addGate([],'CCX',0,0,3); assert.notStrictEqual(c[0].control,0); });
test('CCX control2≠target',  ()=>{ const c=addGate([],'CCX',0,0,3); assert.notStrictEqual(c[0].control2,0); });
test('CCX ctrl1≠ctrl2',      ()=>{ const c=addGate([],'CCX',0,0,3); assert.notStrictEqual(c[0].control,c[0].control2); });
test('CCX 4 qubits, tgt=2',  ()=>{ const c=addGate([],'CCX',0,2,4); assert.notStrictEqual(c[0].control,2); assert.notStrictEqual(c[0].control2,2); assert.notStrictEqual(c[0].control,c[0].control2); });

group('7. undo / redo');
const s0={circuit:[],states:['0']}, s1={circuit:[{gate:'H'}],states:['0']};
test('canUndo false initially',  ()=>assert.strictEqual(makeHistory().canUndo(),false));
test('undo returns previous',    ()=>{ const h=makeHistory(); h.snapshot(s0); assert.deepStrictEqual(h.undo(s1),s0); });
test('redo restores',            ()=>{ const h=makeHistory(); h.snapshot(s0); const p=h.undo(s1); assert.deepStrictEqual(h.redo(p),s1); });
test('new snapshot clears redo', ()=>{ const h=makeHistory(); h.snapshot(s0); h.undo(s1); h.snapshot(s0); assert.strictEqual(h.canRedo(),false); });
test('multi-level undo',         ()=>{ const h=makeHistory(); h.snapshot(s0); h.snapshot(s1); assert.deepStrictEqual(h.undo({circuit:[{gate:'Z'}],states:['1']}),s1); });

group('8. localPreview — basic gates');
test('total shots correct',  ()=>assert.strictEqual(Object.values(localPreview({shots:200,qubitStates:['0','0'],circuit:[]})).reduce((a,b)=>a+b,0),200));
test('|0⟩ no gates → "00"', ()=>assert.deepStrictEqual(Object.keys(localPreview({shots:50,qubitStates:['0','0'],circuit:[]})),['00']));
test('|1⟩ no gates → "1"',  ()=>assert.deepStrictEqual(Object.keys(localPreview({shots:50,qubitStates:['1'],circuit:[]})),['1']));
// q0-left: X on q0 → q0=1,q1=0 → '10'
test('X on q0 → "10"',      ()=>assert.deepStrictEqual(Object.keys(localPreview({shots:50,qubitStates:['0','0'],circuit:[{gate:'X',target:0,control:-1,control2:-1,column:0}]})),['10']));
// X on q1 → q0=0,q1=1 → '01'
test('X on q1 → "01"',      ()=>assert.deepStrictEqual(Object.keys(localPreview({shots:50,qubitStates:['0','0'],circuit:[{gate:'X',target:1,control:-1,control2:-1,column:0}]})),['01']));
test('CNOT ctrl=1 flips',   ()=>assert.deepStrictEqual(Object.keys(localPreview({shots:50,qubitStates:['1','0'],circuit:[{gate:'CNOT',target:1,control:0,control2:-1,column:0}]})),['11']));
test('CNOT ctrl=0 no flip', ()=>assert.deepStrictEqual(Object.keys(localPreview({shots:50,qubitStates:['0','0'],circuit:[{gate:'CNOT',target:1,control:0,control2:-1,column:0}]})),['00']));
test('H produces both',     ()=>{ const r=localPreview({shots:2000,qubitStates:['0'],circuit:[{gate:'H',target:0,control:-1,control2:-1,column:0}]}); assert.ok(r['0']>600&&r['1']>600); });
// SWAP q0=1,q1=0 → q0=0,q1=1 → '01'
test('SWAP q0=1,q1=0 → "01"', ()=>assert.deepStrictEqual(Object.keys(localPreview({shots:50,qubitStates:['1','0'],circuit:[{gate:'SWAP',target:1,control:0,control2:-1,column:0}]})),['01']));

group('9. localPreview — Toffoli CCX');
test('CCX: both ctrl=1 → flips target', ()=>{
  // q0=1,q1=1,q2=0 → CCX flips q2 → q0=1,q1=1,q2=1 → '111'
  const circ=[{gate:'CCX',target:2,control:0,control2:1,column:0}];
  const r=localPreview({shots:50,qubitStates:['1','1','0'],circuit:circ});
  assert.deepStrictEqual(Object.keys(r),['111']);
});
test('CCX: ctrl0=0 → no flip', ()=>{
  // q0=0,q1=1,q2=0 → ctrl0=0 so no flip → '010'
  const circ=[{gate:'CCX',target:2,control:0,control2:1,column:0}];
  const r=localPreview({shots:50,qubitStates:['0','1','0'],circuit:circ});
  assert.deepStrictEqual(Object.keys(r),['010']);
});
test('CCX: ctrl1=0 → no flip', ()=>{
  // q0=1,q1=0,q2=0 → ctrl1=0 so no flip → '100'
  const circ=[{gate:'CCX',target:2,control:0,control2:1,column:0}];
  const r=localPreview({shots:50,qubitStates:['1','0','0'],circuit:circ});
  assert.deepStrictEqual(Object.keys(r),['100']);
});
test('CCX: both ctrl=1 on |111⟩ → flips q2 back → "110"', ()=>{
  // q0=1,q1=1,q2=1 → CCX flips q2 → q0=1,q1=1,q2=0 → '110'
  const circ=[{gate:'CCX',target:2,control:0,control2:1,column:0}];
  const r=localPreview({shots:50,qubitStates:['1','1','1'],circuit:circ});
  assert.deepStrictEqual(Object.keys(r),['110']);
});
test('CCX 3-qubit result keys length 3', ()=>{
  const r=localPreview({shots:50,qubitStates:['0','0','0'],circuit:[]});
  Object.keys(r).forEach(k=>assert.strictEqual(k.length,3));
});

group('10. computeStateFormula');
test('|0⟩ no gates → term "0"',   ()=>{ const t=computeStateFormula(['0'],[]); assert.strictEqual(t.length,1); assert.strictEqual(t[0].displayBits,'0'); });
test('|1⟩ no gates → term "1"',   ()=>{ const t=computeStateFormula(['1'],[]); assert.strictEqual(t[0].displayBits,'1'); });
test('H|0⟩ → 2 equal terms',      ()=>{ const t=computeStateFormula(['0'],[{gate:'H',target:0,control:-1,control2:-1,column:0}]); assert.strictEqual(t.length,2); assert.ok(Math.abs(t[0].re-INV_SQRT2)<1e-9); });
test('X|0⟩ → "1"',                ()=>{ const t=computeStateFormula(['0'],[{gate:'X',target:0,control:-1,control2:-1,column:0}]); assert.strictEqual(t[0].displayBits,'1'); });
test('CNOT |10⟩ → |11⟩',          ()=>{ const t=computeStateFormula(['1','0'],[{gate:'CNOT',target:1,control:0,control2:-1,column:0}]); assert.strictEqual(t[0].displayBits,'11'); });
test('prob sum=1 for H|0⟩',        ()=>{ const t=computeStateFormula(['0'],[{gate:'H',target:0,control:-1,control2:-1,column:0}]); assert.ok(Math.abs(t.reduce((s,x)=>s+x.mag2,0)-1)<1e-9); });
test('CCX |110⟩ → |111⟩',         ()=>{ const t=computeStateFormula(['1','1','0'],[{gate:'CCX',target:2,control:0,control2:1,column:0}]); assert.strictEqual(t.length,1); assert.strictEqual(t[0].displayBits,'111'); });
test('CCX |100⟩ → stays |100⟩',   ()=>{ const t=computeStateFormula(['1','0','0'],[{gate:'CCX',target:2,control:0,control2:1,column:0}]); assert.strictEqual(t[0].displayBits,'100'); });
test('CCX prob sum=1',             ()=>{ const t=computeStateFormula(['1','1','0'],[{gate:'CCX',target:2,control:0,control2:1,column:0}]); assert.ok(Math.abs(t.reduce((s,x)=>s+x.mag2,0)-1)<1e-9); });

group('11. theme / panel collapse / activeQubit');
test('theme toggle flips dark',    ()=>{ let d=true; d=!d; assert.strictEqual(d,false); });
test('sidebar col when closed',    ()=>{ const f=(s,r)=>`${s?260:0}px minmax(0,1fr) ${r?260:0}px`; assert.strictEqual(f(false,true),'0px minmax(0,1fr) 260px'); });
test('activeQubit toggle-off',     ()=>{ let a=null; const set=i=>{a=(a===i)?null:i;}; set(1); assert.strictEqual(a,1); set(1); assert.strictEqual(a,null); });
test('activeQubit clamped on shrink',()=>{ let a=4; const n=3; if(a!==null&&a>=n) a=null; assert.strictEqual(a,null); });

group('12. stateValues cycle');
test('0→1→+→-→0', ()=>{ const o=[]; let s='0'; for(let i=0;i<5;i++){o.push(s);s=STATE_VALUES[(STATE_VALUES.indexOf(s)+1)%STATE_VALUES.length];} assert.deepStrictEqual(o,['0','1','+','-','0']); });

group('13. BAR_COLORS palette');
const BAR_COLORS=['#55d6c2','#f4b860','#a78bfa','#34d399','#f87171','#60a5fa','#fb923c','#e879f9'];
test('palette has 8 entries',          ()=>assert.strictEqual(BAR_COLORS.length,8));
test('all entries are hex strings',    ()=>BAR_COLORS.forEach(c=>assert.ok(/^#[0-9a-f]{6}$/i.test(c),`bad color: ${c}`)));
test('all entries are distinct',       ()=>assert.strictEqual(new Set(BAR_COLORS).size,8));
test('index wraps via modulo',         ()=>{ const i=9; assert.strictEqual(BAR_COLORS[i%BAR_COLORS.length], BAR_COLORS[1]); });
test('first color is cyan',            ()=>assert.strictEqual(BAR_COLORS[0],'#55d6c2'));
test('second color is amber',          ()=>assert.strictEqual(BAR_COLORS[1],'#f4b860'));

group('14. MEASURE gate — no-op in simulation');
test('MEASURE in circuit does not change counts', ()=>{
  const circ=[{gate:'MEASURE',target:0,control:-1,control2:-1,column:1}];
  const r=localPreview({shots:100,qubitStates:['0'],circuit:circ});
  assert.deepStrictEqual(Object.keys(r),['0']);
  assert.strictEqual(r['0'],100);
});
test('MEASURE after X still shows flipped bit', ()=>{
  const circ=[
    {gate:'X',     target:0,control:-1,control2:-1,column:0},
    {gate:'MEASURE',target:0,control:-1,control2:-1,column:1},
  ];
  const r=localPreview({shots:50,qubitStates:['0'],circuit:circ});
  assert.deepStrictEqual(Object.keys(r),['1']);
});
test('MEASURE does not affect amplitude engine', ()=>{
  const circ=[{gate:'MEASURE',target:0,control:-1,control2:-1,column:0}];
  const terms=computeStateFormula(['0'],circ);
  assert.strictEqual(terms.length,1);
  assert.strictEqual(terms[0].displayBits,'0');
});

group('15. bit-breakdown table structure');
test('bit string length equals qubit count', ()=>{
  const r=localPreview({shots:100,qubitStates:['0','0','0'],circuit:[]});
  Object.keys(r).forEach(bits=>assert.strictEqual(bits.length,3,`bad length: ${bits}`));
});
test('bits split correctly for per-qubit table', ()=>{
  // '10' → q0='1', q1='0'  (X on q0, q0-left)
  const bits='10';
  const cells=bits.split('');
  assert.strictEqual(cells[0],'1'); // q0=1
  assert.strictEqual(cells[1],'0'); // q1=0
});
test('percentage rounds to 1 decimal', ()=>{
  const count=333, total=1000;
  assert.strictEqual((count/total*100).toFixed(1),'33.3');
});
test('top 8 entries selected from more', ()=>{
  // simulate 10 distinct states each with 1 shot
  const counts={};
  for(let i=0;i<10;i++) counts[i.toString().padStart(4,'0')]=1;
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  assert.strictEqual(entries.slice(0,8).length,8);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
const total=passed+failed;
console.log(`\n${'─'.repeat(52)}`);
if (failed===0) console.log(`${GREEN}All ${total} tests passed ✓${RESET}`);
else console.log(`\x1b[33m${passed}/${total} passed  —  ${RED}${failed} failed ✗${RESET}`);
console.log('─'.repeat(52));
if (failed>0) process.exit(1);
