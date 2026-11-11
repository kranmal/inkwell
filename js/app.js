// Inkwell: editor wiring. Formatting, styles, layout, proofing UI, files.
import { icon } from './icons.js';
import { store } from './store.js';
import { blocksOf, toRange } from './textmap.js';
import * as proof from './proof.js';
import { exportDocx, loadScript } from './docx.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const editor = $('#editor'), page = $('#page'), canvas = $('#canvas');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ic = (n) => { const v = icon(n); return typeof v === 'string' ? v : v.outerHTML; };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const canHL = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
const MM = 96 / 25.4;

const PAGES = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A5: [148, 210] };
const MARGINS = { normal: [25.4, 25.4, 25.4, 25.4], narrow: [12.7, 12.7, 12.7, 12.7], moderate: [25.4, 19.1, 25.4, 19.1], wide: [25.4, 50.8, 25.4, 50.8] }; // t r b l
const THEMES = [
  { id: 'modern', name: 'Modern', font: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'classic', name: 'Classic', font: '"Times New Roman", serif' },
  { id: 'elegant', name: 'Elegant', font: 'Didot, Baskerville, Georgia, serif' },
  { id: 'editorial', name: 'Editorial', font: 'Georgia, serif' },
  { id: 'draft', name: 'Draft', font: 'Menlo, "Courier New", monospace' },
];
const FONTS = ['Arial', 'Helvetica Neue', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Georgia', 'Times New Roman', 'Garamond', 'Palatino', 'Baskerville', 'Courier New', 'Menlo', 'Comic Sans MS', 'Impact'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
const COLORS = ['#111111', '#4b5563', '#9ca3af', '#ffffff', '#e5484d', '#f76b15', '#f5b800', '#30a46c', '#0f766e', '#0091ff', '#3e63dd', '#8e4ec6', '#d6409f', '#7a1f2b', '#1b2a49', '#6b4f2a'];
const HILITES = ['#fff59d', '#ffd6a5', '#caffbf', '#9bf6ff', '#bdb2ff', '#ffc6ff', '#e5e7eb', '#ffadad'];
const SYMBOLS = '© ® ™ € £ ¥ ¢ § ¶ † • … – — ° ± × ÷ ≠ ≤ ≥ ≈ ∞ √ π µ Ω α β Δ → ← ↑ ↓ ✓ ✗ ½ ¼ ¾ “ ” ‘ ’ « »'.split(' ');
const STYLES = {
  normal: ['P', '', 'Normal'], nospace: ['P', 'no-spacing', 'No spacing'], title: ['P', 'doc-title', 'Title'], subtitle: ['P', 'doc-subtitle', 'Subtitle'],
  h1: ['H1', '', 'Heading 1'], h2: ['H2', '', 'Heading 2'], h3: ['H3', '', 'Heading 3'], quote: ['P', 'quote', 'Quote'], code: ['PRE', '', 'Code block'],
};
const LANGS = { en_GB: 'English (UK)', en_US: 'English (US)' };
const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th';

// ---------- state ----------
const sysLang = /^en-(GB|AU|NZ|IE|ZA|IN)/i.test(navigator.language || '') ? 'en_GB' : 'en_US';
const prefs = Object.assign({ dark: null, zoom: 100, lang: sysLang, proofOn: true, lastId: null, nav: false }, (() => {
  try { return JSON.parse(localStorage.getItem('inkwell.prefs') || '{}'); } catch { return {}; }
})());
const savePrefs = () => { try { localStorage.setItem('inkwell.prefs', JSON.stringify(prefs)); } catch { /* private mode */ } };
let doc = null;
let saved = null;            // last selection inside the editor
let pendingSize = null;
let painter = null;
let selImg = null;
let lastColor = '#e5484d', lastHilite = '#fff59d';

const newDoc = (title = 'Untitled document') => ({
  id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title, theme: 'modern',
  page: { size: sysLang === 'en_US' ? 'Letter' : 'A4', orient: 'portrait', margins: 'normal', cols: 1 }, created: Date.now(), updated: Date.now(),
});

// ---------- small helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileBase = () => (doc.title || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Document';
const zoomF = () => prefs.zoom / 100;

// ---------- selection ----------
const inEditor = (n) => !!n && editor.contains(n);
function restore() {
  const s = getSelection();
  if (document.activeElement !== editor) editor.focus({ preventScroll: true });
  if (saved && !(s.rangeCount && inEditor(s.anchorNode) && s.anchorNode !== editor)) {
    try { s.removeAllRanges(); s.addRange(saved); } catch { /* stale */ }
  } else if (saved && document.activeElement === editor && !inEditor(s.anchorNode)) {
    try { s.removeAllRanges(); s.addRange(saved); } catch { /* stale */ }
  }
}
function selEl() {
  const s = getSelection();
  let n = s.rangeCount && inEditor(s.anchorNode) ? s.getRangeAt(0).startContainer : (saved ? saved.startContainer : editor);
  if (n.nodeType === 3 && s.rangeCount && !s.isCollapsed && s.getRangeAt(0).startOffset === n.length && n.nextSibling) n = n.nextSibling;
  return n.nodeType === 1 ? n : n.parentElement;
}
function curBlock() {
  const el = selEl();
  const b = el && el.closest(BLOCK);
  return b && editor.contains(b) && b !== editor ? b : null;
}
function selBlocks() {
  const s = getSelection();
  if (!s.rangeCount) return [];
  const r = s.getRangeAt(0);
  if (!inEditor(r.commonAncestorContainer)) return [];
  if (r.collapsed) { const b = curBlock(); return b ? [b] : []; }
  let list = $$(BLOCK, editor).filter((b) => r.intersectsNode(b));
  list = list.filter((b) => !list.some((o) => o !== b && b.contains(o)));
  if (list.length > 1) {
    const last = list[list.length - 1];
    const t = document.createRange();
    t.setStart(last, 0); t.setEnd(r.endContainer, r.endOffset);
    if (t.toString() === '' && !t.cloneContents().querySelector('img')) list.pop();
  }
  return list;
}
function keepSel(fn) {
  const s = getSelection();
  const a = [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset];
  fn();
  try { if (a[0] && a[0].isConnected && a[2].isConnected) s.setBaseAndExtent(...a); } catch { /* moved */ }
}
function caretIn(el, atEnd = false) {
  const r = document.createRange();
  r.selectNodeContents(el); r.collapse(!atEnd);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  editor.focus({ preventScroll: true });
}

// ---------- history ----------
const H = { stack: [], idx: -1, timer: null };
function pathOf(node, off) {
  const p = [];
  let n = node;
  while (n && n !== editor) { p.unshift([...n.parentNode.childNodes].indexOf(n)); n = n.parentNode; }
  return n ? { p, off } : null;
}
function resolve(x) {
  if (!x) return null;
  let n = editor;
  for (const i of x.p) { n = n.childNodes[i]; if (!n) return null; }
  return [n, Math.min(x.off, n.nodeType === 3 ? n.length : n.childNodes.length)];
}
function selPath() {
  const s = getSelection();
  if (!s.rangeCount || !inEditor(s.anchorNode)) return null;
  return [pathOf(s.anchorNode, s.anchorOffset), pathOf(s.focusNode, s.focusOffset)];
}
function commit() {
  clearTimeout(H.timer);
  const html = editor.innerHTML;
  if (H.idx >= 0 && H.stack[H.idx].html === html) { H.stack[H.idx].sel = selPath() || H.stack[H.idx].sel; return; }
  H.stack.length = H.idx + 1;
  H.stack.push({ html, sel: selPath() });
  if (H.stack.length > 200) H.stack.shift();
  H.idx = H.stack.length - 1;
}
function applySnap(snap) {
  editor.innerHTML = snap.html;
  selectImg(null);
  editor.focus({ preventScroll: true });
  try {
    const a = snap.sel && resolve(snap.sel[0]), f = snap.sel && resolve(snap.sel[1]);
    if (a && f) getSelection().setBaseAndExtent(a[0], a[1], f[0], f[1]);
  } catch { /* selection could not be rebuilt */ }
  changed(true);
}
function undo() { commit(); if (H.idx > 0) applySnap(H.stack[--H.idx]); }
function redo() { if (H.idx < H.stack.length - 1) applySnap(H.stack[++H.idx]); }
const begin = () => { restore(); commit(); };
const done = () => { commit(); changed(true); refreshUI(); };
function exec(cmd, val = null) {
  begin();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, val);
  done();
}

// ---------- change pipeline ----------
let saveTimer, metaTimer;
function setSave(t) { $('#save-state').textContent = t; }
function changed(skipHistory) {
  setSave('Saving…');
  if (!skipHistory) { clearTimeout(H.timer); H.timer = setTimeout(commit, 350); }
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 800);
  proof.schedule();
  clearTimeout(metaTimer); metaTimer = setTimeout(meta, 180);
}
function meta() {
  if (!editor.firstElementChild) { editor.innerHTML = '<p><br></p>'; caretIn(editor.firstElementChild); }
  const last = editor.lastElementChild;
  if (last && (/^(TABLE|HR|PRE)$/.test(last.tagName) || last.classList.contains('page-break'))) {
    const p = document.createElement('p'); p.append(document.createElement('br')); editor.append(p);
  }
  updateStats();
  if (!$('#nav-pane').hidden) renderOutline();
  if (findOpen()) findRun(true);
  placeImgBox();
}
async function save() {
  clearTimeout(saveTimer);
  if (!doc) return;
  doc.updated = Date.now();
  const rec = { ...doc, html: editor.innerHTML, excerpt: editor.innerText.replace(/\s+/g, ' ').trim().slice(0, 180) };
  try { await store.put(rec); setSave('Saved'); } catch { setSave('Not saved: browser storage is unavailable'); }
  prefs.lastId = doc.id; savePrefs();
}

