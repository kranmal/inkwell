// Table tools: rows and columns (span-aware), merge and split, shading,
// border presets, drag selection of a cell range, and column drag-resize.
let api;
let sel = null;          // { table, a, b } while a cell range is selected
let overlay = null;

export function gridOf(table) {
  const grid = [], pos = new Map();
  const rows = [...table.rows];
  rows.forEach((tr, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const cell of tr.cells) {
      while (grid[r][c]) c++;
      const rs = Math.max(1, cell.rowSpan || 1), cs = Math.max(1, cell.colSpan || 1);
      pos.set(cell, { r, c, rs, cs });
      for (let i = 0; i < rs; i++) {
        grid[r + i] = grid[r + i] || [];
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = cell;
      }
      c += cs;
    }
  });
  const nRows = rows.length;
  grid.length = nRows;
  for (let r = 0; r < nRows; r++) grid[r] = grid[r] || [];
  const nCols = Math.max(0, ...grid.map((g) => g.length));
  return { grid, pos, nRows, nCols, rows };
}

function ctx() {
  const el = api.selEl();
  const cell = el && el.closest('td,th');
  if (!cell || !api.editor.contains(cell)) return null;
  const table = cell.closest('table');
  return { cell, table, row: cell.parentElement, ...gridOf(table) };
}
const newCell = (tag = 'td') => { const c = document.createElement(tag); c.append(document.createElement('br')); return c; };
const rowTag = (tr) => (tr.cells.length && [...tr.cells].every((c) => c.tagName === 'TH') ? 'th' : 'td');
// first cell that starts in row r at grid column >= c
function startingAt(g, r, c) {
  for (let i = c; i < g.nCols; i++) { const x = g.grid[r][i]; if (x && g.pos.get(x).r === r && g.pos.get(x).c === i) return x; }
  return null;
}
const dropCols = (table) => { const cg = table.querySelector(':scope > colgroup'); if (cg) cg.remove(); };
function focusCell(cell, table) {
  const target = cell && cell.isConnected ? cell : table.isConnected ? table.querySelector('td,th') : null;
  if (target) api.caretIn(target);
}
function removeTable(table) {
  const next = table.nextElementSibling || table.previousElementSibling;
  table.remove();
  if (next) api.caretIn(next);
}

function op(fn) {
  api.restore();
  const c = ctx();
  if (!c) { api.toast('Click inside a table first.'); return; }
  api.commit();
  clearSel();
  fn(c);
  api.done();
}

