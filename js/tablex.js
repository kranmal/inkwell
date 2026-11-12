// Table formulas, sorting and header rows that repeat on every page.
import { gridOf } from './tables.js';

let api;
const lock = (el) => { if (el.getAttribute('contenteditable') !== 'false') el.setAttribute('contenteditable', 'false'); };
const colName = (c) => { let s = ''; c += 1; while (c > 0) { s = String.fromCharCode(65 + ((c - 1) % 26)) + s; c = Math.floor((c - 1) / 26); } return s; };
const colNum = (s) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const num = (t) => {
  const s = String(t).replace(/[\s ,$£€%]/g, '');
  return /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s) ? parseFloat(s) : null;
};
const cellCtx = () => {
  api.restore();
  const el = api.selEl();
  const cell = el && el.closest && el.closest('td,th');
  return cell && api.editor.contains(cell) ? cell : null;
};

// ---------- formulas ----------
let busy = new Set();
function cellValue(cell) {
  const tf = cell.querySelector(':scope span.tf');
  if (tf) { if (busy.has(tf)) return { err: '#CIRC' }; calc(tf); return num(tf.textContent) == null ? null : num(tf.textContent); }
  return num(cell.textContent.replace(/​/g, ''));
}
function run(formula, cell) {
  const g = gridOf(cell.closest('table'));
  const me = g.pos.get(cell);
  const at = (r, c) => { const x = g.grid[r] && g.grid[r][c]; return x || null; };
  const val = (r, c) => { const x = at(r, c); return x ? cellValue(x) : null; };
  const run1 = (dr, dc) => { // contiguous numbers away from this cell
    const out = [];
    let r = me.r + dr, c = me.c + dc;
    while (r >= 0 && c >= 0 && r < g.nRows && c < g.nCols) {
      if (at(r, c) === cell) break;
      const v = val(r, c);
      if (v == null || typeof v === 'object') break;
      out.push(v); r += dr; c += dc;
    }
    return out;
  };
  const range = (spec) => {
    spec = spec.trim().toUpperCase();
    if (spec === 'ABOVE') return run1(-1, 0);
    if (spec === 'BELOW') return run1(1, 0);
    if (spec === 'LEFT') return run1(0, -1);
    if (spec === 'RIGHT') return run1(0, 1);
    const out = [];
    for (const part of spec.split(',')) {
      const m = part.trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      if (!m) throw new Error('bad range');
      const c1 = colNum(m[1]), r1 = +m[2] - 1, c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? +m[4] - 1 : r1;
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const v = val(r, c);
        if (v && typeof v === 'object') throw new Error(v.err);
        if (v != null) out.push(v);
      }
    }
    return out;
  };
  const FN = {
    SUM: (a) => a.reduce((x, y) => x + y, 0), AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN),
    MIN: (a) => (a.length ? Math.min(...a) : NaN), MAX: (a) => (a.length ? Math.max(...a) : NaN), COUNT: (a) => a.length, PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  };
  let src = formula.trim().replace(/^=/, '');
  if (!src) throw new Error('empty');
  src = src.replace(/\b(SUM|AVERAGE|AVG|MIN|MAX|COUNT|PRODUCT)\s*\(([^()]*)\)/gi, (_, f, a) => {
    const name = f.toUpperCase() === 'AVG' ? 'AVERAGE' : f.toUpperCase();
    return '(' + FN[name](range(a)) + ')';
  });
  src = src.replace(/\b([A-Za-z]{1,2})(\d+)\b/g, (_, c, r) => {
    const v = val(+r - 1, colNum(c.toUpperCase()));
    if (v && typeof v === 'object') throw new Error(v.err);
    return '(' + (v == null ? 0 : v) + ')';
  });
  // safe arithmetic: numbers, + - * / ^ and brackets
  let i = 0;
  const peek = () => { while (src[i] === ' ') i++; return src[i]; };
  const prim = () => {
    const ch = peek();
    if (ch === '(') { i++; const v = add(); if (peek() !== ')') throw new Error('paren'); i++; return v; }
    if (ch === '-') { i++; return -prim(); }
    if (ch === '+') { i++; return prim(); }
    const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?|^(NaN|Infinity)/i);
    if (!m) throw new Error('syntax');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const pow = () => { const b = prim(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; };
  const mul = () => { let v = pow(); for (;;) { const o = peek(); if (o === '*') { i++; v *= pow(); } else if (o === '/') { i++; v /= pow(); } else return v; } };
  const add = () => { let v = mul(); for (;;) { const o = peek(); if (o === '+') { i++; v += mul(); } else if (o === '-') { i++; v -= mul(); } else return v; } };
  const v = add();
  if (peek() !== undefined) throw new Error('syntax');
  return v;
}
function fmt(v, dp) {
  if (!Number.isFinite(v)) return '#ERR';
  const d = dp === '' || dp == null || isNaN(Number(dp)) ? null : Math.min(8, Math.max(0, Number(dp)));
  return d == null ? String(Math.round(v * 1e6) / 1e6) : v.toFixed(d);
}
function calc(tf) {
  const cell = tf.closest('td,th');
  if (!cell) { tf.textContent = '#ERR'; return; }
  busy.add(tf);
  let out;
  try { out = fmt(run(tf.dataset.f || '', cell), tf.dataset.dp); } catch (e) { out = /^#/.test(e.message) ? e.message : '#ERR'; }
  busy.delete(tf);
  if (tf.textContent !== out) tf.textContent = out;
  lock(tf);
}
function recalc() {
  busy = new Set();
  for (const tf of api.editor.querySelectorAll('span.tf')) calc(tf);
}
async function insertFormula(target) {
  const tf = target && target.isConnected ? target : null;
  const cell = tf ? tf.closest('td,th') : cellCtx();
  if (!cell) { api.toast('Click in a table cell first.'); return; }
  const g = gridOf(cell.closest('table')), p = g.pos.get(cell);
  const guess = tf ? tf.dataset.f : p.r > 0 ? '=SUM(ABOVE)' : '=SUM(LEFT)';
  const v = await api.ask(tf ? 'Edit formula' : 'Formula', [
    { id: 'f', label: `Formula for cell ${colName(p.c)}${p.r + 1}`, value: guess, placeholder: '=SUM(ABOVE)' },
    { id: 'dp', label: 'Decimal places', type: 'select', value: tf ? tf.dataset.dp || '' : '2', options: [['', 'Automatic'], '0', '1', '2', '3', '4'] },
  ], { ok: tf ? 'Update' : 'Insert', note: 'Use SUM, AVERAGE, MIN, MAX, COUNT or PRODUCT with ABOVE, LEFT, BELOW, RIGHT or a range like B2:B5. You can also do sums such as =B2*C2*1.2.' });
  if (!v || !v.f.trim()) return;
  api.commit();
  const el = tf || document.createElement('span');
  el.className = 'tf'; el.dataset.f = (v.f.trim().startsWith('=') ? '' : '=') + v.f.trim();
  if (v.dp) el.dataset.dp = v.dp; else delete el.dataset.dp;
  el.setAttribute('contenteditable', 'false');
  if (!tf) {
    const empty = cell.textContent.replace(/​/g, '').trim() === '' && !cell.querySelector('img,.shape,.chart');
    if (empty) cell.replaceChildren(el); else cell.append(el);
  }
  recalc();
  api.done();
}

// ---------- sorting ----------
async function sortTable() {
  const cell = cellCtx();
  if (!cell) { api.toast('Click in the table you want to sort first.'); return; }
  const table = cell.closest('table'), g = gridOf(table);
  if ([...table.querySelectorAll('td,th')].some((c) => c.rowSpan > 1 || c.colSpan > 1)) { api.toast('Tables with merged cells can’t be sorted. Split the cells first.'); return; }
  if (g.nRows < 2) { api.toast('The table needs at least two rows to sort.'); return; }
  const here = g.pos.get(cell).c;
  const head = [...g.rows[0].cells].every((c) => c.tagName === 'TH');
  const v = await api.ask('Sort table', [
    { id: 'col', label: 'Sort by column', type: 'select', value: here, options: Array.from({ length: g.nCols }, (_, c) => [c, `Column ${c + 1}` + (head ? ': ' + (g.rows[0].cells[c] ? g.rows[0].cells[c].textContent.trim().slice(0, 24) : '') : '')]) },
    { id: 'dir', label: 'Order', type: 'select', options: [['asc', 'A to Z, smallest first'], ['desc', 'Z to A, largest first']] },
    { id: 'head', label: 'First row is a header (keep it on top)', type: 'check', value: head },
  ], { ok: 'Sort' });
  if (!v) return;
  const col = Number(v.col), start = v.head ? 1 : 0;
  const body = g.rows.slice(start);
  if (body.length < 2) return;
  const key = (tr) => { const c = tr.cells[col]; return c ? c.textContent.replace(/​/g, '').trim() : ''; };
  const numeric = body.every((tr) => key(tr) === '' || num(key(tr)) != null);
  const dir = v.dir === 'desc' ? -1 : 1;
  const sorted = body.map((tr, k) => ({ tr, k })).sort((a, b) => {
    const x = key(a.tr), y = key(b.tr);
    if (x === '' && y !== '') return 1;
    if (y === '' && x !== '') return -1;
    const d = numeric ? (num(x) || 0) - (num(y) || 0) : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    return d * dir || a.k - b.k;
  }).map((o) => o.tr);
  api.commit();
  const anchor = body[body.length - 1];
  const parent = anchor.parentNode, after = anchor.nextSibling;
  for (const tr of sorted) parent.insertBefore(tr, after);
  recalc();
  api.done();
  api.toast(`Sorted by column ${col + 1}.`);
}

// ---------- header rows that repeat ----------
function headRows(table) {
  const out = [];
  for (const tr of table.rows) { if (tr.cells.length && [...tr.cells].every((c) => c.tagName === 'TH')) out.push(tr); else break; }
  return out;
}
function syncHeads() {
  for (const table of api.editor.querySelectorAll('table')) {
    const th = table.tHead;
    if (!table.classList.contains('rep-head')) {
      if (th) { const tb = table.tBodies[0] || table.appendChild(document.createElement('tbody')); tb.prepend(...th.rows); th.remove(); }
      continue;
    }
    const heads = headRows(table);
    if (!heads.length) { table.classList.remove('rep-head'); if (th) th.remove(); continue; }
    const have = th ? [...th.rows] : [];
    if (have.length === heads.length && have.every((r, k) => r === heads[k])) continue;
    const t = th || document.createElement('thead');
    t.append(...heads);
    if (!th) table.prepend(t);
  }
}
function repeatHead() {
  const cell = cellCtx();
  if (!cell) { api.toast('Click in a table first.'); return; }
  const table = cell.closest('table');
  if (!headRows(table).length) { api.toast('Turn on “Header row” first, then repeat it.'); return; }
  api.commit();
  table.classList.toggle('rep-head');
  syncHeads();
  api.done();
  api.toast(table.classList.contains('rep-head') ? 'The header row now repeats on every page.' : 'Header row no longer repeats.');
}

export function init(a) {
  api = a;
  api.cmd('tableFormula', () => insertFormula(null));
  api.cmd('tableSort', sortTable);
  api.cmd('repeatHead', repeatHead);
  api.on('meta', () => { syncHeads(); recalc(); });
  api.on('load', () => { syncHeads(); recalc(); });
  api.editor.addEventListener('dblclick', (e) => { const tf = e.target.closest && e.target.closest('span.tf'); if (tf) { e.preventDefault(); insertFormula(tf); } });
}