// ---------- page, theme, zoom ----------
function pageDims() {
  let [w, h] = PAGES[doc.page.size] || PAGES.A4;
  if (doc.page.orient === 'landscape') [w, h] = [h, w];
  const [t, r, b, l] = MARGINS[doc.page.margins] || MARGINS.normal;
  return { w, h, landscape: doc.page.orient === 'landscape', m: { t, r, b, l }, cols: doc.page.cols || 1 };
}
function applyPage() {
  const d = pageDims();
  const set = (k, v) => page.style.setProperty(k, v + 'mm');
  set('--page-w', d.w); set('--page-h', d.h); set('--m-t', d.m.t); set('--m-r', d.m.r); set('--m-b', d.m.b); set('--m-l', d.m.l);
  editor.style.columnCount = d.cols > 1 ? d.cols : '';
  editor.style.columnGap = d.cols > 1 ? '12.5mm' : '';
  let st = $('#print-page');
  if (!st) { st = document.createElement('style'); st.id = 'print-page'; document.head.append(st); }
  st.textContent = `@page { size: ${d.w}mm ${d.h}mm; margin: ${d.m.t}mm ${d.m.r}mm ${d.m.b}mm ${d.m.l}mm; }`;
  for (const [menu, key] of [['m-margins', 'margins'], ['m-orient', 'orient'], ['m-size', 'size'], ['m-cols', 'cols']]) {
    $$('button', $('#' + menu)).forEach((b) => b.classList.toggle('on', b.dataset.val === String(doc.page[key])));
  }
  updateStats(); placeImgBox();
}
function applyTheme() {
  if (doc.theme && doc.theme !== 'modern') editor.dataset.theme = doc.theme; else delete editor.dataset.theme;
  $$('.theme-card').forEach((c) => c.classList.toggle('on', c.dataset.val === (doc.theme || 'modern')));
}
function zoomTo(z) {
  prefs.zoom = Math.max(50, Math.min(200, Math.round(z / 5) * 5));
  page.style.zoom = prefs.zoom === 100 ? '' : zoomF();
  $$('.zoom-label').forEach((l) => { l.textContent = prefs.zoom + '%'; });
  $('#zoom-range').value = prefs.zoom;
  savePrefs(); placeImgBox();
}
function applyDark() {
  const dark = prefs.dark == null ? matchMedia('(prefers-color-scheme: dark)').matches : prefs.dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#dark-btn').innerHTML = ic(dark ? 'sun' : 'moon');
}
function applyLang() {
  $('#lang-label').textContent = LANGS[prefs.lang];
  $('#st-lang').textContent = LANGS[prefs.lang];
  editor.lang = prefs.lang.replace('_', '-');
  $$('button', $('#m-lang')).forEach((b) => b.classList.toggle('on', b.dataset.val === prefs.lang));
}

// ---------- stats, outline ----------
const WORDS = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
function pageInfo() {
  const d = pageDims();
  const per = (d.h - d.m.t - d.m.b) * MM;
  const er = editor.getBoundingClientRect();
  const total = Math.max(1, Math.ceil((er.height / zoomF() - 2) / per));
  let cur = 1;
  const s = getSelection();
  if (s.rangeCount && inEditor(s.anchorNode)) {
    const r = s.getRangeAt(0).getClientRects()[0] || selEl().getBoundingClientRect();
    cur = Math.min(total, Math.max(1, Math.floor((r.top - er.top) / zoomF() / per) + 1));
  }
  return { cur, total };
}
function updateStats() {
  const n = (editor.innerText.match(WORDS) || []).length;
  $('#st-words').textContent = `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`;
  const p = pageInfo();
  $('#st-page').textContent = `Page ${p.cur} of ${p.total}`;
}
function renderOutline() {
  const box = $('#outline');
  const heads = $$('h1,h2,h3,.doc-title', editor).filter((h) => h.textContent.trim());
  box.textContent = '';
  if (!heads.length) { box.innerHTML = '<p class="empty">Headings you add will appear here, so you can jump around a long document.</p>'; return; }
  for (const h of heads) {
    const b = document.createElement('button');
    b.className = h.classList.contains('doc-title') ? 'l0' : 'l' + h.tagName[1];
    b.textContent = h.textContent.trim();
    b.onclick = () => { h.scrollIntoView({ block: 'start', behavior: 'smooth' }); caretIn(h); };
    box.append(b);
  }
}