function addRow(c, below) {
  const p = c.pos.get(c.cell);
  const R = below ? p.r + p.rs - 1 : p.r;
  const tr = document.createElement('tr');
  const seen = new Set();
  const tag = below || R > 0 ? rowTag(c.rows[R]) === 'th' && R === 0 ? 'td' : rowTag(c.rows[R]) : rowTag(c.rows[R]);
  for (let i = 0; i < c.nCols; i++) {
    const x = c.grid[R][i];
    const xp = x && c.pos.get(x);
    const through = xp && (below ? xp.r + xp.rs - 1 > R : xp.r < R);
    if (through) { if (!seen.has(x)) { seen.add(x); x.rowSpan = xp.rs + 1; } } else tr.append(newCell(tag));
  }
  if (below) c.rows[R].after(tr); else c.rows[R].before(tr);
  if (!below) focusCell(tr.cells[0], c.table);
}
function addCol(c, right) {
  const p = c.pos.get(c.cell);
  const C = right ? p.c + p.cs - 1 : p.c;
  const seen = new Set();
  for (let r = 0; r < c.nRows; r++) {
    const x = c.grid[r][C];
    const xp = x && c.pos.get(x);
    const through = xp && (right ? xp.c + xp.cs - 1 > C : xp.c < C);
    if (through) { if (!seen.has(x)) { seen.add(x); x.colSpan = xp.cs + 1; } continue; }
    const ref = startingAt(c, r, right ? C + 1 : C);
    c.rows[r].insertBefore(newCell(rowTag(c.rows[r])), ref);
  }
  dropCols(c.table);
}
function delRow(c) {
  const R = c.pos.get(c.cell).r;
  if (c.nRows <= 1) { removeTable(c.table); return; }
  const seen = new Set();
  for (let i = 0; i < c.nCols; i++) {
    const x = c.grid[R][i];
    if (!x || seen.has(x)) continue;
    seen.add(x);
    const xp = c.pos.get(x);
    if (xp.r < R) x.rowSpan = xp.rs - 1;
    else if (xp.rs > 1) {
      x.rowSpan = xp.rs - 1;
      c.rows[R + 1].insertBefore(x, startingAt(c, R + 1, xp.c + xp.cs));
    }
  }
  const near = c.rows[R + 1] || c.rows[R - 1];
  c.rows[R].remove();
  focusCell(near && near.cells[0], c.table);
}
function delCol(c) {
  const C = c.pos.get(c.cell).c;
  if (c.nCols <= 1) { removeTable(c.table); return; }
  const seen = new Set();
  for (let r = 0; r < c.nRows; r++) {
    const x = c.grid[r][C];
    if (!x || seen.has(x)) continue;
    seen.add(x);
    const xp = c.pos.get(x);
    if (xp.cs > 1) x.colSpan = xp.cs - 1; else x.remove();
  }
  for (const tr of [...c.table.rows]) if (!tr.cells.length) tr.remove();
  dropCols(c.table);
  focusCell(null, c.table);
}
function headerRow(c) {
  const tr = c.rows[0];
  const to = rowTag(tr) === 'th' ? 'td' : 'th';
  for (const cell of [...tr.cells]) {
    const n = document.createElement(to);
    for (const a of cell.attributes) n.setAttribute(a.name, a.value);
    n.append(...cell.childNodes);
    cell.replaceWith(n);
  }
  focusCell(null, c.table);
}

// ---------- cell range ----------
function rectOf(g, a, b) {
  const pa = g.pos.get(a), pb = g.pos.get(b);
  if (!pa || !pb) return null;
  let r0 = Math.min(pa.r, pb.r), r1 = Math.max(pa.r + pa.rs - 1, pb.r + pb.rs - 1);
  let c0 = Math.min(pa.c, pb.c), c1 = Math.max(pa.c + pa.cs - 1, pb.c + pb.cs - 1);
  for (let grew = true; grew;) {
    grew = false;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = g.grid[r][c];
      if (!x) continue;
      const p = g.pos.get(x);
      if (p.r < r0) { r0 = p.r; grew = true; }
      if (p.c < c0) { c0 = p.c; grew = true; }
      if (p.r + p.rs - 1 > r1) { r1 = p.r + p.rs - 1; grew = true; }
      if (p.c + p.cs - 1 > c1) { c1 = p.c + p.cs - 1; grew = true; }
    }
  }
  const cells = new Set();
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (g.grid[r][c]) cells.add(g.grid[r][c]);
  return { r0, r1, c0, c1, cells: [...cells] };
}
function selCells() {
  if (sel && sel.table.isConnected && sel.a.isConnected && sel.b.isConnected) {
    const g = gridOf(sel.table);
    const rect = rectOf(g, sel.a, sel.b);
    if (rect) return { table: sel.table, g, rect, cells: rect.cells };
  }
  const c = ctx();
  return c ? { table: c.table, g: c, rect: rectOf(c, c.cell, c.cell), cells: [c.cell] } : null;
}
function clearSel() { sel = null; paint(); }
function paint() {
  if (!overlay) return;
  if (!sel || !sel.table.isConnected || !sel.a.isConnected || !sel.b.isConnected) { sel = null; overlay.hidden = true; return; }
  const s = selCells();
  if (!s || s.cells.length < 2) { overlay.hidden = true; return; }
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const c of s.cells) { const q = c.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
  const cv = api.canvas, cr = cv.getBoundingClientRect();
  overlay.hidden = false;
  Object.assign(overlay.style, { left: l - cr.left + cv.scrollLeft + 'px', top: t - cr.top + cv.scrollTop + 'px', width: r - l + 'px', height: b - t + 'px' });
}

