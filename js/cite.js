// References: captions, cross-references, an index, citations and a bibliography.
import { pageAt } from './pages.js';

let api, dlg, editing = null;
const uid = (p = 'r') => p + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);
const byId = (id) => (id ? [...api.editor.querySelectorAll('[data-id]')].find((e) => e.dataset.id === id) : null);
const lock = (el) => { if (el.getAttribute('contenteditable') !== 'false') el.setAttribute('contenteditable', 'false'); };
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const setHtml = (el, h) => { if (el.dataset.sig !== h) { el.innerHTML = h; el.dataset.sig = h; } };
const X = () => api.doc.x;

// ---------- captions ----------
const CAP_KINDS = ['Figure', 'Table', 'Equation'];
function insertCaption(kind) {
  if (!CAP_KINDS.includes(kind)) kind = 'Figure';
  const obj = api.selImg;
  api.restore();
  const t = api.tableCtx();
  const anchor = obj ? api.topOf(obj) : t ? api.topOf(t.table) : api.curBlock() && api.topOf(api.curBlock());
  if (!anchor || anchor.closest('.toc,.index,.biblio,ol.footnotes,ol.endnotes')) { api.toast('Click the picture, table or paragraph the caption belongs to first.'); return; }
  api.commit();
  const p = document.createElement('p');
  p.className = 'caption';
  const n = document.createElement('span');
  n.className = 'cap-num'; n.dataset.cap = kind; n.dataset.id = uid('c'); n.setAttribute('contenteditable', 'false'); n.textContent = kind + ' 1';
  p.append(n, document.createTextNode(': '));
  if (kind === 'Table' && anchor.tagName === 'TABLE') anchor.before(p); else anchor.after(p);
  api.selectImg(null);
  syncCaptions();
  api.caretIn(p, true);
  api.done();
}
function syncCaptions() {
  const seen = new Set(), count = {};
  for (const n of api.editor.querySelectorAll('span.cap-num')) {
    const kind = CAP_KINDS.includes(n.dataset.cap) ? n.dataset.cap : 'Figure';
    count[kind] = (count[kind] || 0) + 1;
    if (!n.dataset.id || seen.has(n.dataset.id)) n.dataset.id = uid('c');
    seen.add(n.dataset.id);
    setText(n, `${kind} ${count[kind]}`);
    lock(n);
  }
}

// ---------- cross-references ----------
function targets() {
  const out = [];
  for (const el of api.editor.querySelectorAll('h1,h2,h3,span.cap-num')) {
    if (el.closest('.toc,.index,.biblio')) continue;
    if (el.tagName === 'SPAN') {
      const rest = el.parentElement.textContent.replace(el.textContent, '').replace(/^[:\s]+/, '').trim();
      out.push({ el, label: el.textContent + (rest ? ': ' + rest.slice(0, 50) : '') });
    } else if (el.textContent.trim()) out.push({ el, label: 'Heading: ' + el.textContent.trim().slice(0, 60) });
  }
  return out;
}
async function insertXref() {
  api.restore();
  const s = getSelection();
  if (!s.rangeCount || !api.inEditor(s.anchorNode)) { api.toast('Put the cursor where the reference should go first.'); return; }
  const range = s.getRangeAt(0).cloneRange();
  const list = targets();
  if (!list.length) { api.toast('Add a heading or a caption first, then refer to it.'); return; }
  const v = await api.ask('Cross-reference', [
    { id: 'to', label: 'Refer to', type: 'select', options: list.map((t, i) => [i, t.label]) },
    { id: 'k', label: 'Show', type: 'select', options: [['text', 'Its text or number'], ['page', 'Its page number'], ['both', 'Text and page (“… on page 3”)']] },
  ], { ok: 'Insert', note: 'The reference updates by itself when the heading, numbering or page changes.' });
  if (!v) return;
  const t = list[Number(v.to)];
  if (!t || !t.el.isConnected) return;
  api.commit();
  if (!t.el.dataset.id) t.el.dataset.id = uid('h');
  const x = document.createElement('span');
  x.className = 'xref'; x.dataset.ref = t.el.dataset.id; x.dataset.k = v.k; x.setAttribute('contenteditable', 'false'); x.textContent = '…';
  range.collapse(false); range.insertNode(x);
  range.setStartAfter(x); range.collapse(true); s.removeAllRanges(); s.addRange(range);
  syncXrefs(); xrefPages();
  api.done();
}
const xText = (t) => (t.tagName === 'SPAN' ? t.textContent : t.textContent.trim());
function syncXrefs() {
  const seen = new Set();
  for (const el of api.editor.querySelectorAll('h1[data-id],h2[data-id],h3[data-id],p[data-id]')) {
    if (seen.has(el.dataset.id) || el.tagName === 'P') el.removeAttribute('data-id'); else seen.add(el.dataset.id);
  }
  for (const x of api.editor.querySelectorAll('span.xref')) {
    lock(x);
    const t = byId(x.dataset.ref);
    if (!t) { setText(x, 'Reference not found'); continue; }
    if (x.dataset.k === 'text') setText(x, xText(t));
  }
}
function xrefPages() {
  for (const x of api.editor.querySelectorAll('span.xref')) {
    const k = x.dataset.k;
    if (k !== 'page' && k !== 'both') continue;
    const t = byId(x.dataset.ref);
    if (!t) continue;
    const pg = pageAt(t.getBoundingClientRect().top + 1);
    setText(x, k === 'page' ? String(pg) : `${xText(t)} on page ${pg}`);
  }
}