// ---------- formatting ----------
function styleOf(b) {
  if (!b) return 'normal';
  const t = b.tagName;
  if (/^H[1-3]$/.test(t)) return t.toLowerCase();
  if (t === 'PRE') return 'code';
  for (const k of ['nospace', 'title', 'subtitle', 'quote']) if (b.classList.contains(STYLES[k][1])) return k;
  return 'normal';
}
function applyStyle(val) {
  const [tag, cls] = STYLES[val];
  begin();
  keepSel(() => {
    for (const b of selBlocks()) {
      if (b.tagName === 'LI') continue;
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      const cell = b.tagName === 'TD' || b.tagName === 'TH';
      if (!cell && b.style.textAlign) el.style.textAlign = b.style.textAlign;
      while (b.firstChild) el.append(b.firstChild);
      if (cell) b.append(el); else b.replaceWith(el);
      if (!el.firstChild) el.append(document.createElement('br'));
    }
  });
  done();
}
function fixSizes(ptv) {
  for (const f of $$('font[size="7"]', editor)) {
    const sp = document.createElement('span');
    sp.style.fontSize = ptv + 'pt';
    if (f.face) sp.style.fontFamily = f.face;
    if (f.color) sp.style.color = f.color;
    while (f.firstChild) sp.append(f.firstChild);
    f.replaceWith(sp);
  }
  for (const s of $$('[style*="xxx-large"]', editor)) s.style.fontSize = ptv + 'pt';
}
function sizeSel(ptv) {
  pendingSize = ptv;   // the input listener converts the placeholder size as the command fires
  keepSel(() => {
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, 7);
  });
  keepSel(() => fixSizes(ptv));
  pendingSize = getSelection().isCollapsed ? ptv : null;
}
function setSize(ptv) { begin(); sizeSel(ptv); done(); }
function curSize() { return Math.round(parseFloat(getComputedStyle(selEl()).fontSize) * 0.75 * 2) / 2; }
function stepSize(dir) {
  restore();
  const c = pendingSize || curSize();
  const next = dir > 0 ? SIZES.find((s) => s > c) : [...SIZES].reverse().find((s) => s < c);
  if (next) setSize(next);
}
function blockProp(fn) {
  begin();
  for (const b of selBlocks()) fn(b);
  done();
}
function indent(dir) {
  restore();
  const b = curBlock();
  if (b && b.closest('li')) return exec(dir > 0 ? 'indent' : 'outdent');
  blockProp((el) => {
    if (el.tagName === 'TD' || el.tagName === 'TH') return;
    const cur = parseFloat(el.style.marginLeft) || 0;
    const v = Math.max(0, cur + dir * 36);
    el.style.marginLeft = v ? v + 'pt' : '';
  });
}
function clearFormat() {
  begin();
  document.execCommand('removeFormat');
  document.execCommand('unlink');
  for (const b of selBlocks()) { b.removeAttribute('style'); }
  done();
  if (!['normal'].includes(styleOf(curBlock())) && curBlock() && curBlock().tagName !== 'LI') applyStyle('normal');
}
function changeCase(mode) {
  begin();
  const s = getSelection();
  if (!s.rangeCount) return;
  let r = s.getRangeAt(0);
  if (r.collapsed) { const b = curBlock(); if (!b) return; r = document.createRange(); r.selectNodeContents(b); }
  const parts = [];
  const w = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (!r.intersectsNode(n)) continue;
    const a = n === r.startContainer ? r.startOffset : 0;
    const z = n === r.endContainer ? r.endOffset : n.length;
    if (z > a) parts.push({ n, a, z, block: n.parentElement.closest(BLOCK) });
  }
  let start = true, inWord = false, prevBlock = null;
  const isL = (c) => /\p{L}/u.test(c);
  keepSel(() => {
    for (const p of parts) {
      if (p.block !== prevBlock) { start = true; inWord = false; prevBlock = p.block; }
      let out = '';
      for (const c of p.n.data.slice(p.a, p.z)) {
        let d = c;
        if (mode === 'upper') d = c.toUpperCase();
        else if (mode === 'lower') d = c.toLowerCase();
        else if (mode === 'toggle') d = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
        else if (mode === 'title') d = isL(c) ? (inWord ? c.toLowerCase() : c.toUpperCase()) : c;
        else if (mode === 'sentence') {
          d = isL(c) ? (start ? c.toUpperCase() : c.toLowerCase()) : c;
          if (isL(c) || /\p{N}/u.test(c)) start = false; else if (/[.!?]/.test(c)) start = true;
        }
        inWord = isL(c) || c === "'" || c === '’';
        out += d;
      }
      if (mode === 'sentence') out = out.replace(/(^|[^\p{L}\p{N}'’])i(?=$|[^\p{L}\p{N}])/gu, '$1I');
      p.n.replaceData(p.a, p.z - p.a, out);
    }
  });
  done();
}

// format painter
function hiliteAt(el) {
  for (let n = el; n && n !== editor && !n.matches(BLOCK); n = n.parentElement) if (n.style.backgroundColor) return n.style.backgroundColor;
  return null;
}
function togglePainter() {
  if (painter) { painter = null; document.body.classList.remove('painting'); refreshUI(); return; }
  restore();
  const el = selEl(), cs = getComputedStyle(el), q = (c) => document.queryCommandState(c);
  painter = { bold: q('bold'), italic: q('italic'), underline: q('underline'), strikeThrough: q('strikeThrough'), font: cs.fontFamily, size: curSize(), color: cs.color, hl: hiliteAt(el) };
  document.body.classList.add('painting');
  toast('Formatting copied. Select the text to paint it onto.');
  refreshUI();
}
function paint() {
  const f = painter;
  painter = null; document.body.classList.remove('painting');
  commit();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('removeFormat');
  for (const c of ['bold', 'italic', 'underline', 'strikeThrough']) if (document.queryCommandState(c) !== f[c]) document.execCommand(c);
  document.execCommand('fontName', false, f.font.split(',')[0].replace(/["']/g, '').trim());
  document.execCommand('foreColor', false, f.color);
  if (f.hl) document.execCommand('hiliteColor', false, f.hl);
  sizeSel(f.size);
  done();
}

// ---------- inserting ----------
const emptyP = () => { const p = document.createElement('p'); p.append(document.createElement('br')); return p; };
const topOf = (n) => { while (n && n.parentNode !== editor) n = n.parentNode; return n; };
function insertBlock(node) {
  begin();
  const s = getSelection();
  let b = curBlock();
  let after;
  if (b && b.parentNode === editor && /^(P|H\d)$/.test(b.tagName)) {
    if (!s.isCollapsed) { document.execCommand('delete'); b = curBlock() || b; }
    if (b.textContent === '') { b.before(node); after = b; }
    else {
      document.execCommand('insertParagraph');
      after = topOf(curBlock()) || b;
      after.before(node);
    }
  } else {
    const top = topOf(b || (saved && saved.startContainer !== editor ? saved.startContainer : null));
    if (top) top.after(node); else editor.append(node);
    after = node.nextElementSibling;
    if (!after || !/^(P|H\d)$/.test(after.tagName)) { after = emptyP(); node.after(after); }
  }
  return after;
}
function insertTable(rows, cols) {
  const t = document.createElement('table'), tb = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) { const td = document.createElement(r === 0 ? 'th' : 'td'); td.append(document.createElement('br')); tr.append(td); }
    tb.append(tr);
  }
  t.append(tb);
  insertBlock(t);
  caretIn(t.querySelector('th,td'));
  done();
}
function tableCtx() {
  const el = selEl();
  const cell = el && el.closest('td,th');
  if (!cell || !editor.contains(cell)) return null;
  return { cell, row: cell.parentElement, table: cell.closest('table'), idx: cell.cellIndex };
}
function tableCmd(cmd) {
  restore();
  const c = tableCtx();
  if (!c) return;
  commit();
  const mk = (tag) => { const x = document.createElement(tag); x.append(document.createElement('br')); return x; };
  const rows = [...c.table.rows];
  if (cmd === 'rowAbove' || cmd === 'rowBelow') {
    const tr = document.createElement('tr');
    for (let i = 0; i < c.row.cells.length; i++) tr.append(mk('td'));
    if (cmd === 'rowAbove') c.row.before(tr); else c.row.after(tr);
    caretIn(tr.cells[Math.min(c.idx, tr.cells.length - 1)]);
  } else if (cmd === 'colLeft' || cmd === 'colRight') {
    for (const r of rows) {
      const ref = r.cells[Math.min(c.idx, r.cells.length - 1)];
      const x = mk(ref.tagName.toLowerCase());
      if (cmd === 'colLeft') ref.before(x); else ref.after(x);
    }
  } else if (cmd === 'headerRow') {
    const first = rows[0], toHead = first.cells[0].tagName === 'TD';
    keepSel(() => {
      for (const cell of [...first.cells]) {
        const x = document.createElement(toHead ? 'th' : 'td');
        while (cell.firstChild) x.append(cell.firstChild);
        cell.replaceWith(x);
      }
    });
  } else if (cmd === 'delRow') {
    const near = c.row.nextElementSibling || c.row.previousElementSibling;
    c.row.remove();
    if (near) caretIn(near.cells[Math.min(c.idx, near.cells.length - 1)]); else removeTable(c.table);
  } else if (cmd === 'delCol') {
    for (const r of rows) if (r.cells[c.idx]) r.cells[c.idx].remove();
    const row = c.table.rows[0];
    if (!row || !row.cells.length) removeTable(c.table); else caretIn(c.row.cells[Math.max(0, c.idx - 1)] || row.cells[0]);
  } else if (cmd === 'delTable') removeTable(c.table);
  done();
}
function removeTable(t) {
  const p = emptyP();
  t.replaceWith(p); caretIn(p);
}
function fileToDataUrl(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
}
async function insertImageFile(file, range) {
  if (!file || !/^image\//.test(file.type)) return;
  let url = await fileToDataUrl(file);
  const probe = new Image();
  probe.src = url;
  try { await probe.decode(); } catch { toast('That picture could not be read.'); return; }
  if (file.size > 1.5e6 && probe.naturalWidth > 1800) {
    const c = document.createElement('canvas');
    c.width = 1800; c.height = Math.round((probe.naturalHeight * 1800) / probe.naturalWidth);
    c.getContext('2d').drawImage(probe, 0, 0, c.width, c.height);
    url = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
  }
  const d = pageDims();
  const maxW = ((d.w - d.m.l - d.m.r) * MM) / d.cols;
  const img = document.createElement('img');
  img.src = url; img.alt = file.name.replace(/\.\w+$/, '');
  img.style.width = Math.round(Math.min(probe.naturalWidth, maxW)) + 'px';
  begin();
  const s = getSelection();
  const r = range || (s.rangeCount && inEditor(s.anchorNode) ? s.getRangeAt(0) : null);
  if (r) { r.deleteContents(); r.insertNode(img); r.setStartAfter(img); r.collapse(true); s.removeAllRanges(); s.addRange(r); }
  else (editor.lastElementChild || editor).append(img);
  done();
}

// images: select, resize, wrap
function selectImg(img) { selImg = img; placeImgBox(); }
function placeImgBox() {
  const box = $('#img-box');
  if (!selImg || !selImg.isConnected) { selImg = null; box.hidden = true; return; }
  const r = selImg.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  box.hidden = false;
  Object.assign(box.style, { left: r.left - c.left + canvas.scrollLeft + 'px', top: r.top - c.top + canvas.scrollTop + 'px', width: r.width + 'px', height: r.height + 'px' });
}
function imgAlign(mode) {
  if (!selImg) return;
  commit();
  const st = selImg.style;
  st.float = ''; st.display = ''; st.marginLeft = ''; st.marginRight = ''; st.marginTop = ''; st.marginBottom = '';
  if (mode === 'left') { st.float = 'left'; st.marginRight = '14px'; st.marginBottom = '8px'; st.marginTop = '4px'; }
  if (mode === 'right') { st.float = 'right'; st.marginLeft = '14px'; st.marginBottom = '8px'; st.marginTop = '4px'; }
  if (mode === 'center') { st.display = 'block'; st.marginLeft = 'auto'; st.marginRight = 'auto'; }
  done();
}
$('#img-handle').addEventListener('pointerdown', (e) => {
  if (!selImg) return;
  e.preventDefault();
  const h = e.currentTarget, x0 = e.clientX, w0 = selImg.getBoundingClientRect().width / zoomF();
  h.setPointerCapture(e.pointerId);
  commit();
  const move = (ev) => { selImg.style.width = Math.max(24, Math.round(w0 + (ev.clientX - x0) / zoomF())) + 'px'; selImg.style.height = ''; placeImgBox(); };
  const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); done(); };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
});

// links
const safeUrl = (u) => {
  u = u.trim();
  if (!u) return '';
  if (/^(javascript|data|vbscript):/i.test(u)) return '';
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(u)) return 'mailto:' + u;
  return /^(https?:|mailto:|#)/i.test(u) ? u : 'https://' + u;
};
let linkCtx = null;
function openLink() {
  restore();
  const s = getSelection();
  const a = selEl().closest('a');
  linkCtx = { a: a && editor.contains(a) ? a : null, range: s.rangeCount ? s.getRangeAt(0).cloneRange() : null };
  $('#link-text').value = linkCtx.a ? linkCtx.a.textContent : s.toString();
  $('#link-url').value = linkCtx.a ? linkCtx.a.getAttribute('href') || '' : '';
  $('#link-remove').hidden = !linkCtx.a;
  const d = $('#dlg-link');
  d.returnValue = '';
  d.showModal();
  ($('#link-text').value ? $('#link-url') : $('#link-text')).focus();
}
$('#dlg-link').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); $('#dlg-link').close('ok'); }
});
$('#dlg-link').addEventListener('close', (e) => {
  const v = e.target.returnValue, c = linkCtx;
  linkCtx = null;
  if (!c || (v !== 'ok' && v !== 'remove')) { restore(); return; }
  editor.focus({ preventScroll: true });
  const s = getSelection();
  if (c.range) { s.removeAllRanges(); s.addRange(c.range); }
  commit();
  if (v === 'remove') {
    if (c.a) { const t = document.createRange(); t.selectNodeContents(c.a); s.removeAllRanges(); s.addRange(t); document.execCommand('unlink'); }
    return done();
  }
  const url = safeUrl($('#link-url').value);
  const text = $('#link-text').value.trim();
  if (!url) { toast('That address can’t be used as a link.'); return; }
  if (c.a) { c.a.setAttribute('href', url); if (text && text !== c.a.textContent) c.a.textContent = text; }
  else if (s.isCollapsed || (text && text !== s.toString())) document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(text || url)}</a>`);
  else document.execCommand('createLink', false, url);
  done();
});

// ---------- find and replace ----------
const F = { list: [], i: -1 };
const findOpen = () => !$('#side-pane').hidden && !$('#find-pane').hidden;
function findRun(keep) {
  const q = $('#find-q').value;
  F.list = [];
  if (q) {
    const word = $('#find-word').checked;
    const src = (word ? '(?<![\\p{L}\\p{N}])' : '') + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (word ? '(?![\\p{L}\\p{N}])' : '');
    const re = new RegExp(src, 'gu' + ($('#find-case').checked ? '' : 'i'));
    for (const b of blocksOf(editor)) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(b.text))) {
        try { F.list.push(toRange(b, m.index, m.index + m[0].length)); } catch { /* skip */ }
      }
    }
  }
  F.i = F.list.length ? Math.min(Math.max(keep ? F.i : 0, 0), F.list.length - 1) : -1;
  paintFind();
}
function paintFind() {
  const n = F.list.length;
  $('#find-count').textContent = n ? `${F.i + 1} of ${n}` : ($('#find-q').value ? 'No results' : '');
  if (!canHL) return;
  CSS.highlights.delete('find'); CSS.highlights.delete('find-current');
  if (!n) return;
  const rest = F.list.filter((_, i) => i !== F.i);
  if (rest.length) CSS.highlights.set('find', new Highlight(...rest));
  const cur = new Highlight(F.list[F.i]); cur.priority = 2;
  CSS.highlights.set('find-current', cur);
}
function clearFind() { F.list = []; F.i = -1; if (canHL) { CSS.highlights.delete('find'); CSS.highlights.delete('find-current'); } }
function scrollToRange(r) {
  const b = r.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  if (b.top < c.top + 40 || b.bottom > c.bottom - 40) canvas.scrollTop += b.top - c.top - c.height / 3;
}
function findStep(d) {
  if (!F.list.length) return findRun();
  F.i = (F.i + d + F.list.length) % F.list.length;
  paintFind(); scrollToRange(F.list[F.i]);
}
function swap(r, text) { r.deleteContents(); if (text) r.insertNode(document.createTextNode(text)); }
function replaceOne() {
  if (F.i < 0) return findRun();
  commit();
  swap(F.list[F.i], $('#find-r').value);
  editor.normalize(); commit(); changed(true);
  const before = F.list.length, at = F.i;
  findRun(true);
  if (F.list.length === before && before > 1) { F.i = (at + 1) % before; paintFind(); }   // replacement still matches: move on
  if (F.list.length) scrollToRange(F.list[F.i]);
}
function replaceAll() {
  findRun(true);
  const n = F.list.length;
  if (!n) return toast('Nothing to replace.');
  commit();
  for (let i = n - 1; i >= 0; i--) swap(F.list[i], $('#find-r').value);
  editor.normalize(); commit(); changed(true);
  findRun();
  toast(`Replaced ${n} ${n === 1 ? 'match' : 'matches'}.`);
}

// ---------- side panes, menus ----------
function showSide(which) {
  $('#side-pane').hidden = !which;
  $('#proof-pane').hidden = which !== 'proof';
  $('#find-pane').hidden = which !== 'find';
  if (which !== 'find') clearFind();
  if (which === 'proof') { proofSig = null; renderProof(); }
  if (which === 'find') {
    const t = getSelection().toString();
    if (t && !t.includes('\n') && inEditor(getSelection().anchorNode)) $('#find-q').value = t;
    $('#find-q').focus(); $('#find-q').select();
    findRun();
  }
  placeImgBox();
}
let openBtn = null;
function closeMenus() { $$('.menu').forEach((m) => { m.hidden = true; }); openBtn = null; }
function placeMenu(m, x, y, altY) {
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  let top = y;
  if (top + h > innerHeight - 8) top = Math.max(8, (altY != null ? altY : y) - h);
  m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  m.style.top = top + 'px';
}
function toggleMenu(btn) {
  const m = $('#' + btn.dataset.menu), was = openBtn === btn;
  closeMenus();
  if (was) return;
  const r = btn.getBoundingClientRect();
  if (m.id === 'm-style') $$('button', m).forEach((b) => b.classList.toggle('on', b.dataset.val === styleOf(curBlock())));
  placeMenu(m, r.left, r.bottom + 4, r.top - 4);
  openBtn = btn;
}
function showTab(name) {
  $$('.tab[data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
}

// ---------- proofing UI ----------
const LABEL = { spell: 'Spelling', grammar: 'Grammar', style: 'Clarity' };
let proofSig = null, issueMap = new Map();
function renderProof(st = proof.state()) {
  const sc = proof.score();
  const chip = $('#st-proof');
  let label;
  if (!st.enabled) label = 'Proofing off';
  else if (!st.ready && !st.failed) label = 'Loading dictionary…';
  else if (sc.total === 0) label = st.failed ? 'No grammar issues' : 'No issues';
  else label = `${sc.total} ${sc.total === 1 ? 'issue' : 'issues'}`;
  chip.lastElementChild.textContent = label;
  chip.classList.toggle('has', st.enabled && sc.total > 0);
  if ($('#side-pane').hidden || $('#proof-pane').hidden) return;

  $('#ring-fg').style.strokeDashoffset = st.enabled ? 119.4 * (1 - sc.value / 100) : 119.4;
  $('#score-num').textContent = st.enabled ? sc.value : '–';
  $('#score-sub').textContent = !st.enabled ? 'Checking is switched off' : !st.ready && !st.failed ? 'Loading dictionary…'
    : sc.total === 0 ? 'Nothing to fix. Nice work.' : `${sc.total} ${sc.total === 1 ? 'suggestion' : 'suggestions'} to review`;
  $('#proof-counts').innerHTML = ['spell', 'grammar', 'style'].map((k) => `<span><i class="dot ${k}"></i>${sc[k]} ${LABEL[k].toLowerCase()}</span>`).join('');

  const box = $('#issues');
  const shown = st.issues.slice(0, 80);
  const sig = shown.map((i) => i.type + i.key).join('\n') + st.failed + st.enabled;
  issueMap = new Map(shown.map((i, n) => [String(n), i]));
  if (sig === proofSig) return;
  proofSig = sig;
  box.textContent = '';
  if (st.failed) box.insertAdjacentHTML('beforeend', '<p class="empty">The spelling dictionary could not be loaded, so only grammar is being checked.</p>');
  if (!st.enabled) { box.insertAdjacentHTML('beforeend', '<p class="empty">Turn on “Check as you type” in the Review tab to see suggestions.</p>'); return; }
  if (!shown.length) { if (!st.failed) box.insertAdjacentHTML('beforeend', '<p class="empty">No spelling or grammar issues found.</p>'); return; }
  shown.forEach((it, n) => {
    const card = document.createElement('div');
    card.className = 'issue ' + it.type; card.dataset.n = n;
    card.innerHTML = `<div class="issue-top"><i class="dot ${it.type}"></i><b>${LABEL[it.type]}</b><span>${esc(it.msg)}</span></div>`
      + `<div class="issue-ctx">${esc(it.ctx.pre)}<mark>${esc(it.ctx.hit)}</mark>${esc(it.ctx.post)}</div>`
      + `<div class="issue-fix"><span class="fixes"></span><button class="link-btn" data-act="ignore">Ignore</button>${it.type === 'spell' ? '<button class="link-btn" data-act="dict">Add to dictionary</button>' : ''}</div>`;
    box.append(card);
    if (it.sugg) fillChips(card, it.sugg);
    else if (n < 12) loadChips(card, it);
    else card.addEventListener('pointerenter', () => loadChips(card, it), { once: true });
  });
  if (st.issues.length > shown.length) box.insertAdjacentHTML('beforeend', `<p class="empty">Showing the first ${shown.length} of ${st.issues.length}.</p>`);
}
function fillChips(card, list) {
  const f = card.querySelector('.fixes');
  f.innerHTML = list.slice(0, 4).map((s) => `<button class="chip" data-fix="${esc(s)}">${s === '' ? 'Remove' : esc(s)}</button>`).join('');
}
function loadChips(card, it) {
  proof.suggestionsFor(it).then((list) => { if (card.isConnected) fillChips(card, list); }).catch(() => {});
}
function gotoIssue(it) {
  if (!it.range || !inEditor(it.range.startContainer)) return;
  const s = getSelection(); s.removeAllRanges(); s.addRange(it.range);
  scrollToRange(it.range);
}
function applyFix(it, text) {
  const r = it.range;
  if (!r || !inEditor(r.startContainer) || r.collapsed) { proof.schedule(0); return; }
  editor.focus({ preventScroll: true });
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  commit();
  if (text === '') document.execCommand('delete'); else document.execCommand('insertText', false, text);
  commit(); changed(true); proof.schedule(0);
}
function issueAct(it, act) {
  if (act === 'ignore') proof.ignoreOnce(it);
  else if (act === 'all') proof.ignoreAll(it);
  else if (act === 'dict') { proof.addToDictionary(it); toast(`Added “${it.text}” to your dictionary.`); }
}
$('#issues').addEventListener('click', (e) => {
  const card = e.target.closest('.issue');
  const it = card && issueMap.get(card.dataset.n);
  if (!it) return;
  const fix = e.target.closest('[data-fix]'), act = e.target.closest('[data-act]');
  if (fix) applyFix(it, fix.dataset.fix);
  else if (act) issueAct(it, act.dataset.act);
  else gotoIssue(it);
});
let ctxIssue = null;
editor.addEventListener('contextmenu', (e) => {
  const it = proof.issueAt(e.clientX, e.clientY);
  if (!it) return;
  e.preventDefault();
  closeMenus();
  ctxIssue = it;
  const m = $('#ctx');
  const tail = `<hr><button data-ctx="ignore">Ignore once</button><button data-ctx="all">${it.type === 'spell' ? 'Ignore all' : 'Stop checking this rule'}</button>${it.type === 'spell' ? '<button data-ctx="dict">Add to dictionary</button>' : ''}`;
  const build = (list, loading) => {
    m.innerHTML = `<div class="ctx-msg">${esc(it.msg)}</div>`
      + (loading ? '<div class="ctx-msg">Finding suggestions…</div>' : list.length
        ? list.slice(0, 5).map((s) => `<button class="sugg" data-sugg="${esc(s)}">${s === '' ? 'Remove' : esc(s)}</button>`).join('') : '<div class="ctx-msg">No suggestions</div>')
      + tail;
    placeMenu(m, e.clientX, e.clientY + 6);
  };
  if (it.sugg) build(it.sugg); else {
    build([], true);
    proof.suggestionsFor(it).then((list) => { if (ctxIssue === it && !m.hidden) build(list); }).catch(() => build([]));
  }
});
$('#ctx').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !ctxIssue) return;
  if (b.dataset.sugg != null) applyFix(ctxIssue, b.dataset.sugg); else issueAct(ctxIssue, b.dataset.ctx);
  closeMenus();
});

// ---------- word count, read aloud ----------
function wordCount() {
  const s = getSelection();
  const selText = inEditor(s.anchorNode) ? s.toString() : '';
  const row = (t) => {
    const w = (t.match(WORDS) || []).length;
    return { w, chars: t.replace(/\n/g, '').length, nosp: t.replace(/\s/g, '').length };
  };
  const all = row(editor.innerText);
  const paras = $$(BLOCK, editor).filter((b) => b.textContent.trim() && !b.querySelector(BLOCK)).length;
  const mins = Math.max(1, Math.round(all.w / 230));
  let h = `<dt>Words</dt><dd>${all.w.toLocaleString()}</dd><dt>Characters</dt><dd>${all.chars.toLocaleString()}</dd><dt>Characters, no spaces</dt><dd>${all.nosp.toLocaleString()}</dd>`
    + `<dt>Paragraphs</dt><dd>${paras}</dd><dt>Pages (estimate)</dt><dd>${pageInfo().total}</dd><dt>Reading time</dt><dd>${all.w ? `about ${mins} min` : '–'}</dd>`;
  if (selText.trim()) { const r = row(selText); h += `<div class="sep"></div><dt>Selected words</dt><dd>${r.w.toLocaleString()}</dd><dt>Selected characters</dt><dd>${r.chars.toLocaleString()}</dd>`; }
  $('#stats').innerHTML = h;
  $('#dlg-count').showModal();
}
function setRead(on) { $('#read-btn').lastChild.textContent = on ? 'Stop reading' : 'Read aloud'; $('#read-btn').classList.toggle('on', on); }
function readAloud() {
  const sy = window.speechSynthesis;
  if (!sy) return toast('Read aloud isn’t available in this browser.');
  if (sy.speaking) { sy.cancel(); setRead(false); return; }
  const s = getSelection();
  const text = (inEditor(s.anchorNode) && s.toString().trim()) || editor.innerText;
  if (!text.trim()) return;
  const u = new SpeechSynthesisUtterance(text.slice(0, 30000));
  u.lang = prefs.lang.replace('_', '-');
  u.onend = u.onerror = () => setRead(false);
  sy.speak(u); setRead(true);
}

// ---------- cleaning imported / pasted HTML ----------
const KEEP_CLASS = new Set(['doc-title', 'doc-subtitle', 'no-spacing', 'quote', 'page-break']);
const STYLE_FULL = ['font-weight', 'font-style', 'text-decoration-line', 'color', 'background-color', 'font-size', 'font-family', 'text-align', 'line-height', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'vertical-align', 'width', 'float'];
const STYLE_PASTE = ['font-weight', 'font-style', 'text-decoration-line', 'color', 'background-color', 'text-align', 'vertical-align'];
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'DIV', 'BLOCKQUOTE', 'PRE', 'HR', 'BODY', 'SECTION', 'ARTICLE', 'BR']);
const NOISE = /^(normal|400|start|left|baseline|none|rgb\(0, 0, 0\)|rgb\(255, 255, 255\)|rgba\(0, 0, 0, 0\)|transparent|black|white)$/i;
function clean(html, { full = false, collapse = true } = {}) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script,style,meta,link,title,iframe,object,embed,form,input,button,select,textarea,svg,noscript,template').forEach((n) => n.remove());
  const cw = d.createTreeWalker(d.body, NodeFilter.SHOW_COMMENT), dead = [];
  while (cw.nextNode()) dead.push(cw.currentNode);
  dead.forEach((n) => n.remove());
  for (const el of [...d.body.querySelectorAll('*')]) {
    if (el.tagName === 'B' && /normal|400/.test(el.style.fontWeight)) { el.replaceWith(...el.childNodes); continue; }
    let css = '';
    for (const p of full ? STYLE_FULL : STYLE_PASTE) {
      const v = el.style.getPropertyValue(p);
      if (!v || /url\(|expression|var\(/i.test(v) || (!full && NOISE.test(v))) continue;
      css += `${p}:${v};`;
    }
    if (el.tagName === 'IMG' && el.style.display === 'block') css += 'display:block;';
    const cls = [...el.classList].filter((c) => KEEP_CLASS.has(c)).join(' ');
    for (const a of [...el.attributes]) {
      const n = a.name, v = a.value.trim();
      if (n === 'href' && /^(https?:|mailto:|#)/i.test(v)) continue;
      if (n === 'src' && el.tagName === 'IMG' && /^(data:image\/|https?:|blob:)/i.test(v)) continue;
      if (n === 'alt' || n === 'colspan' || n === 'rowspan') continue;
      el.removeAttribute(n);
    }
    if (css) el.setAttribute('style', css);
    if (cls) el.className = cls;
    if (el.classList.contains('page-break')) el.setAttribute('contenteditable', 'false');
  }
  if (collapse) {
    const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT), kill = [];
    const isB = (n) => !n || (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName));
    let t;
    while ((t = w.nextNode())) {
      if (t.parentElement.closest('pre')) continue;
      let s = t.data.replace(/[ \t\r\n]+/g, ' ');
      const pb = BLOCK_TAGS.has(t.parentElement.tagName);
      if (pb && isB(t.previousSibling)) s = s.replace(/^ /, '');
      if (pb && isB(t.nextSibling)) s = s.replace(/ $/, '');
      if (s === '') kill.push(t); else t.data = s;
    }
    kill.forEach((n) => n.remove());
  }
  return d.body.innerHTML;
}
function textToHtml(t, md) {
  return t.replace(/\r/g, '').split('\n').map((line) => {
    const m = md && /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) return `<h${m[1].length}>${esc(m[2])}</h${m[1].length}>`;
    return line.trim() ? `<p>${esc(line)}</p>` : '';
  }).join('') || '<p><br></p>';
}

// ---------- documents ----------
function setDoc(d, html) {
  doc = { id: d.id, title: d.title, theme: d.theme || 'modern', page: { ...newDoc().page, ...(d.page || {}) }, created: d.created || Date.now(), updated: d.updated || Date.now() };
  editor.innerHTML = html || '<p><br></p>';
  if (!editor.firstElementChild) editor.innerHTML = `<p>${editor.innerHTML || '<br>'}</p>`;
  $('#title').value = doc.title; document.title = doc.title + ' · Inkwell';
  H.stack = []; H.idx = -1; commit();
  saved = null; selectImg(null); clearFind();
  applyPage(); applyTheme();
  canvas.scrollTop = 0;
  setSave('Saved');
  prefs.lastId = doc.id; savePrefs();
  proof.schedule(0); meta(); refreshUI();
}
async function flush() { clearTimeout(saveTimer); if ($('#save-state').textContent !== 'Saved') await save(); }
async function openDoc(id) {
  await flush();
  let rec = null;
  try { rec = await store.get(id); } catch { /* storage unavailable */ }
  if (!rec) return toast('That document could not be opened.');
  setDoc(rec, rec.html);
  $('#backstage').hidden = true;
  caretIn(editor.firstElementChild);
}
async function createDoc(title, html, extra = {}) {
  await flush();
  setDoc({ ...newDoc(title), ...extra }, html);
  $('#backstage').hidden = true;
  if (html) await save();
  caretIn(editor.firstElementChild);
}
async function openFile(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, ''), ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'docx') {
      const mammoth = await loadScript('vendor/mammoth.browser.min.js', 'mammoth');
      const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
        styleMap: ["p[style-name='Title'] => p.doc-title:fresh", "p[style-name='Subtitle'] => p.doc-subtitle:fresh", "p[style-name='Quote'] => p.quote:fresh", "p[style-name='No Spacing'] => p.no-spacing:fresh"],
      });
      await createDoc(name, clean(res.value, { full: true }));
    } else if (ext === 'html' || ext === 'htm') {
      const text = await file.text();
      const d = new DOMParser().parseFromString(text, 'text/html');
      const own = !!d.querySelector('meta[name="generator"][content="Inkwell"]');
      const root = (own && d.querySelector('.doc')) || d.body;
      await createDoc(d.title || name, clean(root.innerHTML, { full: true, collapse: !own }), own && root.dataset.theme ? { theme: root.dataset.theme } : {});
    } else {
      await createDoc(name, textToHtml(await file.text(), ext === 'md'));
    }
    toast(`Opened ${file.name}`);
  } catch (err) {
    console.error(err);
    toast('Sorry, that file could not be opened.');
  }
}
async function renderRecent() {
  const box = $('#recent');
  let list = [];
  try { list = await store.all(); } catch { /* storage unavailable */ }
  list.sort((a, b) => b.updated - a.updated);
  box.textContent = '';
  if (!list.length) { box.innerHTML = '<p class="empty">Nothing saved yet. Start typing and your document will appear here.</p>'; return; }
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  for (const r of list) {
    const card = document.createElement('div');
    card.className = 'doc-card' + (doc && r.id === doc.id ? ' current' : '');
    card.tabIndex = 0; card.setAttribute('role', 'button');
    card.innerHTML = `<h3>${esc(r.title || 'Untitled document')}</h3><p>${esc(r.excerpt || 'Empty document')}</p><time>Edited ${fmt.format(r.updated)}</time><button class="rb del" title="Delete" aria-label="Delete document">${ic('trash')}</button>`;
    const del = card.querySelector('.del');
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = 'Delete?'; setTimeout(() => { if (del.isConnected) { del.classList.remove('sure'); del.innerHTML = ic('trash'); } }, 3000); return; }
      try { await store.del(r.id); } catch { /* ignore */ }
      if (doc && r.id === doc.id) { clearTimeout(saveTimer); setSave('Saved'); setDoc(newDoc(), ''); }
      renderRecent();
    };
    card.onclick = () => openDoc(r.id);
    card.onkeydown = (e) => { if (e.key === 'Enter' && e.target === card) openDoc(r.id); };
    box.append(card);
  }
}
function toggleBackstage(on = $('#backstage').hidden) {
  $('#backstage').hidden = !on;
  closeMenus();
  if (on) { flush().then(renderRecent); } else restore();
}

// ---------- export ----------
async function saveDocx() {
  toast('Building Word document…');
  try {
    download(await exportDocx(editor, { title: doc.title, page: pageDims() }), fileBase() + '.docx');
    toast('Word document downloaded.');
  } catch (err) { console.error(err); toast('Sorry, the Word export failed.'); }
}
async function buildHtml() {
  const css = await fetch('css/doc.css').then((r) => r.text()).catch(() => '');
  const d = pageDims();
  const html = `<!doctype html>\n<html lang="${editor.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Inkwell"><title>${esc(doc.title)}</title><style>${css}\nbody{margin:0;background:#f1f1ee}.doc{box-sizing:border-box;max-width:${d.w}mm;margin:24px auto;padding:${d.m.t}mm ${d.m.r}mm ${d.m.b}mm ${d.m.l}mm;background:#fff;white-space:pre-wrap;overflow-wrap:break-word}.doc .page-break::after{display:none}@media print{body{background:none}.doc{margin:0;padding:0;max-width:none}}</style></head><body><div class="doc"${doc.theme !== 'modern' ? ` data-theme="${doc.theme}"` : ''}>${editor.innerHTML}</div></body></html>`;
  return new Blob([html], { type: 'text/html' });
}
async function saveHtml() { download(await buildHtml(), fileBase() + '.html'); }

// ---------- save to this device ----------
// Where the browser allows it (Chrome, Edge), Save writes straight to a file the
// user picked and later saves overwrite that file. Elsewhere it downloads a copy.
const FILE_TYPES = [
  { description: 'Word document', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } },
  { description: 'Inkwell web page (keeps all formatting)', accept: { 'text/html': ['.html'] } },
  { description: 'Plain text', accept: { 'text/plain': ['.txt'] } },
];
let fileHandle = null, fileDocId = null;
async function blobFor(name) {
  if (/\.html?$/i.test(name)) return buildHtml();
  if (/\.(txt|md)$/i.test(name)) return new Blob([editor.innerText], { type: 'text/plain' });
  return exportDocx(editor, { title: doc.title, page: pageDims() });
}
async function saveToDevice(saveAs) {
  $('#backstage').hidden = true;
  await flush();
  if (!window.showSaveFilePicker) {
    try {
      download(await blobFor('x.docx'), fileBase() + '.docx');
      toast('Saved to your Downloads folder as a Word document.');
    } catch (err) { console.error(err); toast('Sorry, the document could not be saved.'); }
    return;
  }
  let handle = fileDocId === doc.id ? fileHandle : null;
  if (!handle || saveAs) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: fileBase() + '.docx', types: FILE_TYPES });
    } catch (err) {
      if (err && err.name === 'AbortError') return;   // picker cancelled
      console.error(err); toast('Sorry, the document could not be saved.'); return;
    }
  }
  try {
    const blob = await blobFor(handle.name);
    const w = await handle.createWritable();
    await w.write(blob); await w.close();
    fileHandle = handle; fileDocId = doc.id;
    toast(`Saved to ${handle.name}`);
  } catch (err) {
    console.error(err);
    if (fileHandle === handle) { fileHandle = null; fileDocId = null; }
    toast('Sorry, that file could not be written. Try Save as.');
  }
}