function merge() {
  api.restore();
  const s = selCells();
  if (!s || s.cells.length < 2) { api.toast('Drag across two or more cells, then merge.'); return; }
  api.commit();
  const { rect, g } = s;
  const keep = g.grid[rect.r0][rect.c0];
  for (const c of s.cells) {
    if (c === keep) continue;
    if (c.textContent.trim() !== '') {
      if (keep.textContent.trim() === '') keep.textContent = '';
      else keep.append(document.createElement('br'));
      keep.append(...c.childNodes);
    }
    c.remove();
  }
  keep.colSpan = rect.c1 - rect.c0 + 1;
  keep.rowSpan = rect.r1 - rect.r0 + 1;
  // drop rows that no longer hold any cell, shrinking spans that crossed them
  for (const tr of [...s.table.rows]) {
    if (tr.cells.length) continue;
    const g2 = gridOf(s.table), R = g2.rows.indexOf(tr), seen = new Set();
    for (const x of g2.grid[R]) if (x && !seen.has(x)) { seen.add(x); if (x.rowSpan > 1) x.rowSpan -= 1; }
    tr.remove();
  }
  if (!keep.childNodes.length) keep.append(document.createElement('br'));
  clearSel();
  api.caretIn(keep);
  api.done();
}
function split() {
  op((c) => {
    const p = c.pos.get(c.cell);
    if (p.rs === 1 && p.cs === 1) { api.toast('This cell is not merged.'); return; }
    const tag = c.cell.tagName.toLowerCase();
    const refs = [];
    for (let r = p.r; r < p.r + p.rs; r++) refs.push(r === p.r ? null : startingAt(c, r, p.c + p.cs));
    c.cell.colSpan = 1; c.cell.rowSpan = 1;
    for (let i = p.cs - 1; i > 0; i--) c.cell.after(newCell(tag));
    for (let r = p.r + 1; r < p.r + p.rs; r++) for (let i = 0; i < p.cs; i++) c.rows[r].insertBefore(newCell('td'), refs[r - p.r]);
  });
}
function shade(val) {
  api.restore();
  const s = selCells();
  if (!s) { api.toast('Click inside a table first.'); return; }
  api.commit();
  for (const c of s.cells) c.style.backgroundColor = val || '';
  api.closeMenus();
  api.done();
}
function borders(val) {
  op((c) => {
    c.table.classList.remove('tb-none', 'tb-outer', 'tb-horizontal', 'tb-striped');
    if (val) c.table.classList.add('tb-' + val);
    if (!c.table.getAttribute('class')) c.table.removeAttribute('class');
  });
  api.closeMenus();
}