// ---------- index ----------
async function markIndex() {
  api.restore();
  const s = getSelection();
  if (!s.rangeCount || !api.inEditor(s.anchorNode)) { api.toast('Select the word or phrase to index first.'); return; }
  const range = s.getRangeAt(0).cloneRange();
  const picked = s.toString().replace(/\s+/g, ' ').trim();
  const a = api.curBlock();
  if (!range.collapsed && a && !a.contains(range.endContainer)) { api.toast('Select text inside one paragraph to mark it.'); return; }
  const v = await api.ask('Mark index entry', [
    { id: 'term', label: 'Entry', value: picked, placeholder: 'e.g. Photosynthesis' },
    { id: 'sub', label: 'Sub-entry (optional)', placeholder: 'e.g. light reactions' },
  ], { ok: 'Mark', note: 'Marked text gets a faint dotted underline on screen only. Use Insert index to build the list.' });
  if (!v || !v.term.trim()) return;
  api.commit();
  const sp = document.createElement('span');
  sp.className = 'idx'; sp.dataset.term = v.term.trim() + (v.sub.trim() ? ':' + v.sub.trim() : '');
  if (range.collapsed) { sp.textContent = '​'; range.insertNode(sp); } else { sp.append(range.extractContents()); range.insertNode(sp); }
  range.setStartAfter(sp); range.collapse(true); s.removeAllRanges(); s.addRange(range);
  api.done();
  api.toast(`Marked “${v.term.trim()}” for the index.`);
}
function insertIndex() {
  api.restore();
  const d = document.createElement('div');
  d.className = 'index'; d.setAttribute('contenteditable', 'false');
  api.caretIn(api.insertBlock(d));
  syncIndex(); indexPages();
  api.done();
}
function entries() {
  const map = new Map();
  for (const sp of api.editor.querySelectorAll('span.idx')) {
    const [main, sub = ''] = (sp.dataset.term || '').split(':').map((x) => x.trim());
    if (!main) continue;
    const key = main.toLowerCase() + '\u0001' + sub.toLowerCase();
    if (!map.has(key)) map.set(key, { main, sub, els: [] });
    map.get(key).els.push(sp);
  }
  return [...map.values()].sort((a, b) => a.main.localeCompare(b.main, undefined, { sensitivity: 'base' }) || a.sub.localeCompare(b.sub, undefined, { sensitivity: 'base' }));
}
function syncIndex() {
  const boxes = api.editor.querySelectorAll('div.index');
  if (!boxes.length) return;
  const es = entries();
  let html = '<p class="index-title">Index</p>', last = null, letter = '';
  if (!es.length) html += '<p class="index-empty">Mark words with “Mark entry” and they are listed here with their page numbers.</p>';
  es.forEach((e, i) => {
    const L = e.main[0].toUpperCase();
    if (L !== letter) { letter = L; html += `<p class="index-letter">${api.esc(L)}</p>`; }
    if (e.sub) {
      if (last !== e.main.toLowerCase()) html += `<p class="index-row"><span>${api.esc(e.main)}</span></p>`;
      html += `<p class="index-row index-sub" data-i="${i}"><span>${api.esc(e.sub)}</span><span class="index-pg"></span></p>`;
    } else html += `<p class="index-row" data-i="${i}"><span>${api.esc(e.main)}</span><span class="index-pg"></span></p>`;
    last = e.main.toLowerCase();
  });
  for (const b of boxes) { lock(b); setHtml(b, html); }
}
function indexPages() {
  const boxes = api.editor.querySelectorAll('div.index');
  if (!boxes.length) return;
  const es = entries().map((e) => [...new Set(e.els.map((el) => pageAt(el.getBoundingClientRect().top + 1)))].sort((a, b) => a - b).join(', '));
  for (const b of boxes) b.querySelectorAll('[data-i]').forEach((p) => { const pg = p.querySelector('.index-pg'); if (pg) setText(pg, es[Number(p.dataset.i)] || ''); });
}