// ---------- commands ----------
function run(cmd, val, el) {
  switch (cmd) {
    case 'undo': restore(); undo(); break;
    case 'redo': restore(); redo(); break;
    case 'bold': case 'italic': case 'underline': exec(cmd); break;
    case 'strike': exec('strikeThrough'); break;
    case 'sub': exec('subscript'); break;
    case 'sup': exec('superscript'); break;
    case 'fontName': exec('fontName', val); break;
    case 'fontSize': if (parseFloat(val)) setSize(parseFloat(val)); break;
    case 'grow': stepSize(1); break;
    case 'shrink': stepSize(-1); break;
    case 'color': lastColor = val; $('#color-bar').style.background = val; exec('foreColor', val); break;
    case 'hilite': if (val !== 'transparent') { lastHilite = val; $('#hilite-bar').style.background = val; } exec('hiliteColor', val); break;
    case 'clear': clearFormat(); break;
    case 'painter': togglePainter(); break;
    case 'ul': exec('insertUnorderedList'); break;
    case 'ol': exec('insertOrderedList'); break;
    case 'indent': indent(1); break;
    case 'outdent': indent(-1); break;
    case 'align': { const v = { Left: '', Center: 'center', Right: 'right', Full: 'justify' }[val]; blockProp((b) => { b.style.textAlign = v; }); break; }
    case 'lineHeight': blockProp((b) => { b.style.lineHeight = val; }); break;
    case 'space': { const [side, n] = val.split(':'); blockProp((b) => { b.style[side === 'before' ? 'marginTop' : 'marginBottom'] = n + 'pt'; }); break; }
    case 'style': applyStyle(val); break;
    case 'case': changeCase(val); break;
    case 'find': showSide(findOpen() ? null : 'find'); break;
    case 'findNext': findStep(1); break;
    case 'findPrev': findStep(-1); break;
    case 'replaceOne': replaceOne(); break;
    case 'replaceAll': replaceAll(); break;
    case 'closeSide': showSide(null); restore(); break;
    case 'proofPane': showSide(!$('#side-pane').hidden && !$('#proof-pane').hidden ? null : 'proof'); break;
    case 'image': $('#file-image').click(); break;
    case 'link': openLink(); break;
    case 'pageBreak': { const d = document.createElement('div'); d.className = 'page-break'; d.contentEditable = 'false'; caretIn(insertBlock(d)); done(); break; }
    case 'hr': caretIn(insertBlock(document.createElement('hr'))); done(); break;
    case 'date': exec('insertText', new Date().toLocaleDateString(prefs.lang.replace('_', '-'), { day: 'numeric', month: 'long', year: 'numeric' })); break;
    case 'symbol': exec('insertText', val); break;
    case 'table': { const [r, c] = val.split('x').map(Number); insertTable(r, c); break; }
    case 'rowAbove': case 'rowBelow': case 'colLeft': case 'colRight': case 'headerRow': case 'delRow': case 'delCol': case 'delTable': tableCmd(cmd); break;
    case 'imgAlign': imgAlign(val); break;
    case 'imgDelete': if (selImg) { commit(); selImg.remove(); selectImg(null); done(); } break;
    case 'theme': doc.theme = val; applyTheme(); changed(true); break;
    case 'margins': doc.page.margins = val; applyPage(); changed(true); break;
    case 'orient': doc.page.orient = val; applyPage(); changed(true); break;
    case 'pageSize': doc.page.size = val; applyPage(); changed(true); break;
    case 'cols': doc.page.cols = Number(val); applyPage(); changed(true); break;
    case 'lang': prefs.lang = val; savePrefs(); applyLang(); proof.setLang(val); renderProof(); break;
    case 'wordCount': wordCount(); break;
    case 'readAloud': readAloud(); break;
    case 'navPane': prefs.nav = $('#nav-pane').hidden; $('#nav-pane').hidden = !prefs.nav; savePrefs(); if (prefs.nav) renderOutline(); placeImgBox(); break;
    case 'focus': { const on = !document.body.classList.contains('focus'); document.body.classList.toggle('focus', on); $('#focus-exit').hidden = !on; closeMenus(); placeImgBox(); if (on) toast('Focus mode. Press Esc to leave.'); break; }
    case 'dark': prefs.dark = document.documentElement.dataset.theme !== 'dark'; savePrefs(); applyDark(); break;
    case 'zoomIn': zoomTo(prefs.zoom + 10); break;
    case 'zoomOut': zoomTo(prefs.zoom - 10); break;
    case 'zoom': zoomTo(Number(val) || 100); break;
    case 'zoomFit': zoomTo(Math.floor(((canvas.clientWidth - 48) / (pageDims().w * MM)) * 20) * 5); break;
    case 'print': $('#backstage').hidden = true; window.print(); break;
    case 'backstage': toggleBackstage(); break;
    case 'new': createDoc('Untitled document', ''); break;
    case 'open': $('#file-open').click(); break;
    case 'save': saveToDevice(false); break;
    case 'saveAs': saveToDevice(true); break;
    case 'saveDocx': saveDocx(); break;
    case 'saveHtml': saveHtml(); break;
    case 'saveTxt': download(new Blob([editor.innerText], { type: 'text/plain' }), fileBase() + '.txt'); break;
    default: console.warn('Unknown command', cmd, el);
  }
}

