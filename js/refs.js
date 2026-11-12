// Footnotes, endnotes and the table of contents.
import { pageAt } from './pages.js';

let api;
const KINDS = [['fn-ref', 'footnotes'], ['en-ref', 'endnotes']];
const NOTES = 'ol.footnotes,ol.endnotes';
const uid = () => 'n' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);

function roman(n) {
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

// Keeps reference marks and note lists in step: numbering, order, missing and orphaned notes.
function sync() {
  const ed = api.editor;
  const lists = {};
  for (const [refCls, listCls] of KINDS) {
    const refs = [...ed.querySelectorAll('sup.' + refCls)].filter((r) => !r.closest(NOTES));
    const found = [...ed.querySelectorAll('ol.' + listCls)];
    let list = found[0] || null;
    for (const extra of found.slice(1)) { list.append(...extra.children); extra.remove(); }
    if (!refs.length) { if (list) list.remove(); continue; }
    if (!list) { list = document.createElement('ol'); list.className = listCls; }
    const items = new Map();
    for (const li of [...list.children]) {
      if (li.tagName !== 'LI' || !li.dataset.fn) continue;
      const first = items.get(li.dataset.fn);
      if (first) { first.append(document.createElement('br'), ...li.childNodes); li.remove(); } else items.set(li.dataset.fn, li);
    }
    const seen = new Set(), order = [];
    refs.forEach((ref, i) => {
      let id = ref.dataset.fn;
      if (!id || seen.has(id)) { id = uid(); ref.dataset.fn = id; }
      seen.add(id);
      let li = items.get(id);
      if (!li) { li = document.createElement('li'); li.dataset.fn = id; li.append(document.createElement('br')); }
      order.push(li);
      const label = listCls === 'endnotes' ? roman(i + 1) : String(i + 1);
      if (ref.textContent !== label) ref.textContent = label;
      if (ref.getAttribute('contenteditable') !== 'false') ref.setAttribute('contenteditable', 'false');
    });
    for (const li of [...list.children]) if (!order.includes(li)) li.remove();
    order.forEach((li, i) => { if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null); });
    lists[listCls] = list;
  }
  const fn = lists.footnotes, en = lists.endnotes;
  if (en && (en.parentNode !== ed || ed.lastElementChild !== en)) ed.append(en);
  if (fn && (fn.parentNode !== ed || fn.nextElementSibling !== (en || null))) { if (en) en.before(fn); else ed.append(fn); }
}

function insertNote(kind) {
  api.restore();
  const s = getSelection();
  const at = s.rangeCount && api.inEditor(s.anchorNode) ? api.selEl() : null;
  if (!at || at.closest(NOTES + ',.toc,.chart,.shape')) { api.toast('Put the cursor in the main text first.'); return; }
  api.commit();
  const r = s.getRangeAt(0);
  r.collapse(false);
  const sup = document.createElement('sup');
  sup.className = kind + '-ref'; sup.dataset.fn = uid(); sup.setAttribute('contenteditable', 'false'); sup.textContent = '1';
  r.insertNode(sup);
  sync();
  const li = api.editor.querySelector(`${NOTES.split(',')[kind === 'fn' ? 0 : 1]} > li[data-fn="${sup.dataset.fn}"]`);
  if (li) { api.caretIn(li, true); li.scrollIntoView({ block: 'nearest' }); }
  api.done();
}

// ---------- table of contents ----------
const heads = () => [...api.editor.querySelectorAll('h1,h2,h3')].filter((h) => h.textContent.trim() && !h.closest('.toc'));
function fill(toc, hs) {
  toc.innerHTML = '<p class="toc-title">Contents</p>' + (hs.length
    ? hs.map((h, i) => `<p class="toc-${h.tagName[1]}" data-i="${i}"><span class="toc-t">${api.esc(h.textContent.trim())}</span><span class="toc-pg"></span></p>`).join('')
    : '<p class="toc-empty">Headings you add to the document are listed here.</p>');
}
function syncToc() {
  const tocs = api.editor.querySelectorAll('.toc');
  if (!tocs.length) return;
  const hs = heads();
  const want = hs.map((h) => h.tagName[1] + '|' + h.textContent.trim()).join('\n');
  for (const toc of tocs) {
    const have = [...toc.querySelectorAll('[data-i]')].map((p) => p.className.slice(-1) + '|' + (p.querySelector('.toc-t') || p).textContent).join('\n');
    if (have !== want || !toc.firstElementChild || (!hs.length && !toc.querySelector('.toc-empty'))) fill(toc, hs);
    if (toc.getAttribute('contenteditable') !== 'false') toc.setAttribute('contenteditable', 'false');
  }
}
function tocPages() {
  const tocs = api.editor.querySelectorAll('.toc');
  if (!tocs.length) return;
  const hs = heads();
  const nums = hs.map((h) => String(pageAt(h.getBoundingClientRect().top + 1)));
  for (const toc of tocs) toc.querySelectorAll('[data-i]').forEach((p) => {
    const pg = p.querySelector('.toc-pg'), n = nums[Number(p.dataset.i)];
    if (pg && n && pg.textContent !== n) pg.textContent = n;
  });
}
function insertToc() {
  api.restore();
  const toc = document.createElement('div');
  toc.className = 'toc'; toc.setAttribute('contenteditable', 'false');
  fill(toc, heads());
  api.caretIn(api.insertBlock(toc));
  api.done();
}

export function init(a) {
  api = a;
  const { editor } = api;
  api.cmd('footnote', () => insertNote('fn'));
  api.cmd('endnote', () => insertNote('en'));
  api.cmd('toc', insertToc);
  api.on('meta', () => { sync(); syncToc(); });
  api.on('afterLayout', tocPages);
  api.on('load', () => { sync(); syncToc(); });

  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return;
    const el = api.selEl();
    if (!el || !el.closest(NOTES)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    document.execCommand('insertLineBreak');
  }, true);

  editor.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest) return;
    const ref = t.closest('sup.fn-ref,sup.en-ref');
    if (ref && !ref.closest(NOTES)) {
      const li = [...editor.querySelectorAll(`${NOTES.split(',').map((s) => s + ' > li').join(',')}`)].find((x) => x.dataset.fn === ref.dataset.fn);
      if (li) { api.caretIn(li, true); li.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return;
    }
    const toc = t.closest('.toc');
    if (!toc) return;
    const row = t.closest('[data-i]');
    const h = row && heads()[Number(row.dataset.i)];
    if (h) { api.caretIn(h); h.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const r = document.createRange(); r.selectNode(toc);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
}
