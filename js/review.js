// Comments and track changes, with a review pane listing both.
import { resetHf, layout } from './pages.js';
import { gridOf } from './tables.js';
let api;
let pending = null;      // range waiting for a new comment
let editing = null;      // comment id being edited
let items = [];          // what the list currently shows
let sig = '';
let cur = null;          // the change the Next and Previous buttons are on
const uid = () => 'c' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);
const author = () => (api.prefs.author || 'You').trim() || 'You';
const when = (t) => { const d = new Date(Number(t)); return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const clip = (s, n = 90) => { s = s.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const paneOpen = () => !api.$('#side-pane').hidden && !api.$('#review-pane').hidden;
const STRUCT = /^(UL|OL|TABLE|TBODY|THEAD|TFOOT|TR|COLGROUP)$/;

function textNodes(range) {
  const root = range.commonAncestorContainer;
  if (root.nodeType === 3) return [root];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  let n;
  while ((n = w.nextNode())) {
    if (!range.intersectsNode(n) || !n.data.length) continue;
    const p = n.parentElement;
    if (!p || p === api.editor || STRUCT.test(p.tagName) || p.closest('[contenteditable="false"]')) continue;
    out.push(n);
  }
  return out;
}
// Splits the text nodes at the range edges and returns the pieces that lie inside it.
function pieces(range) {
  const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range;
  const out = [];
  for (let n of textNodes(range)) {
    const s = n === sc ? so : 0, e = n === ec ? eo : n.length;
    if (e <= s) continue;
    if (e < n.length) n.splitText(e);
    if (s > 0) n = n.splitText(s);
    out.push(n);
  }
  return out;
}
const unwrap = (el) => { const p = el.parentNode; el.replaceWith(...el.childNodes); if (p) p.normalize(); };
function fixEmpty(block) {
  if (block && block.isConnected && !block.textContent && !block.querySelector('br,img,.shape')) block.append(document.createElement('br'));
}

// ---------- comments ----------
const spansOf = (id) => [...api.editor.querySelectorAll('span.cm')].filter((s) => s.dataset.cm === id);
function startComment() {
  api.restore();
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed || !api.inEditor(s.anchorNode)) { api.toast('Select the text you want to comment on.'); return; }
  pending = s.getRangeAt(0).cloneRange();
  editing = null;
  api.showSide('review');
  compose(clip(pending.toString(), 140), '', 'Add comment');
}
function compose(quote, text, label) {
  api.$('#rv-compose').hidden = false;
  api.$('#rv-quote').textContent = quote;
  api.$('#rv-text').value = text;
  api.$('#rv-save').textContent = label;
  setTimeout(() => api.$('#rv-text').focus(), 0);
}
function closeCompose() { pending = null; editing = null; api.$('#rv-compose').hidden = true; }
function saveComment() {
  const text = api.$('#rv-text').value.trim();
  if (!text) { api.$('#rv-text').focus(); return; }
  if (editing) {
    api.commit();
    for (const s of spansOf(editing)) s.dataset.text = text;
  } else {
    if (!pending || !pending.startContainer.isConnected || !pending.endContainer.isConnected) { api.toast('That selection has changed. Select the text again.'); closeCompose(); return; }
    api.commit();
    const id = uid(), t = String(Date.now());
    const made = pieces(pending).map((n) => {
      const sp = document.createElement('span');
      sp.className = 'cm';
      Object.assign(sp.dataset, { cm: id, author: author(), time: t, text });
      n.before(sp); sp.append(n);
      return sp;
    });
    if (!made.length) { api.toast('There is no text in that selection to comment on.'); closeCompose(); return; }
  }
  closeCompose();
  api.done();
  render(true);
}
function commentAct(act, id) {
  const spans = spansOf(id);
  if (!spans.length) return;
  if (act === 'edit') { editing = id; pending = null; compose(clip(spans.map((s) => s.textContent).join(''), 140), spans[0].dataset.text || '', 'Save comment'); return; }
  if (act === 'go') { spans[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  api.commit();
  if (act === 'resolve') for (const s of spans) { if (s.dataset.resolved) delete s.dataset.resolved; else s.dataset.resolved = '1'; }
  if (act === 'delete') spans.forEach(unwrap);
  if (act === 'keepnew' || act === 'restoreold') {
    // settle a Compare comment change: keep the new wording, or go back to the old (a removed comment returns as a normal one)
    for (const s of spans) {
      if (act === 'restoreold') { s.dataset.text = s.dataset.was || ''; if (s.dataset.cmp === 'removed' && s.dataset.wasBy) s.dataset.author = s.dataset.wasBy; }
      else if (s.dataset.cmp === 'changed') s.dataset.text = nowText(s.dataset.text);
      delete s.dataset.cmp; delete s.dataset.was; delete s.dataset.wasBy;
    }
  }
  api.done();
  render(true);
}

// ---------- track changes ----------
const tracking = () => !!(api.doc && api.doc.track);
function mark(tag) {
  const el = document.createElement(tag);
  el.className = 'tc';
  el.dataset.author = author(); el.dataset.time = String(Date.now());
  return el;
}
const ownIns = (n) => { const i = n.parentElement && n.parentElement.closest('ins.tc'); return i && i.dataset.author === author() ? i : null; };
function mergeDels(root) {
  for (const d of [...root.querySelectorAll('del.tc')]) {
    const nx = d.nextSibling;
    if (d.isConnected && nx && nx.nodeType === 1 && nx.matches('del.tc') && nx.dataset.author === d.dataset.author) { d.append(...nx.childNodes); nx.remove(); d.normalize(); }
  }
}
// Marks the text in range as deleted. Returns { first, last } nodes for caret placement, or null if the range holds no text.
function markDeleted(range) {
  const ps = pieces(range);
  if (!ps.length) return null;
  let first = null, last = null;
  for (const n of ps) {
    const p = n.parentElement;
    if (p.closest('del.tc')) { first = first || n; last = n; continue; }
    const ins = ownIns(n);
    if (ins) {
      const anchor = document.createTextNode('');
      n.replaceWith(anchor);
      first = first || anchor; last = anchor;
      continue;
    }
    const d = mark('del');
    n.before(d); d.append(n);
    first = first || d; last = d;
  }
  return { first, last };
}
function tidy(keep) {
  const ed = api.editor;
  for (const i of [...ed.querySelectorAll('ins.tc')]) if (!i.textContent && !i.querySelector('img,br') && !i.contains(keep)) i.remove();
  mergeDels(ed);
}
function caretAt(node, before) {
  const r = document.createRange();
  let target = node;
  while (target && !target.isConnected) target = null;
  if (!target) return;
  const d = target.nodeType === 1 ? target : target.parentElement && target.parentElement.closest('del.tc');
  const ref = d && d.matches && d.matches('del.tc') ? d : target;
  if (before) r.setStartBefore(ref); else r.setStartAfter(ref);
  r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function insertTracked(text) {
  const s = getSelection();
  let r = s.getRangeAt(0);
  if (!r.collapsed) {
    const res = markDeleted(r);
    if (res) caretAt(res.last, false); else r.deleteContents();
    r = s.getRangeAt(0);
  }
  const at = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const del = at && at.closest('del.tc');
  if (del) { r = document.createRange(); r.setStartAfter(del); r.collapse(true); }
  const ins = mark('ins');
  const tn = document.createTextNode(text);
  ins.append(tn);
  r.insertNode(ins);
  const block = ins.parentElement;
  if (block && block.lastChild && block.lastChild.nodeName === 'BR' && block.childNodes.length === 2 && block.firstChild === ins) block.lastChild.remove();
  const c = document.createRange(); c.setStart(tn, tn.length); c.collapse(true);
  s.removeAllRanges(); s.addRange(c);
  tidy(ins);
}
function onBeforeInput(e) {
  if (!tracking() || e.isComposing) return;
  const t = e.inputType;
  const s = getSelection();
  if (!s.rangeCount || !api.inEditor(s.anchorNode)) return;
  if (t === 'insertText') {
    const r = s.getRangeAt(0);
    if (e.data == null) return;
    if (r.collapsed && r.startContainer.nodeType === 3 && ownIns(r.startContainer) && !r.startContainer.parentElement.closest('del.tc')) return; // typing extends our own insertion
    e.preventDefault();
    insertTracked(e.data);
    api.changed();
    return;
  }
  if (!t.startsWith('delete')) return;
  let range = null;
  if (!s.isCollapsed) range = s.getRangeAt(0).cloneRange();
  else {
    const tr = e.getTargetRanges ? e.getTargetRanges()[0] : null;
    if (tr) { range = document.createRange(); try { range.setStart(tr.startContainer, tr.startOffset); range.setEnd(tr.endContainer, tr.endOffset); } catch { range = null; } }
  }
  if (!range || range.collapsed) return;
  if (!textNodes(range).length) return;                // nothing but structure: let the browser join blocks
  if (range.cloneContents().querySelector('img,table,hr,.shape,.chart,.toc,.page-break')) return;
  e.preventDefault();
  const back = /Backward|Cut|^deleteContent$/.test(t);
  const blocks = api.selBlocks();
  const res = markDeleted(range);
  if (res) caretAt(back ? res.first : res.last, back);
  tidy(null);
  blocks.forEach(fixEmpty);
  api.changed();
}
function pasteTracked(cd) {
  if (!tracking()) return false;
  const text = cd.getData('text/plain');
  if (!text) return false;
  const s = getSelection();
  if (!s.rangeCount || !api.inEditor(s.anchorNode)) return false;
  api.commit();
  insertTracked(text.replace(/\r/g, ''));
  api.done();
  return true;
}
// ---------- tracked formatting ----------
const FMT = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', sub: 'Subscript', sup: 'Superscript', fontName: 'Font', fontSize: 'Font size', color: 'Font colour', hilite: 'Highlight', grow: 'Font size', shrink: 'Font size' };
let fmtBusy = false;
function guardFormat(cmd, val, el) {
  if (fmtBusy || !FMT[cmd] || !tracking()) return false;
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed || !api.inEditor(s.anchorNode)) return false;
  const r = s.getRangeAt(0);
  const blk = (n) => (n.nodeType === 1 ? n : n.parentElement).closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote');
  const b = blk(r.startContainer);
  if (!b || b !== blk(r.endContainer) || r.cloneContents().querySelector('img,table,figure,.eq,[contenteditable="false"]')) return false;
  if (b.closest('del.tc') || r.startContainer.parentElement.closest('del.tc')) return false;
  const was = document.createElement('div');
  was.append(r.cloneContents());
  const before = was.innerHTML;
  fmtBusy = true;
  try { api.run(cmd, val, el); } finally { fmtBusy = false; }
  const s2 = getSelection();
  if (!s2.rangeCount || s2.isCollapsed) return true;
  const r2 = s2.getRangeAt(0);
  if (blk(r2.startContainer) !== blk(r2.endContainer)) return true;
  const own = r2.startContainer.parentElement && r2.startContainer.parentElement.closest('span.fc');
  if (own && own.contains(r2.endContainer) && own.dataset.author === author()) {
    own.dataset.label = own.dataset.label.includes(FMT[cmd]) ? own.dataset.label : own.dataset.label + ', ' + FMT[cmd];
    return true;
  }
  const w = document.createElement('span');
  w.className = 'fc';
  w.dataset.author = author(); w.dataset.time = String(Date.now());
  w.dataset.label = FMT[cmd]; w.dataset.was = before;
  const txt = r2.toString();
  for (;;) {
    const a = r2.startContainer.nodeType === 3 ? r2.startContainer.parentElement : r2.startContainer;
    if (!a || a === api.editor || a.tagName !== 'SPAN' || a.matches('.fc,.cm') || a.textContent !== txt) break;
    r2.selectNode(a);
  }
  w.append(r2.extractContents());
  r2.insertNode(w);
  const nr = document.createRange();
  nr.selectNodeContents(w);
  s2.removeAllRanges(); s2.addRange(nr);
  api.changed(true);
  return true;
}
// Moves el out of the formatting around it (bold, italic, a link, a styled span) by splitting each into the part
// before and the part after, so the restored old look is not mixed with the new one. Only for marks whose
// data-was holds the whole old look (Compare's), not just the selected words.
const LIFT = 'b,strong,i,em,u,s,strike,sub,sup,mark,a[href],span[style]';
function liftOut(el) {
  for (let a = el.parentElement; a && a.matches(LIFT) && !a.matches('.fc,.cm,.tc,.shape,.eq,.wordart,.textbox'); a = el.parentElement) {
    const after = a.cloneNode(false);
    after.removeAttribute('id');
    while (el.nextSibling) after.append(el.nextSibling);
    a.after(el);
    if (after.firstChild) el.after(after);
    if (!a.firstChild) a.remove();
  }
}
// Gives a cell back its old span: a cell that was merged is split into empty cells, one that was split is merged again
// (the text of the cells it swallows moves into it, as with Merge cells). Does nothing if the new span would cut across another merged cell.
function setSpan(cell, cs, rs) {
  const table = cell.closest('table');
  let g = gridOf(table), p = g.pos.get(cell);
  if (!p || (p.cs === cs && p.rs === rs)) return;
  const tag = cell.tagName.toLowerCase(), keepC = Math.min(cs, p.cs), keepR = Math.min(rs, p.rs);
  if (keepC < p.cs || keepR < p.rs) {
    cell.colSpan = keepC; cell.rowSpan = keepR;
    for (let r = p.r; r < p.r + p.rs; r++) {
      for (let c = p.c; c < p.c + p.cs; c++) {
        if (r < p.r + keepR && c < p.c + keepC) continue;
        g = gridOf(table);
        const tr = g.rows[r];
        let before = null;
        for (const x of tr.cells) { const q = g.pos.get(x); if (q.c > c) { before = x; break; } }
        const n = document.createElement(tag); n.append(document.createElement('br'));
        tr.insertBefore(n, before);
      }
    }
    g = gridOf(table); p = g.pos.get(cell);
  }
  if (cs > p.cs || rs > p.rs) {
    const r1 = p.r + rs - 1, c1 = p.c + cs - 1, hit = new Set();
    if (r1 >= g.nRows || c1 >= g.nCols) return;
    for (let r = p.r; r <= r1; r++) for (let c = p.c; c <= c1; c++) hit.add(g.grid[r][c]);
    for (const x of hit) { const q = g.pos.get(x); if (q.r < p.r || q.c < p.c || q.r + q.rs - 1 > r1 || q.c + q.cs - 1 > c1) return; }
    for (const x of hit) {
      if (x === cell) continue;
      if (x.textContent.trim()) { if (!cell.textContent.trim()) cell.textContent = ''; else cell.append(document.createElement('br')); cell.append(...x.childNodes); }
      x.remove();
    }
    cell.colSpan = cs; cell.rowSpan = rs;
    for (const tr of [...table.rows]) {
      if (tr.cells.length) continue;
      const g2 = gridOf(table), R = g2.rows.indexOf(tr), seen = new Set();
      for (const x of g2.grid[R]) if (x && !seen.has(x)) { seen.add(x); if (x.rowSpan > 1) x.rowSpan -= 1; }
      tr.remove();
    }
  }
  if (cell.colSpan === 1) cell.removeAttribute('colspan');
  if (cell.rowSpan === 1) cell.removeAttribute('rowspan');
}
// A table or cell look from Compare (shading, alignment, borders, merging, widths): Reject puts the old value back.
function resolveLook(el, accept) {
  if (!accept) {
    const cell = el.closest('td,th'), table = el.closest('table'), d = el.dataset;
    if (d.cellSpan && cell) { const [cs, rs] = d.cellSpan.split(',').map(Number); setSpan(cell, cs, rs); }
    if (d.cellStyle !== undefined && cell) { if (d.cellStyle) cell.setAttribute('style', d.cellStyle); else cell.removeAttribute('style'); }
    if (d.tableClass !== undefined && table) { if (d.tableClass) table.className = d.tableClass; else table.removeAttribute('class'); }
    if (d.tableCols !== undefined && table) {
      table.querySelectorAll(':scope > colgroup').forEach((g) => g.remove());
      if (d.tableCols) table.insertAdjacentHTML('afterbegin', d.tableCols);
    }
  }
  if (el.dataset.pad) el.remove(); else unwrap(el);
}
// A header, footer or page-number change from Compare: Accept keeps the new setting, Reject puts the old one back.
// The line goes either way, and the note around the lines goes with the last one.
function resolveHf(el, accept) {
  if (!accept) {
    let old = null;
    try { old = JSON.parse(el.dataset.hfWas); } catch { /* none */ }
    const key = el.dataset.hfKey, m = /^sect:(\d+):(\w+)$/.exec(key);
    if (m) {
      const b = api.editor.querySelectorAll('.sect-break')[Number(m[1])];
      if (b) {
        let o = {};
        try { o = JSON.parse(b.dataset.sect || '{}') || {}; } catch { /* keep empty */ }
        if (old == null || old === '') delete o[m[2]]; else o[m[2]] = old;
        b.dataset.sect = JSON.stringify(o);
      }
    } else {
      api.doc.hf = { ...(api.doc.hf || {}), [key.slice(3)]: old == null ? '' : old };
    }
    resetHf();
    api.applyPage();
    api.changed(true);
  }
  const note = el.closest('[data-compare-note]');
  (el.closest('p') || el).remove();
  if (note && !note.querySelector('span.fc')) note.remove();
}
function resolveFormat(el, accept) {
  if (!el || !el.isConnected) return;
  if (el.dataset.hfKey) return resolveHf(el, accept);
  if (el.dataset.cellStyle !== undefined || el.dataset.cellSpan !== undefined || el.dataset.tableClass !== undefined || el.dataset.tableCols !== undefined) return resolveLook(el, accept);
  if (accept) { unwrap(el); return; }
  if (el.dataset.lift) liftOut(el);
  const t = document.createElement('template');
  t.innerHTML = el.dataset.was || '';
  el.replaceWith(t.content);
}
function resolveChange(el, accept) {
  if (!el || !el.isConnected) return;
  if (el.matches('span.fc')) return resolveFormat(el, accept);
  const keep = el.tagName === 'INS' ? accept : !accept;
  const block = el.closest('p,h1,h2,h3,li,td,th,pre');
  if (keep) unwrap(el); else { const p = el.parentNode; el.remove(); if (p) p.normalize(); }
  fixEmpty(block);
}
function changeAct(act, el) {
  if (act === 'go') { if (el.isConnected) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  api.commit();
  if (el === cur) { const els = changeEls(), i = els.indexOf(el); cur = els[i + 1] || els[i - 1] || null; }
  resolveChange(el, act === 'accept');
  api.done();
  render(true);
}
// ---------- next and previous change ----------
const changeEls = () => [...api.editor.querySelectorAll('ins.tc,del.tc,span.fc')];
function position() {
  const els = changeEls(), i = cur && cur.isConnected ? els.indexOf(cur) : -1;
  api.$('#rv-nav').hidden = !els.length;
  api.$('#rv-pos').textContent = !els.length ? '' : i < 0 ? `${els.length} ${els.length === 1 ? 'change' : 'changes'}` : `${i + 1} of ${els.length}`;
  for (const c of api.$$('#rv-list .rv-card')) { const it = items[Number(c.dataset.n)]; c.classList.toggle('cur', !!it && it.el === cur); }
}
function stepChange(dir) {
  const els = changeEls();
  if (!els.length) { cur = null; api.toast('There are no tracked changes.'); position(); return; }
  const i = cur && cur.isConnected ? els.indexOf(cur) : -1;
  cur = els[i < 0 ? (dir > 0 ? 0 : els.length - 1) : (i + dir + els.length) % els.length];
  const r = document.createRange();
  r.selectNodeContents(cur);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  position();
  const card = api.$('#rv-list .rv-card.cur');
  if (card) card.scrollIntoView({ block: 'nearest' });
}
function allChanges(accept) {
  const els = [...api.editor.querySelectorAll('ins.tc,del.tc,span.fc')];
  if (!els.length) { api.toast('There are no tracked changes.'); return; }
  api.commit();
  els.forEach((el) => resolveChange(el, accept));
  api.done();
  render(true);
  api.toast(`${els.length} ${els.length === 1 ? 'change' : 'changes'} ${accept ? 'accepted' : 'rejected'}.`);
}
function setTrack(on) {
  api.doc.track = on;
  api.$$('[data-cmd="track"]').forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const st = api.$('#st-track');
  if (st) st.hidden = !on;
}

// ---------- review pane ----------
function collect() {
  const out = [], seen = new Set();
  for (const el of api.editor.querySelectorAll('span.cm,ins.tc,del.tc,span.fc')) {
    if (el.matches('span.cm')) {
      const id = el.dataset.cm;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ kind: 'cm', id, el, quote: spansOf(id).map((s) => s.textContent).join(''), text: el.dataset.text || '', author: el.dataset.author || '', time: el.dataset.time, resolved: !!el.dataset.resolved, cmp: el.dataset.cmp || '', was: el.dataset.was || '', wasBy: el.dataset.wasBy || '' });
    } else out.push({ kind: el.matches('span.fc') ? 'fc' : el.tagName === 'INS' ? 'ins' : 'del', label: el.dataset.label || '', el, quote: el.textContent, author: el.dataset.author || '', time: el.dataset.time });
  }
  return out;
}
// A comment that Compare found changed, added or removed: the old and the new wording side by side, and a choice.
const nowText = (t) => String(t || '').split('\n(Compare: ')[0];
function cmpCard(i, n, meta) {
  const { esc, ic } = api;
  const head = `<div class="issue-top">${ic('comment')}${meta}</div><p class="issue-ctx"><b>${i.cmp === 'changed' ? 'Comment changed' : i.cmp === 'added' ? 'Comment added' : 'Comment removed'}</b> “${esc(clip(i.quote))}”</p>`;
  const was = `<p class="rv-body rv-was"><span class="rv-lab">Was${i.wasBy ? ' · ' + esc(i.wasBy) : ''}</span><del>${esc(i.was)}</del></p>`;
  const btn = (act, label) => `<button class="link-btn" data-act="${act}">${label}</button>`;
  if (i.cmp === 'changed') return `<div class="issue rv-card" data-n="${n}">${head}${was}<p class="rv-body rv-now"><span class="rv-lab">Now</span><ins>${esc(nowText(i.text))}</ins></p><div class="issue-fix">${btn('keepnew', 'Keep new')}${btn('restoreold', 'Restore old')}</div></div>`;
  if (i.cmp === 'removed') return `<div class="issue rv-card" data-n="${n}">${head}${was}<div class="issue-fix">${btn('restoreold', 'Bring it back')}${btn('delete', 'Dismiss')}</div></div>`;
  return `<div class="issue rv-card" data-n="${n}">${head}<p class="rv-body rv-now"><span class="rv-lab">Now</span><ins>${esc(i.text)}</ins></p><div class="issue-fix">${btn('keepnew', 'Keep')}${btn('delete', 'Remove')}</div></div>`;
}
function render(force) {
  if (!paneOpen()) return;
  const list = collect();
  const s = JSON.stringify(list.map((i) => [i.kind, i.id, i.quote, i.text, i.author, i.time, i.resolved, i.label, i.cmp, i.was, i.wasBy]));
  if (!force && s === sig) return;
  sig = s; items = list;
  const { esc, ic } = api;
  const changes = list.filter((i) => i.kind !== 'cm').length;
  api.$('#rv-bulk').hidden = !changes;
  if (!changes) cur = null;
  api.$('#rv-empty').hidden = list.length > 0;
  api.$('#rv-list').innerHTML = list.slice(0, 300).map((i, n) => {
    const meta = `<span class="rv-who">${esc(i.author || 'Unknown')}</span><span class="rv-when">${esc(when(i.time))}</span>`;
    if (i.kind === 'cm' && i.cmp) return cmpCard(i, n, meta);
    if (i.kind === 'cm') {
      return `<div class="issue rv-card${i.resolved ? ' resolved' : ''}" data-n="${n}"><div class="issue-top">${ic('comment')}${meta}</div>`
        + `<p class="issue-ctx">“${esc(clip(i.quote))}”</p><p class="rv-body">${esc(i.text)}</p>`
        + `<div class="issue-fix"><button class="link-btn" data-act="resolve">${i.resolved ? 'Reopen' : 'Resolve'}</button><button class="link-btn" data-act="edit">Edit</button><button class="link-btn" data-act="delete">Delete</button></div></div>`;
    }
    return `<div class="issue rv-card" data-n="${n}"><div class="issue-top">${ic('track')}${meta}</div>`
      + `<p class="issue-ctx"><b>${i.kind === 'fc' ? 'Formatted: ' + esc(i.label) : i.kind === 'ins' ? 'Added' : 'Deleted'}</b> “${esc(clip(i.quote))}”</p>`
      + `<div class="issue-fix"><button class="link-btn" data-act="accept">Accept</button><button class="link-btn" data-act="reject">Reject</button></div></div>`;
  }).join('');
  position();
}

// ---------- printing and PDF with tracked changes ----------
// A document with tracked changes (a Compare result, say) can be printed or saved as PDF three ways: with the changes
// marked, as it would read with every change accepted, or as it read before. This only changes how the page is drawn
// while it is printed; the document itself is not touched. Resolves to 'markup', 'final', 'original', or null (cancelled).
export function askPrintView() {
  if (!api.editor.querySelector('ins.tc,del.tc')) return Promise.resolve('markup');
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg';
  dlg.innerHTML = `<form method="dialog"><h2>Print with changes</h2><p class="dlg-note">This document has tracked changes. Choose how they show on paper.</p>
    <label class="field"><span><input type="radio" name="pv" value="markup" checked> With the changes marked</span></label>
    <label class="field"><span><input type="radio" name="pv" value="final"> Final: every change accepted, no marks</span></label>
    <label class="field"><span><input type="radio" name="pv" value="original"> Original: every change rejected, no marks</span></label>
    <div class="dlg-actions"><span class="spacer"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Continue</button></div></form>`;
  document.body.append(dlg);
  return new Promise((res) => {
    let out = null;
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!e.submitter || e.submitter.value === 'ok') out = dlg.querySelector('input[name="pv"]:checked').value;
      dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); res(out); });
    dlg.showModal();
  });
}