// ---------- ribbon state ----------
let uiQueued = false;
function refreshUI() {
  if (uiQueued) return;
  uiQueued = true;
  requestAnimationFrame(() => {
    uiQueued = false;
    const s = getSelection();
    if (!s.rangeCount || !inEditor(s.anchorNode)) return;
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const on = (sel, v) => $$(sel).forEach((b) => b.classList.toggle('on', !!v));
    on('[data-cmd="bold"]', q('bold')); on('[data-cmd="italic"]', q('italic')); on('[data-cmd="underline"]', q('underline'));
    on('[data-cmd="strike"]', q('strikeThrough')); on('[data-cmd="sub"]', q('subscript')); on('[data-cmd="sup"]', q('superscript'));
    on('[data-cmd="ul"]', q('insertUnorderedList')); on('[data-cmd="ol"]', q('insertOrderedList'));
    on('[data-cmd="painter"]', painter);
    const b = curBlock(), el = selEl();
    const ta = b ? getComputedStyle(b).textAlign : 'left';
    const al = ta === 'center' ? 'Center' : ta === 'right' || ta === 'end' ? 'Right' : ta === 'justify' ? 'Full' : 'Left';
    $$('#ribbon [data-cmd="align"]').forEach((x) => x.classList.toggle('on', x.dataset.val === al));
    $('#style-label').textContent = b && b.closest('li') ? 'List' : STYLES[styleOf(b && (b.tagName === 'TD' || b.tagName === 'TH') ? null : b)][2];
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const fn = $('#font-name');
    fn.value = FONTS.find((f) => f.toLowerCase() === fam.toLowerCase()) || '';
    if (!fn.value) fn.options[0].textContent = fam;
    const size = pendingSize || Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2;
    const fs = $('#font-size');
    fs.value = SIZES.includes(size) ? String(size) : '';
    if (!fs.value) fs.options[0].textContent = size;
    const inTable = !!el.closest('td,th');
    const tab = $('.tab.ctx');
    if (tab.hidden === inTable) {
      tab.hidden = !inTable;
      if (!inTable && tab.classList.contains('on')) showTab('home');
    }
    const p = pageInfo();
    $('#st-page').textContent = `Page ${p.cur} of ${p.total}`;
  });
}