// ---------- citations and bibliography ----------
const STYLES = { apa: 'APA', mla: 'MLA', ieee: 'IEEE (numbered)' };
const style = () => (STYLES[X().citeStyle] ? X().citeStyle : 'apa');
const sources = () => (Array.isArray(X().sources) ? X().sources : (X().sources = []));
function names(src) {
  return String(src.author || '').split(/;|\band\b|&/).map((n) => n.trim()).filter(Boolean).map((n) => {
    if (n.includes(',')) { const [last, first = ''] = n.split(',').map((x) => x.trim()); return { last, first }; }
    const parts = n.split(/\s+/);
    return parts.length === 1 ? { last: n, first: '' } : { last: parts.pop(), first: parts.join(' ') };
  });
}
const initials = (first) => first.split(/[\s.-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + '.').join(' ');
function shortAuthors(src) {
  const ns = names(src);
  if (!ns.length) return (src.title || 'Untitled').split(/\s+/).slice(0, 3).join(' ');
  if (ns.length === 1) return ns[0].last;
  if (ns.length === 2) return `${ns[0].last} & ${ns[1].last}`;
  return `${ns[0].last} et al.`;
}
function order() {
  // numbered styles follow the order sources are first cited in
  const out = [];
  for (const c of api.editor.querySelectorAll('span.cite')) if (!out.includes(c.dataset.src)) out.push(c.dataset.src);
  for (const s of sources()) if (!out.includes(s.id)) out.push(s.id);
  return out.filter((id) => sources().some((s) => s.id === id));
}
function citeText(src, pages, st, ord) {
  if (!src) return '(source missing)';
  const pg = pages ? (/^\d/.test(pages) ? (/[-–,]/.test(pages) ? 'pp. ' : 'p. ') + pages : pages) : '';
  if (st === 'ieee') return `[${ord.indexOf(src.id) + 1}${pg ? ', ' + pg : ''}]`;
  if (st === 'mla') return `(${shortAuthors(src).replace('&', 'and')}${pages ? ' ' + pages : ''})`;
  return `(${shortAuthors(src)}, ${src.year || 'n.d.'}${pg ? ', ' + pg : ''})`;
}
function bibEntry(src, st, ord) {
  const e = api.esc, ns = names(src), t = e(src.title || 'Untitled'), pub = e(src.publisher || ''), yr = e(src.year || 'n.d.');
  const url = src.url ? ` ${e(src.url)}` : '';
  const book = src.type !== 'article' && src.type !== 'website';
  if (st === 'ieee') {
    const a = ns.map((n) => `${initials(n.first)} ${n.last}`.trim()).join(', ');
    const head = book ? `<i>${t}</i>` : `“${t},”`;
    const venue = pub ? (book ? pub : `<i>${pub}</i>`) : '';
    // books: Author, <i>Title</i>, Publisher, Year.   articles: Author, "Title," <i>Journal</i>, Year.
    const rest = book ? [venue, yr].filter(Boolean).join(', ') : [venue, yr].filter(Boolean).join(', ');
    return `[${ord.indexOf(src.id) + 1}] ${e(a)}${a ? ', ' : ''}${head}${book ? ',' : ''} ${rest}.${url}`;
  }
  if (st === 'mla') {
    const a = ns.length ? `${ns[0].last}${ns[0].first ? ', ' + ns[0].first : ''}${ns.length === 2 ? `, and ${ns[1].first} ${ns[1].last}` : ns.length > 2 ? ', et al' : ''}.` : '';
    return `${e(a)} ${book ? `<i>${t}</i>.` : `“${t}.”`}${pub ? ` ${book ? pub : `<i>${pub}</i>`},` : ''} ${yr}.${url}`.trim();
  }
  const list = ns.map((n) => `${n.last}${n.first ? ', ' + initials(n.first) : ''}`);
  const a = list.length > 1 ? list.slice(0, -1).join(', ') + ', & ' + list[list.length - 1] : list[0] || '';
  return `${e(a)}${a ? ' ' : ''}(${yr}). ${book ? `<i>${t}</i>` : t}.${pub ? ` ${book ? pub : `<i>${pub}</i>`}.` : ''}${url}`;
}
function syncCites() {
  const st = style(), ord = order(), srcs = sources();
  for (const c of api.editor.querySelectorAll('span.cite')) {
    lock(c);
    setText(c, citeText(srcs.find((s) => s.id === c.dataset.src), c.dataset.k || '', st, ord));
  }
  const boxes = api.editor.querySelectorAll('div.biblio');
  if (!boxes.length) return;
  let list = srcs.slice();
  if (st === 'ieee') list.sort((a, b) => ord.indexOf(a.id) - ord.indexOf(b.id));
  else list.sort((a, b) => shortAuthors(a).localeCompare(shortAuthors(b), undefined, { sensitivity: 'base' }) || String(a.year).localeCompare(String(b.year)));
  const html = `<p class="biblio-title">${st === 'mla' ? 'Works cited' : 'References'}</p>` + (list.length
    ? list.map((s) => `<p class="biblio-row${st === 'ieee' ? ' num' : ''}">${bibEntry(s, st, ord)}</p>`).join('')
    : '<p class="index-empty">Sources you cite are listed here.</p>');
  for (const b of boxes) { lock(b); setHtml(b, html); }
}
function insertBiblio() {
  api.restore();
  const d = document.createElement('div');
  d.className = 'biblio'; d.setAttribute('contenteditable', 'false');
  api.caretIn(api.insertBlock(d));
  syncCites();
  api.done();
}

const F = ['type', 'author', 'title', 'year', 'publisher', 'url'];
let citeRange = null;
function fillSources(sel) {
  const pick = dlg.querySelector('#ct-src');
  pick.innerHTML = '<option value="">New source…</option>' + sources().map((s) => `<option value="${api.esc(s.id)}">${api.esc(shortAuthors(s) + (s.year ? ', ' + s.year : '') + ' — ' + (s.title || 'Untitled')).slice(0, 90)}</option>`).join('');
  pick.value = sel || '';
  loadSource();
}
function loadSource() {
  const s = sources().find((x) => x.id === dlg.querySelector('#ct-src').value);
  for (const k of F) dlg.querySelector('#ct-' + k).value = s ? s[k] || (k === 'type' ? 'book' : '') : k === 'type' ? 'book' : '';
  dlg.querySelector('#ct-del').hidden = !s;
}
function openCite(existing) {
  editing = existing || null;
  if (!existing) {
    api.restore();
    const s = getSelection();
    citeRange = s.rangeCount && api.inEditor(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
    if (!citeRange) { api.toast('Put the cursor where the citation should go first.'); return; }
  }
  fillSources(existing ? existing.dataset.src : '');
  dlg.querySelector('#ct-pages').value = existing ? existing.dataset.k || '' : '';
  dlg.querySelector('#ct-ok').textContent = existing ? 'Update' : 'Insert citation';
  dlg.showModal();
}
function saveCite() {
  const get = (k) => dlg.querySelector('#ct-' + k).value.trim();
  if (!get('title') && !get('author')) { api.toast('Give the source an author or a title.'); return; }
  api.commit();
  let src = sources().find((x) => x.id === dlg.querySelector('#ct-src').value);
  if (!src) { src = { id: uid('s') }; sources().push(src); }
  for (const k of F) src[k] = get(k);
  let c = editing;
  if (!c) {
    c = document.createElement('span');
    c.className = 'cite'; c.setAttribute('contenteditable', 'false');
    citeRange.collapse(false); citeRange.insertNode(c);
    const s = getSelection(); citeRange.setStartAfter(c); citeRange.collapse(true); s.removeAllRanges(); s.addRange(citeRange);
  }
  c.dataset.src = src.id;
  if (get('pages')) c.dataset.k = get('pages'); else c.removeAttribute('data-k');
  dlg.close();
  syncCites();
  api.done();
}
function buildDialog() {
  dlg = document.createElement('dialog');
  dlg.className = 'dlg wide';
  dlg.innerHTML = `<form method="dialog"><h2>Citation</h2>
    <label class="field"><span>Source</span><select id="ct-src"></select></label>
    <div class="field-row"><label class="field narrow" style="width:120px"><span>Type</span><select id="ct-type"><option value="book">Book</option><option value="article">Article</option><option value="website">Website</option><option value="report">Report</option></select></label>
      <label class="field grow"><span>Author(s), separated by ;</span><input id="ct-author" placeholder="Jane Smith; Ravi Patel" autocomplete="off"></label></div>
    <label class="field"><span>Title</span><input id="ct-title" autocomplete="off"></label>
    <div class="field-row"><label class="field narrow"><span>Year</span><input id="ct-year" inputmode="numeric" autocomplete="off"></label>
      <label class="field grow"><span>Publisher, journal or site</span><input id="ct-publisher" autocomplete="off"></label></div>
    <div class="field-row"><label class="field grow"><span>Web address (optional)</span><input id="ct-url" autocomplete="off"></label>
      <label class="field narrow"><span>Pages cited</span><input id="ct-pages" placeholder="12-14" autocomplete="off"></label></div>
    <div class="dlg-actions"><button class="btn danger" type="button" id="ct-del" hidden>Delete source</button><span class="spacer"></span><button class="btn" type="button" id="ct-cancel">Cancel</button><button class="btn primary" type="button" id="ct-ok">Insert citation</button></div></form>`;
  document.body.append(dlg);
  dlg.querySelector('#ct-src').addEventListener('change', loadSource);
  dlg.querySelector('#ct-cancel').addEventListener('click', () => dlg.close());
  dlg.querySelector('#ct-ok').addEventListener('click', saveCite);
  dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); saveCite(); });
  dlg.querySelector('#ct-del').addEventListener('click', () => {
    const id = dlg.querySelector('#ct-src').value;
    api.commit();
    X().sources = sources().filter((s) => s.id !== id);
    for (const c of [...api.editor.querySelectorAll('span.cite')]) if (c.dataset.src === id) c.remove();
    dlg.close(); syncCites(); api.done();
    api.toast('Source and its citations removed.');
  });
}

export function init(a) {
  api = a;
  buildDialog();
  api.cmd('caption', insertCaption);
  api.cmd('xref', insertXref);
  api.cmd('idxMark', markIndex);
  api.cmd('index', insertIndex);
  api.cmd('cite', () => openCite(null));
  api.cmd('biblio', insertBiblio);
  api.cmd('citeStyle', (v) => { if (!STYLES[v]) return; api.commit(); X().citeStyle = v; syncCites(); api.done(); });
  const all = () => { syncCaptions(); syncXrefs(); syncIndex(); syncCites(); };
  api.on('meta', all);
  api.on('load', all);
  api.on('afterLayout', () => { xrefPages(); indexPages(); });
  api.on('refresh', () => { const s = api.$('#cite-style'); if (s && api.doc) s.value = style(); });

  api.editor.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest) return;
    const x = t.closest('span.xref');
    if (x) { const to = byId(x.dataset.ref); if (to) to.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    const box = t.closest('div.index,div.biblio');
    const one = box || t.closest('span.cite,span.xref');
    if (one) { const r = document.createRange(); r.selectNode(one); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  });
  api.editor.addEventListener('dblclick', (e) => { const c = e.target.closest && e.target.closest('span.cite'); if (c) openCite(c); });
}