// ---------- column resize ----------
function edgeAt(e) {
  const cell = e.target.closest && e.target.closest('td,th');
  if (!cell || !api.editor.contains(cell)) return null;
  const r = cell.getBoundingClientRect();
  const nearRight = r.right - e.clientX <= 5, nearLeft = e.clientX - r.left <= 4;
  if (!nearRight && !nearLeft) return null;
  const table = cell.closest('table'), g = gridOf(table), p = g.pos.get(cell);
  if (!p) return null;
  // the border belongs to the column on its left, whichever side of it the pointer is on
  const C = nearRight ? p.c + p.cs - 1 : p.c - 1;
  return C < 0 || C >= g.nCols - 1 ? null : { table, g, C };
}
function ensureCols(table, g) {
  let cg = table.querySelector(':scope > colgroup');
  if (cg && cg.children.length === g.nCols) return [...cg.children];
  if (cg) cg.remove();
  const tw = table.getBoundingClientRect().width || 1;
  const w = [];
  for (let c = 0; c < g.nCols; c++) {
    let cell = null;
    for (let r = 0; r < g.nRows && !cell; r++) { const x = g.grid[r][c]; if (x && g.pos.get(x).cs === 1) cell = x; }
    w[c] = cell ? (cell.getBoundingClientRect().width / tw) * 100 : 100 / g.nCols;
  }
  const sum = w.reduce((a, b) => a + b, 0) || 100;
  cg = document.createElement('colgroup');
  for (const x of w) { const col = document.createElement('col'); col.style.width = ((x / sum) * 100).toFixed(2) + '%'; cg.append(col); }
  table.prepend(cg);
  return [...cg.children];
}
function startResize(e, edge) {
  e.preventDefault();
  api.commit();
  const cols = ensureCols(edge.table, edge.g);
  const a = cols[edge.C], b = cols[edge.C + 1];
  const wa = parseFloat(a.style.width), wb = parseFloat(b.style.width);
  const tw = edge.table.getBoundingClientRect().width || 1;
  const x0 = e.clientX;
  document.body.style.cursor = 'col-resize';
  const move = (ev) => {
    const d = Math.max(-(wa - 4), Math.min(wb - 4, ((ev.clientX - x0) / tw) * 100));
    a.style.width = (wa + d).toFixed(2) + '%';
    b.style.width = (wb - d).toFixed(2) + '%';
    paint();
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    document.body.style.cursor = '';
    api.done();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

const TINTS = ['#f4f4f2', '#e4e4e0', '#e3f1ef', '#dfeaf7', '#fdf2d0', '#fde3d8', '#f9dde6', '#e9e4f8',
  '#cfcfc8', '#9aa0a0', '#9fd3cb', '#a9c8ee', '#f5d572', '#f2a98a', '#ee9db6', '#b9aee8'];

export function init(a) {
  api = a;
  const { editor, canvas } = api;
  overlay = document.createElement('div');
  overlay.className = 'cell-sel'; overlay.hidden = true;
  canvas.append(overlay);

  api.cmd('rowAbove', () => op((c) => addRow(c, false)));
  api.cmd('rowBelow', () => op((c) => addRow(c, true)));
  api.cmd('colLeft', () => op((c) => addCol(c, false)));
  api.cmd('colRight', () => op((c) => addCol(c, true)));
  api.cmd('headerRow', () => op(headerRow));
  api.cmd('delRow', () => op(delRow));
  api.cmd('delCol', () => op(delCol));
  api.cmd('delTable', () => op((c) => removeTable(c.table)));
  api.cmd('mergeCells', merge);
  api.cmd('splitCell', split);
  api.cmd('shade', shade);
  api.cmd('borders', borders);

  const sw = api.$('#m-shade .swatches');
  if (sw) sw.innerHTML = TINTS.map((c) => `<button data-cmd="shade" data-val="${c}" style="background:${c}" title="${c}" aria-label="Shade ${c}"></button>`).join('');

  let anchor = null;
  editor.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const edge = edgeAt(e);
    if (edge) { startResize(e, edge); return; }
    clearSel();
    const cell = e.target.closest && e.target.closest('td,th');
    anchor = cell && editor.contains(cell) ? cell : null;
  });
  editor.addEventListener('pointermove', (e) => {
    if (!anchor || !(e.buttons & 1)) {
      editor.style.cursor = edgeAt(e) ? 'col-resize' : '';
      return;
    }
    const cell = e.target.closest && e.target.closest('td,th');
    if (!cell || cell.closest('table') !== anchor.closest('table')) return;
    if (cell === anchor && !sel) return;
    sel = { table: anchor.closest('table'), a: anchor, b: cell };
    if (cell !== anchor) getSelection().collapse(anchor, 0);
    paint();
  });
  addEventListener('pointerup', () => { anchor = null; if (sel && sel.a === sel.b) clearSel(); });
  editor.addEventListener('keydown', (e) => {
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const s = selCells();
      if (s && s.cells.length > 1) {
        e.preventDefault(); e.stopImmediatePropagation();
        api.commit();
        for (const c of s.cells) { c.textContent = ''; c.append(document.createElement('br')); }
        api.done();
        return;
      }
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key !== 'Shift') clearSel();
  }, true);
  api.on('afterLayout', paint);
}