// ---------- events ----------
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  if (s.rangeCount && inEditor(s.anchorNode)) { saved = s.getRangeAt(0).cloneRange(); refreshUI(); }
});
document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (!t.closest('.menu') && !t.closest('[data-menu]')) closeMenus();
  if (t.closest('.ribbon,.tabs,.menu,.img-bar,.titlebar,.statusbar') && !t.closest('input,select,label,textarea')) e.preventDefault();
});
document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-menu]');
  if (m) return toggleMenu(m);
  const tab = e.target.closest('.tab[data-tab]');
  if (tab) return showTab(tab.dataset.tab);
  const b = e.target.closest('[data-cmd]');
  if (!b || b.matches('select,input')) return;
  if (b.closest('dialog') && b.closest('form')) return;
  const inMenu = b.closest('.menu');
  run(b.dataset.cmd, b.dataset.val, b);
  if (inMenu) closeMenus();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('select[data-cmd]')) run(t.dataset.cmd, t.value, t);
  else if (t.matches('input[type=color][data-cmd]')) { run(t.dataset.cmd, t.value, t); closeMenus(); }
});
$('#proof-on').addEventListener('change', (e) => { prefs.proofOn = e.target.checked; savePrefs(); proof.setEnabled(prefs.proofOn); });
$('#zoom-range').addEventListener('input', (e) => zoomTo(Number(e.target.value)));
$('#title').addEventListener('input', (e) => { doc.title = e.target.value.trim() || 'Untitled document'; document.title = doc.title + ' · Inkwell'; setSave('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); });
$('#title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); restore(); } });
$('#title').addEventListener('blur', (e) => { e.target.value = doc.title; });
$('#file-image').addEventListener('change', async (e) => { for (const f of e.target.files) await insertImageFile(f); e.target.value = ''; });
$('#file-open').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
for (const id of ['find-q', 'find-case', 'find-word']) $('#' + id).addEventListener('input', () => findRun());
$('#find-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } });
$('#find-r').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });

editor.addEventListener('input', (e) => {
  if ($('[style*="xxx-large"],font[size="7"]', editor)) keepSel(() => fixSizes(pendingSize || 11));
  if (e.inputType === 'insertParagraph') {
    const b = curBlock();
    if (b && b.textContent === '' && b.parentNode === editor) {
      if (/^H\d$/.test(b.tagName)) { const p = emptyP(); b.replaceWith(p); caretIn(p); }
      else if (b.tagName === 'P' && (b.classList.contains('doc-title') || b.classList.contains('doc-subtitle'))) b.removeAttribute('class');
    }
  }
  changed();
});
editor.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); }
  if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
});
editor.addEventListener('mousedown', () => { pendingSize = null; });
editor.addEventListener('mouseup', () => { if (painter && !getSelection().isCollapsed) setTimeout(paint, 0); });
editor.addEventListener('click', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG') {
    selectImg(t);
    const r = document.createRange(); r.selectNode(t);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return;
  }
  selectImg(null);
  if (t.tagName === 'HR' || (t.classList && t.classList.contains('page-break'))) {
    const r = document.createRange(); r.selectNode(t);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  const a = t.closest && t.closest('a[href]');
  if (a && (e.metaKey || e.ctrlKey) && /^(https?:|mailto:)/i.test(a.getAttribute('href'))) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
});
editor.addEventListener('keydown', (e) => {
  if (selImg && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); return run('imgDelete'); }
  if (selImg && !e.metaKey && !e.ctrlKey) selectImg(null);
  if (e.key.startsWith('Arrow')) pendingSize = null;
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const b = curBlock();
    const c = tableCtx();
    if (c) {
      const cells = $$('td,th', c.table);
      let next = cells[cells.indexOf(c.cell) + (e.shiftKey ? -1 : 1)];
      if (!next && !e.shiftKey) { tableCmd('rowBelow'); next = $$('td,th', c.table)[cells.length]; }
      if (next) { const r = document.createRange(); r.selectNodeContents(next); if (next.textContent === '') r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    } else if (b && b.closest('li')) exec(e.shiftKey ? 'outdent' : 'indent');
    else if (!e.shiftKey) exec('insertText', '\t');
    else indent(-1);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    const b = curBlock();
    if (b && b.tagName === 'PRE') {
      e.preventDefault();
      const s = getSelection(), r = s.getRangeAt(0).cloneRange();
      r.selectNodeContents(b); r.setStart(s.focusNode, s.focusOffset);
      const atEnd = r.toString().trim() === '';
      commit();
      if (atEnd && /\n\s*$/.test(b.innerText) && b.innerText.trim()) {
        while (b.lastChild && (b.lastChild.nodeName === 'BR' || (b.lastChild.nodeType === 3 && !b.lastChild.data.trim()))) b.lastChild.remove();
        if (b.lastChild && b.lastChild.nodeType === 3) b.lastChild.data = b.lastChild.data.replace(/\n+$/, '');
        const p = emptyP(); b.after(p); caretIn(p);
      } else document.execCommand('insertLineBreak');
      done();
    }
  }
});
editor.addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  const imgs = [...cd.files].filter((f) => /^image\//.test(f.type));
  const html = cd.getData('text/html');
  e.preventDefault();
  if (imgs.length && !html) { imgs.reduce((p, f) => p.then(() => insertImageFile(f)), Promise.resolve()); return; }
  commit();
  if (html) document.execCommand('insertHTML', false, clean(html.replace(/<!--(Start|End)Fragment-->/g, '')));
  else document.execCommand('insertText', false, cd.getData('text/plain'));
  done();
});
editor.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
editor.addEventListener('drop', (e) => {
  const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  let r = null;
  if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(e.clientX, e.clientY);
  else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
  files.reduce((p, f) => p.then(() => insertImageFile(f, r && inEditor(r.startContainer) ? r : null)), Promise.resolve());
});
canvas.addEventListener('mousedown', (e) => { if (e.target === canvas || e.target === page) { selectImg(null); } });
window.addEventListener('resize', () => { closeMenus(); placeImgBox(); });