export async function withPrintView(mode, fn) {
  const cls = mode === 'final' || mode === 'original' ? 'pv-' + mode : '';
  // The original view also gives back the old look of text and tables that only changed in format. That needs the real
  // Reject, so the page is put back exactly as it was afterwards.
  let snap = null;
  if (mode === 'original') {
    snap = api.editor.innerHTML;
    for (const el of [...api.editor.querySelectorAll('span.fc')]) if (!el.dataset.hfKey) resolveFormat(el, false);
  }
  if (cls) { api.editor.classList.add(cls); layout(); }
  try { return await fn(); } finally {
    if (snap !== null) api.editor.innerHTML = snap;
    if (cls) { api.editor.classList.remove(cls); layout(); }
  }
}

export function init(a) {
  api = a;
  const { $, editor } = api;
  api.cmd('comment', startComment);
  api.cmd('commentSave', saveComment);
  api.cmd('commentCancel', closeCompose);
  api.cmd('reviewPane', () => api.showSide(paneOpen() ? null : 'review'));
  api.cmd('track', () => { setTrack(!api.doc.track); api.changed(true); api.toast(api.doc.track ? 'Track changes is on. Typing and deleting are now marked.' : 'Track changes is off.'); });
  api.cmd('acceptAll', () => allChanges(true));
  api.cmd('rejectAll', () => allChanges(false));
  api.cmd('nextChange', () => stepChange(1));
  api.cmd('prevChange', () => stepChange(-1));

  const name = $('#rv-author');
  name.value = api.prefs.author || 'You';
  name.addEventListener('change', () => { api.prefs.author = name.value.trim() || 'You'; name.value = api.prefs.author; api.savePrefs(); });
  $('#rv-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveComment(); }
    if (e.key === 'Escape') { e.preventDefault(); closeCompose(); }
  });
  $('#rv-list').addEventListener('click', (e) => {
    const card = e.target.closest('.rv-card');
    if (!card) return;
    const it = items[Number(card.dataset.n)];
    if (!it) return;
    const btn = e.target.closest('[data-act]');
    const act = btn ? btn.dataset.act : 'go';
    if (it.kind === 'cm') commentAct(act, it.id); else changeAct(act, it.el);
  });

  editor.addEventListener('beforeinput', onBeforeInput);
  api.on('paste', pasteTracked);
  api.on('guard', guardFormat);
  api.on('meta', () => render(false));
  api.on('side', (which) => { if (which === 'review') render(true); else closeCompose(); });
  api.on('load', () => { setTrack(!!api.doc.track); closeCompose(); sig = ''; render(true); });
}