document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  const typing = e.target.closest && e.target.closest('input,textarea,select') && e.target !== editor;
  if (e.key === 'Escape') {
    if ($$('.menu').some((m) => !m.hidden)) closeMenus();
    else if (painter) togglePainter();
    else if (!$('#backstage').hidden) toggleBackstage(false);
    else if (document.body.classList.contains('focus')) run('focus');
    else if (!$('#side-pane').hidden && !$('dialog[open]')) { showSide(null); restore(); }
    return;
  }
  if (!mod) return;
  if (k === 'f' && !e.shiftKey && !e.altKey) { e.preventDefault(); showSide('find'); return; }
  if (k === 's') { e.preventDefault(); saveToDevice(e.shiftKey); return; }
  if (typing || $('dialog[open]') || !$('#backstage').hidden) return;
  if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (k === 'y' && !isMac) { e.preventDefault(); redo(); return; }
  if (k === 'k') { e.preventDefault(); openLink(); return; }
  if (e.key === 'Enter') { e.preventDefault(); run('pageBreak'); return; }
  if (e.altKey && /^Digit[0-3]$/.test(e.code)) { e.preventDefault(); applyStyle(['normal', 'h1', 'h2', 'h3'][Number(e.code.slice(5))]); }
});
let zoomBefore = null;
window.addEventListener('beforeprint', () => { proof.clearMarks(); clearFind(); selectImg(null); zoomBefore = page.style.zoom; page.style.zoom = ''; });
window.addEventListener('afterprint', () => { page.style.zoom = zoomBefore || ''; proof.schedule(0); if (findOpen()) findRun(true); });
window.addEventListener('pagehide', () => { if ($('#save-state').textContent !== 'Saved') save(); });

// ---------- build static UI ----------
function buildUI() {
  $$('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', ic(el.dataset.icon)));
  $('#font-name').innerHTML = '<option value="" hidden>Theme font</option>' + FONTS.map((f) => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('');
  $('#font-size').innerHTML = '<option value="" hidden>11</option>' + SIZES.map((s) => `<option>${s}</option>`).join('');
  $('[data-pal="color"]').innerHTML = COLORS.map((c) => `<button data-cmd="color" data-val="${c}" style="background:${c}" title="${c}" aria-label="Colour ${c}"></button>`).join('');
  $('[data-pal="hilite"]').innerHTML = HILITES.map((c) => `<button data-cmd="hilite" data-val="${c}" style="background:${c}" title="${c}" aria-label="Highlight ${c}"></button>`).join('');
  $('#symbols').innerHTML = SYMBOLS.map((s) => `<button data-cmd="symbol" data-val="${esc(s)}">${esc(s)}</button>`).join('');
  $('#themes').innerHTML = THEMES.map((t) => `<button class="theme-card" data-cmd="theme" data-val="${t.id}" title="${t.name} theme"><b style='font-family:${t.font}'>Aa</b><span>${t.name}</span></button>`).join('');
  const grid = $('#tgrid'), ROWS = 6, COLS = 8;
  grid.innerHTML = '<i></i>'.repeat(ROWS * COLS);
  const cells = $$('i', grid);
  const at = (el) => { const n = cells.indexOf(el); return n < 0 ? null : [Math.floor(n / COLS) + 1, (n % COLS) + 1]; };
  grid.addEventListener('mouseover', (e) => {
    const p = at(e.target);
    if (!p) return;
    cells.forEach((c, n) => c.classList.toggle('on', Math.floor(n / COLS) < p[0] && n % COLS < p[1]));
    $('#tgrid-label').textContent = `${p[1]} × ${p[0]} table`;
  });
  grid.addEventListener('click', (e) => { const p = at(e.target); if (p) { run('table', `${p[0]}x${p[1]}`); closeMenus(); } });
  // colour buttons apply the last colour when the swatch letter itself is used via keyboard
  $('#color-bar').style.background = lastColor; $('#hilite-bar').style.background = lastHilite;
  $('#proof-on').checked = prefs.proofOn;
  $('#nav-pane').hidden = !prefs.nav;
}

const WELCOME = [
  '<p class="doc-title">Welcome to Inkwell</p>',
  '<p class="doc-subtitle">A calm place to write, format and polish documents</p>',
  '<p>This is your first document. Select any text and use the <b>Home</b> tab to change the font, size, colour or <span style="background-color:#fff59d">highlight</span>. Everything saves automatically in this browser, and you can download a Word, web page or plain text copy from the <b>File</b> tab.</p>',
  '<h1>Format with styles</h1>',
  '<p>Styles keep long documents consistent. Put the cursor in a paragraph and choose a style from the menu on the Home tab, or press <b>⌥⌘1</b> for a heading. The <b>Design</b> tab restyles the whole document in one click.</p>',
  '<ul><li>Bullets, numbering and indents</li><li>Alignment, line spacing and paragraph spacing</li><li>Tables, pictures, links, symbols and page breaks from the <b>Insert</b> tab</li><li>Margins, orientation, paper size and columns from the <b>Layout</b> tab</li></ul>',
  '<h2>Try the spelling and grammar checker</h2>',
  '<p>This paragraf has a few mistakes on purpose. Their are spelling erors, a a repeated word, and you could of missed them without the checker. Right-click anything underlined to fix it, or open the Editor panel from the status bar below.</p>',
  '<table><tbody><tr><th>Shortcut</th><th>What it does</th></tr><tr><td>⌘B, ⌘I, ⌘U</td><td>Bold, italic, underline</td></tr><tr><td>⌘K</td><td>Insert a link</td></tr><tr><td>⌘F</td><td>Find and replace</td></tr><tr><td>⌘↵</td><td>Page break</td></tr></tbody></table>',
  '<p class="quote">Delete all of this whenever you like and start writing.</p>',
  '<p><br></p>',
].join('');

async function start() {
  buildUI();
  applyDark(); applyLang();
  document.execCommand('defaultParagraphSeparator', false, 'p');
  document.execCommand('styleWithCSS', false, true);
  doc = newDoc();
  proof.init({ editor, onUpdate: renderProof, lang: prefs.lang, enabled: prefs.proofOn });
  let rec = null, count = 0;
  try {
    const all = await store.all();
    count = all.length;
    rec = all.find((d) => d.id === prefs.lastId) || all.sort((a, b) => b.updated - a.updated)[0] || null;
  } catch { /* storage unavailable: work in memory */ }
  if (rec) setDoc(rec, rec.html);
  else {
    const html = count ? '' : (isMac ? WELCOME : WELCOME.replace(/⌥⌘/g, 'Ctrl+Alt+').replace(/⌘↵/g, 'Ctrl+Enter').replace(/⌘/g, 'Ctrl+'));
    setDoc(newDoc(count ? 'Untitled document' : 'Welcome to Inkwell'), html);
    if (html) save();
  }
  zoomTo(prefs.zoom);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyDark);
}
start();
