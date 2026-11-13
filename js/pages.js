// Real pages: splits the editor's flow across page-sized sheets by pushing
// whole blocks to the next sheet, and draws headers, footers and page numbers.
let api, sheets, decoLayer, hfLayer, rules, noteRules;
let n = 1, P = 0, H = 0, paged = true, hfSig = '', secs = [], pgs = [], pageWmm = 210;
const GAP = 24;
const HF0 = { header: '', headerAlign: 'left', footer: '', footerAlign: 'left', num: 'none', numFormat: '1', firstDiff: false, firstHeader: '', firstFooter: '' };
const ALIGNS = ['left', 'center', 'right'];

export const resetHf = () => { hfSig = ''; };
export const hf = () => ({ ...HF0, ...((api && api.doc && api.doc.hf) || {}) });
export const count = () => n;
export const sections = () => secs;
// Page rectangles in px relative to the page element, for exporters: top, height, width, and the sheet area width they are centred in.
export const geometry = () => ({ pgs: pgs.slice(0, n).map((g) => ({ top: g.top, h: g.h, w: g.w })), W: pageWmm * api.MM });
const parseSect = (el) => { try { return JSON.parse(el.dataset.sect || '{}') || {}; } catch { return {}; } };
// The header/footer settings and page-number offset that apply on page index i (0-based).
function hfFor(i) {
  const eff = { ...hf() };
  let off = 0;
  for (const s of secs) {
    if (s.page > i) break;
    if (s.header !== undefined) eff.header = s.header;
    if (s.footer !== undefined) eff.footer = s.footer;
    if (s.restart != null && s.restart !== '') off = s.page - (Number(s.restart) - 1);
  }
  return { eff, off };
}

export function pageAt(clientTop) {
  if (!api || !P) return 1;
  const pr = api.page.getBoundingClientRect();
  const sc = pr.width / (pageWmm * api.MM) || 1;
  const y = (clientTop - pr.top) / sc;
  let k = 0;
  while (k < pgs.length - 1 && y >= pgs[k + 1].top) k++;
  return Math.max(1, Math.min(n, k + 1));
}

function numText0(fmt, i, total) {
  if (fmt === 'page') return `Page ${i}`;
  if (fmt === 'of') return `Page ${i} of ${total}`;
  return String(i);
}
// Returns { top: {left,center,right}, bottom: {...} }, each slot a list of parts: strings or {num:true}.
function slotParts(h) {
  const z = { top: { left: [], center: [], right: [] }, bottom: { left: [], center: [], right: [] } };
  if (h.header) z.top[ALIGNS.includes(h.headerAlign) ? h.headerAlign : 'left'].push(h.header);
  if (h.footer) z.bottom[ALIGNS.includes(h.footerAlign) ? h.footerAlign : 'left'].push(h.footer);
  if (h.num && h.num !== 'none') {
    const [zone, a] = h.num.split('-');
    if (z[zone] && z[zone][a]) z[zone][a].push({ num: true });
  }
  return z;
}

const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
export function marginBoxes() {
  if (!api || !api.doc) return '';
  const h = hf(), z = slotParts(h);
  const fam = getComputedStyle(api.editor).fontFamily;
  let out = '';
  for (const zone of ['top', 'bottom']) for (const a of ALIGNS) {
    const parts = z[zone][a];
    if (!parts.length) continue;
    const content = parts.map((p, i) => {
      const sep = i ? q(' · ') + ' ' : '';
      if (typeof p === 'string') return sep + q(p);
      if (h.numFormat === 'page') return sep + '"Page " counter(page)';
      if (h.numFormat === 'of') return sep + '"Page " counter(page) " of " counter(pages)';
      return sep + 'counter(page)';
    }).join(' ');
    out += `@${zone}-${a} { content: ${content}; font: 9pt ${fam}; color: #6b6b6b; } `;
  }
  return out;
}
// Print: named pages give each section its own header, footer and orientation. Browser support varies.
export function sectionCss() {
  if (!api || !api.doc || !paged) return '';
  const ed = api.editor;
  const kids = [...ed.children];
  if (!kids.some((el) => el.classList.contains('sect-break'))) return '';
  const base = hf(), d = api.pageDims();
  let css = '', cur = { ...base }, name = 0, rules2 = '';
  let curLand = !!d.landscape, curM = [d.m.t, d.m.r, d.m.b, d.m.l];
  const fam = getComputedStyle(ed).fontFamily;
  let prevHeader = base.header, prevFooter = base.footer;
  kids.forEach((el, idx) => {
    if (el.classList.contains('sect-break')) {
      const s = parseSect(el);
      name++;
      cur = { ...cur, ...(s.header !== undefined ? { header: s.header } : {}), ...(s.footer !== undefined ? { footer: s.footer } : {}) };
      const z = slotParts(cur);
      const boxes = ['top', 'bottom'].flatMap((zn) => ALIGNS.map((a) => {
        const parts = z[zn][a];
        if (!parts.length) return `@${zn}-${a} { content: none; }`;
        const content = parts.map((p) => typeof p === 'string' ? q(p) : (cur.numFormat === 'page' ? '"Page " counter(page)' : cur.numFormat === 'of' ? '"Page " counter(page) " of " counter(pages)' : 'counter(page)')).join(' ');
        return `@${zn}-${a} { content: ${content}; font: 9pt ${fam}; color: #6b6b6b; }`;
      })).join(' ');
      if (s.landscape !== undefined) curLand = !!s.landscape;
      if (s.margins && d.presets[s.margins]) curM = d.presets[s.margins];
      const size = curLand === !!d.landscape ? `${d.w}mm ${d.h}mm` : `${d.h}mm ${d.w}mm`;
      css += `@page sec${name} { size: ${size}; margin: ${curM[0]}mm ${curM[1]}mm ${curM[2]}mm ${curM[3]}mm; ${boxes} } `;
      rules2 += `#editor > :nth-child(${idx + 2}) { page: sec${name}; ${s.restart != null && s.restart !== '' ? `counter-reset: page ${Number(s.restart)};` : ''} } `;
      // every following block (until the next section break) shares the named page
      for (let j = idx + 2; j < kids.length; j++) {
        if (kids[j].classList.contains('sect-break')) break;
        rules2 += `#editor > :nth-child(${j + 1}) { page: sec${name}; } `;
      }
    }
  });
  void prevHeader; void prevFooter;
  return ' ' + css + rules2;
}
export function firstPageCss() {
  if (!api || !api.doc || !hf().firstDiff) return '';
  const h = hf(), z = slotParts({ ...h, header: h.firstHeader || '', footer: h.firstFooter || '', num: 'none' });
  const fam = getComputedStyle(api.editor).fontFamily;
  return ` @page :first { ${['top', 'bottom'].flatMap((zn) => ALIGNS.map((a) => z[zn][a].length ? `@${zn}-${a} { content: ${z[zn][a].map(q).join(' ')}; font: 9pt ${fam}; color: #6b6b6b; }` : `@${zn}-${a} { content: none; }`)).join(' ')} }`;
}

const SPLIT_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE']);
const BLOCKY = 'p,ul,ol,li,table,div,figure,blockquote,pre,h1,h2,h3,h4,h5,h6';
const splittable = (el) => SPLIT_TAGS.has(el.tagName) && !el.querySelector(BLOCKY) && el.textContent.trim().length > 40;
const idx = (el) => Array.prototype.indexOf.call(el.parentNode.children, el) + 1;

// Removes the in-text gaps and column-split wrappers that layout() inserted, so saved/undo/exported HTML never contains them.
export function strip() {
  if (!api) return;
  const ed = api.editor;
  const gs = ed.querySelectorAll('.pgs-gap'), pts = ed.querySelectorAll('.pgs-part');
  if (!gs.length && !pts.length) return;
  const sel = pts.length ? saveSel() : null;
  const ps = new Set();
  gs.forEach((g) => { ps.add(g.parentNode); g.remove(); });
  pts.forEach((w) => { ps.add(w.parentNode); w.replaceWith(...w.childNodes); });
  ps.forEach((q) => q.isConnected && q.normalize());
  if (sel) restoreSel(sel);
}

// Wrapping text in spans moves its nodes, which would drop the caret; keep it by character offset instead.
function saveSel() {
  const s = getSelection();
  if (!s.rangeCount || !api.editor.contains(s.anchorNode) || !api.editor.contains(s.focusNode)) return null;
  const off = (node, o) => { const r = document.createRange(); r.setStart(api.editor, 0); r.setEnd(node, o); return r.toString().length; };
  return [off(s.anchorNode, s.anchorOffset), off(s.focusNode, s.focusOffset)];
}
function restoreSel(sel) {
  const find = (o) => {
    const w = document.createTreeWalker(api.editor, NodeFilter.SHOW_TEXT);
    let n, run = 0, lastN = null;
    while ((n = w.nextNode())) {
      if (o <= run + n.nodeValue.length) return [n, o - run];
      run += n.nodeValue.length; lastN = n;
    }
    return lastN ? [lastN, lastN.nodeValue.length] : null;
  };
  const a = find(sel[0]), f = find(sel[1]);
  if (a && f) { try { getSelection().setBaseAndExtent(a[0], a[1], f[0], f[1]); } catch { /* selection could not be rebuilt */ } }
}

// Cells of a table row that hold plain text (cells with pictures or nested tables are left whole).
const contentH = (cl) => { const r = document.createRange(); r.selectNodeContents(cl); return r.getBoundingClientRect().height; };
const textCells = (tr) => [...tr.cells].filter((c) => c.textContent.trim().length && !c.querySelector('img,table'));

// Room a heading needs below itself so it is never left alone at the foot of a column or page: the gap to the next
// block plus that block (or, if it can split, its first two lines). 0 when nothing follows on the same page.
function keepNeed(us, i, sc) {
  const u = us[i], n = us[i + 1];
  if (!u.keep || !n || n.brk || n.forced) return 0;
  const cs = getComputedStyle(n.el);
  const lhPx = parseFloat(cs.lineHeight) / sc, lh = lhPx > 0 ? lhPx : (parseFloat(cs.fontSize) / sc) * 1.3;
  const h = n.b - n.t;
  return Math.max(0, n.t - u.b) + (n.split || n.row ? Math.min(h, 2 * lh) : h);
}

// Column mode: slide everything from `range` onward (text and atomic inlines) by dx/dy. Nested wrappers add up, so a
// paragraph can carry on through several columns. Only the visual position moves; line breaks are unchanged.
function shiftAfter(el, range, dx, dy) {
  let sn = range.startContainer;
  if (sn.nodeType === 3 && range.startOffset > 0 && range.startOffset < sn.nodeValue.length) sn = sn.splitText(range.startOffset);
  else if (sn.nodeType === 3 && range.startOffset >= sn.nodeValue.length) sn = null;
  else if (sn.nodeType === 1) sn = sn.childNodes[range.startOffset] || null;
  const leaves = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (n.nodeType === 3) return (n.nodeValue.length && !n.parentElement.closest('[contenteditable="false"]')) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      if (n.tagName === 'IMG' || n.tagName === 'BR' || n.getAttribute('contenteditable') === 'false') return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  let n, on = false;
  while ((n = w.nextNode())) {
    if (!on) { if (n === sn || (sn && sn.contains && sn.contains(n)) || (sn && (sn.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING))) on = true; else continue; }
    leaves.push(n);
  }
  for (const l of leaves) {
    const sp = document.createElement('span');
    sp.className = 'pgs-part';
    sp.style.cssText = `position:relative;left:${dx.toFixed(2)}px;top:${dy.toFixed(2)}px`;
    l.parentNode.insertBefore(sp, l); sp.append(l);
  }
}

function units(ed, landOf, mOf) {
  const out = [];
  let i = 0, forced = false;
  for (const el of ed.children) {
    i++;
    const land = landOf[i - 1], m = mOf[i - 1];
    if (el.classList.contains('page-break')) { out.push({ el, land, m, brk: true, sel: `#editor > :nth-child(${i})` }); forced = true; continue; }
    if ((el.tagName === 'UL' || el.tagName === 'OL') && el.children.length) {
      let j = 0;
      for (const li of el.children) { j++; out.push({ el: li, land, m, sel: `#editor > :nth-child(${i}) > :nth-child(${j})`, forced, split: splittable(li) }); forced = false; }
    } else if (el.tagName === 'TABLE' && el.rows.length > 1) {
      const tsel = `#editor > :nth-child(${i})`;
      for (const tr of el.rows) {
        out.push({ el: tr, land, m, row: true, tsel, sel: `${tsel} > :nth-child(${idx(tr.parentNode)}) > :nth-child(${idx(tr)})`, forced });
        forced = false;
      }
    } else { out.push({ el, land, m, sel: `#editor > :nth-child(${i})`, forced, split: splittable(el), keep: /^H[1-6]$/.test(el.tagName) }); forced = false; }
  }
  return out;
}

// Text positions of el, in order, so a line can be found by binary search.
function textNodes(el) {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('[contenteditable="false"]') || !n.nodeValue.length) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let n, total = 0;
  while ((n = w.nextNode())) { out.push({ n, from: total }); total += n.nodeValue.length; }
  return { nodes: out, total };
}
function at(tx, i) {
  let lo = 0, hi = tx.nodes.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tx.nodes[m].from <= i) lo = m; else hi = m - 1; }
  const e = tx.nodes[lo];
  return { n: e.n, o: Math.min(e.n.nodeValue.length, i - e.from) };
}
function rectAt(tx, i) {
  for (let j = i; j < Math.min(tx.total, i + 40); j++) {
    const a = at(tx, j);
    if (a.o >= a.n.nodeValue.length) continue;
    const r = document.createRange();
    r.setStart(a.n, a.o); r.setEnd(a.n, a.o + 1);
    const rs = r.getClientRects();
    if (rs.length) { const q = rs[rs.length - 1]; if (q.height) return { top: q.top, bottom: q.bottom }; }
  }
  return null;
}
// First line of el whose bottom passes yLimit (client px). Returns where that line starts, never at or before char `after`.
function lineSplit(el, yLimit, after) {
  const tx = textNodes(el);
  if (!tx.total) return null;
  let lo = Math.max(0, after + 1), hi = tx.total - 1, found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const r = rectAt(tx, m);
    if (r && r.bottom > yLimit) { found = m; hi = m - 1; } else lo = m + 1;
  }
  if (found < 0) return null;
  const ref = rectAt(tx, found);
  if (!ref) return null;
  const tol = Math.max(2, (ref.bottom - ref.top) * 0.5);
  lo = Math.max(0, after + 1); hi = found;
  let first = found;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const r = rectAt(tx, m);
    if (r && r.top > ref.top - tol) { first = m; hi = m - 1; } else lo = m + 1;
  }
  if (first <= after || first <= 0) return null;
  const rr = rectAt(tx, first) || ref;
  const a = at(tx, first);
  const range = document.createRange();
  range.setStart(a.n, a.o); range.collapse(true);
  return { idx: first, top: rr.top, range, lh: rr.bottom - rr.top };
}

// Orientation and margins in force for each top-level block: a section break changes them from there on.
function flowOf() {
  const d = api.pageDims(), kids = [...api.editor.children], land = [], mar = [];
  let L = !!d.landscape, M = { ...d.m };
  for (const el of kids) {
    land.push(L); mar.push(M);
    if (el.classList.contains('sect-break')) {
      const sc = parseSect(el);
      if (sc.landscape !== undefined) L = !!sc.landscape;
      const pm = sc.margins && d.presets[sc.margins];
      if (pm) M = { t: pm[0], r: pm[1], b: pm[2], l: pm[3] };
    }
  }
  return { kids, land, mar, d };
}
export function pageWidthMm() { return pageWmm || api.pageDims().w; }
export function marginsAtCaret() {
  const { kids, land, mar, d } = flowOf();
  const sel = getSelection();
  let i = 0;
  if (sel && sel.anchorNode) { const k = kids.findIndex((el) => el.contains(sel.anchorNode)); if (k >= 0) i = k; }
  const L = land[i] === undefined ? !!d.landscape : land[i];
  return { w: L === !!d.landscape ? d.w : d.h, m: mar[i] || d.m };
}

// On screen every sheet keeps one size, so a section's orientation can't be drawn; say so on the break itself.
function labelBreaks() {
  let css = '', land = !!api.pageDims().landscape;
  const multi = api.pageDims().cols > 1;
  [...api.editor.children].forEach((el, i) => {
    if (!el.classList.contains('sect-break')) return;
    const s = parseSect(el), bits = [];
    if (s.landscape !== undefined && !!s.landscape !== land) { land = !!s.landscape; if (multi) bits.push(land ? 'landscape from here' : 'portrait from here'); }
    if (s.margins && multi) bits.push(`${s.margins} margins`);
    if (s.header !== undefined) bits.push('own header');
    if (s.footer !== undefined) bits.push('own footer');
    if (s.restart != null && s.restart !== '') bits.push(`page numbers restart at ${s.restart}`);
    if (bits.length) css += `#editor>:nth-child(${i + 1})::after{content:"Section break · ${bits.join(' · ').replace(/"/g, '')} (see Word and print)" !important}`;
  });
  noteRules.textContent = css;
}

export function layout() {
  if (!api || !api.doc || !sheets) return;
  const d0 = api.pageDims();
  if (!(d0.balance && d0.cols > 1)) return layoutPass(null);
  // Balance the last page's columns: lay out once, work out how much text sits on the last page, then lay out again with that
  // page's columns shortened to an even share. If shortening pushes anything onto a new page, try a little taller, then give up.
  const first = layoutPass(null);
  if (!first || first.colH - first.share < 2) return;
  const lh = first.lh || 18;
  for (let extra = 0; extra < 6; extra++) {
    const cut = first.colH - Math.min(first.colH, first.share + extra * lh);
    if (cut < 2) break;
    const r = layoutPass({ page: first.kk, cut });
    if (r && r.kk === first.kk) return;
  }
  layoutPass(null);
}

function layoutPass(bal) {
  strip();
  labelBreaks();
  if (decoLayer) decoLayer.textContent = '';
  const { page, editor, MM } = api;
  const d = api.pageDims();
  H = d.h * MM;
  const mt = d.m.t * MM, mb = d.m.b * MM;
  const cols = d.cols > 1 ? d.cols : 1;
  const gapX = 12.5 * MM;
  const colW = ((d.w - d.m.l - d.m.r) * MM - (cols - 1) * gapX) / cols;
  // Orientation per block: a section break can switch landscape on or off from there on. Drawn on screen for single-column documents.
  const baseLand = !!d.landscape;
  const dimsFor = (L) => (L === baseLand ? { w: d.w, h: d.h } : { w: d.h, h: d.w });
  const { kids, land: landOf, mar: mOf } = flowOf();
  const sameM = (m) => m.t === d.m.t && m.r === d.m.r && m.b === d.m.b && m.l === d.m.l;
  const mixed = cols === 1 && (landOf.some((l) => l !== baseLand) || mOf.some((m) => !sameM(m)));
  const Wmm = mixed ? Math.max(d.w, d.h) : d.w;
  pageWmm = Wmm;
  page.style.setProperty('--page-w', Wmm + 'mm');
  let wr = '';
  if (mixed) {
    kids.forEach((el, i) => {
      const w = dimsFor(landOf[i]).w, m = mOf[i], cw = (w - m.l - m.r) * MM, off = ((Wmm - w) / 2 + m.l - d.m.l) * MM;
      const natural = (Wmm - d.m.l - d.m.r) * MM;
      wr += `#editor>:nth-child(${i + 1}){${cw > natural + 0.5 ? `width:${cw}px` : `max-width:${cw}px`} !important;box-sizing:border-box;position:relative;left:${off.toFixed(2)}px}${el.tagName === 'TABLE' ? `#editor>:nth-child(${i + 1}){width:${cw}px !important}` : ''}`;
    });
  }
  // A picture can never be taller than the smallest page body in the document, so it always fits on a page (object-fit keeps its shape).
  let capH = H - mt - mb;
  if (cols === 1) kids.forEach((_, i) => { capH = Math.min(capH, dimsFor(landOf[i]).h * MM - (mOf[i].t + mOf[i].b) * MM); });
  // Shapes, charts and pictures inside table cells are capped too (a cell's padding and borders need room), so a row of them always fits.
  const capPx = Math.max(40, capH - 2).toFixed(1), capCell = Math.max(40, capH - 40).toFixed(1);
  const imgCap = `#editor img{max-height:${capPx}px;object-fit:contain}#editor td img,#editor th img{max-height:${capCell}px}#editor .shape{max-height:${capPx}px !important}#editor .chart svg{max-height:${capPx}px}#editor .textbox{max-height:${capPx}px;overflow:auto}`;
  wr += imgCap;
  // in column mode every block is narrowed to one column while measuring; the blocks are then slid into place
  rules.textContent = cols > 1 ? `#editor>*{max-width:${colW}px !important;box-sizing:border-box}#editor>table{width:${colW}px !important}` + imgCap : wr;
  // A table nested in a cell that is taller than a page can't be cut, so it scrolls inside its cell instead.
  const path = (el) => { const s = []; for (let e = el; e && e !== editor; e = e.parentNode) s.unshift(`:nth-child(${idx(e)})`); return '#editor>' + s.join('>'); };
  const nestedCap = [...editor.querySelectorAll('td table, th table')].filter((tb) => tb.offsetHeight > capH - 40)
    .map((tb) => `${path(tb)}{display:block;max-height:${capCell}px;overflow:auto}`).join('');
  if (nestedCap) { wr += nestedCap; rules.textContent += nestedCap; }
  paged = true;
  P = H + GAP;
  const pr = page.getBoundingClientRect();
  const sc = pr.width / (Wmm * MM) || 1;
  const us = units(editor, landOf, mOf);
  for (const u of us) {
    const r = u.el.getBoundingClientRect();
    u.t = (r.top - pr.top) / sc; u.b = (r.bottom - pr.top) / sc;
  }
  if (cols > 1) {
    const colH = H - mt - mb;
    const sel0 = saveSel();
    let c = 0, kk = 0, SS = 0, pend2 = null, css2 = '', first = true;
    let lastB = 0, lastPg = 0, lineH = 0;
    const bottomAt = (k) => k * P + H - mb - (bal && bal.page === k ? bal.cut : 0);
    secs = [];
    const advance = () => {
      c++;
      if (c >= cols) { c = 0; kk++; if (pend2) { secs.push({ ...pend2, page: kk }); pend2 = null; } }
    };
    let force = false, parted = false, own = null;
    // Let a paragraph run on into the next column(s): cut it at line boundaries and slide each following part up there.
    const splitCols = (u) => {
      const lhPx = parseFloat(getComputedStyle(u.el).lineHeight) / sc;
      const lh = (lhPx > 0 ? lhPx : (parseFloat(getComputedStyle(u.el).fontSize) / sc) * 1.3);
      const bottom = () => bottomAt(kk), top = () => kk * P + mt;
      let dy = 0, last = -1, pieceTop = u.t, did = 0, c0 = c, kk0 = kk, SS0 = SS;
      own = null;
      while (u.b + dy + SS0 > bottom() + 0.5) {
        const lim = pr.top + (bottom() - SS0) * sc;
        let cut = lineSplit(u.el, lim, last);
        if (!cut) break;
        const py = (q) => (q.top - pr.top) / sc;
        if ((u.b + dy - py(cut)) < 1.5 * lh) { const c2 = lineSplit(u.el, cut.top - 1, last); if (!c2) break; cut = c2; }
        const cutY = py(cut);
        if (cutY - pieceTop < 1.5 * lh) break;       // would leave a lone line behind
        const cOld = c;
        advance();
        const dyInc = top() - SS0 - cutY, dxInc = (c - cOld) * (colW + gapX);
        shiftAfter(u.el, cut.range, dxInc, dyInc);
        dy += dyInc; did++; last = cut.idx; pieceTop = top() - SS0;
      }
      if (!did) { c = c0; kk = kk0; return false; }
      own = { x: c0 * (colW + gapX), ss: SS0 };
      SS = SS0 + dy; parted = true;
      return true;
    };
    // A row taller than a column: cut every text cell at its own line boundaries and slide the pieces into the following columns.
    const splitRowCols = (u) => {
      const cells = textCells(u.el);
      if (!cells.length) return false;
      const hs = new Map(cells.map((cl) => [cl, contentH(cl)]));
      const primary = cells.reduce((a, b) => (hs.get(b) > hs.get(a) ? b : a));
      const st = new Map(cells.map((cl) => {
        const lp = parseFloat(getComputedStyle(cl).lineHeight) / sc;
        return [cl, { last: -1, dy: 0, top: u.t, lh: lp > 0 ? lp : (parseFloat(getComputedStyle(cl).fontSize) / sc) * 1.3 }];
      }));
      const bottom = () => bottomAt(kk), top = () => kk * P + mt;
      const py = (q) => (q.top - pr.top) / sc;
      const c0 = c, kk0 = kk, SS0 = SS;
      let did = 0, guard = 0;
      const segs = [];
      own = null;
      while (u.b + st.get(primary).dy + SS0 > bottom() + 0.5 && guard++ < 100) {
        const lim = pr.top + (bottom() - SS0) * sc;
        const found = [];
        for (const cl of cells) {
          const s = st.get(cl);
          let cut = lineSplit(cl, lim, s.last);
          if (!cut) continue;
          const cellB = (cl.getBoundingClientRect().bottom - pr.top) / sc;
          if (cellB - py(cut) < 1.5 * s.lh) { const c2 = lineSplit(cl, cut.top - 1, s.last); if (!c2) continue; cut = c2; }
          if (py(cut) - s.top < 1.5 * s.lh) continue;   // would leave a lone line behind
          found.push([cl, cut]);
        }
        if (!found.some(([cl]) => cl === primary)) break;
        const cOld = c;
        advance();
        const dxInc = (c - cOld) * (colW + gapX);
        for (const [cl, cut] of found) {
          const s = st.get(cl), cutY = py(cut), dyInc = top() - SS0 - cutY;
          shiftAfter(cl, cut.range, dxInc, dyInc);
          s.dy += dyInc; s.last = cut.idx; s.top = top() - SS0;
        }
        segs.push({ kk, c, cut: found.map(([cl]) => cl) });
        did++;
      }
      if (!did) { c = c0; kk = kk0; return false; }
      // Draw the row's cells (borders and shading) piece by piece, and hide the native ones, which would run on past the column.
      const rowEnd = u.b + SS0 + st.get(primary).dy;
      const pieces = [{ kk: kk0, c: c0, y0: u.t + SS0, first: true }, ...segs.map((sg) => ({ kk: sg.kk, c: sg.c, y0: sg.kk * P + mt }))];
      const csc = [...u.el.cells].map((cl) => ({ r: cl.getBoundingClientRect(), cs: getComputedStyle(cl) }));
      pieces.forEach((pc, i) => {
        const last = i === pieces.length - 1, y1 = last ? rowEnd : bottomAt(pc.kk);
        csc.forEach(({ r, cs }) => {
          const bd = (s) => `${cs['border' + s + 'Width']} ${cs['border' + s + 'Style']} ${cs['border' + s + 'Color']}`;
          const b = document.createElement('div');
          b.style.cssText = `position:absolute;box-sizing:border-box;left:${((r.left - pr.left) / sc + pc.c * (colW + gapX)).toFixed(2)}px;top:${pc.y0.toFixed(2)}px;width:${(r.width / sc).toFixed(2)}px;height:${Math.max(0, y1 - pc.y0).toFixed(2)}px;background:${cs.backgroundColor};border-top:${bd('Top')};border-left:${bd('Left')};border-right:${bd('Right')};border-bottom:${last ? bd('Bottom') : 'none'}`;
          decoLayer.append(b);
        });
      });
      css2 += `${u.sel} > *{background:transparent !important;border-color:transparent !important}`;
      own = { x: c0 * (colW + gapX), ss: SS0 };
      SS = SS0 + st.get(primary).dy; parted = true;
      return true;
    };
    const tallRow = (u) => u.row && (u.b - u.t) > colH && textCells(u.el).length > 0;
    const trySplitCols = (u) => (u.row ? splitRowCols(u) : splitCols(u));
    for (let ui = 0; ui < us.length; ui++) {
      const u = us[ui];
      parted = false; own = null;
      if (u.brk) {
        if (u.el.classList.contains('sect-break')) pend2 = parseSect(u.el);
        force = true;
        const x = c * (colW + gapX);
        if (x || SS) css2 += `${u.sel}{position:relative;left:${x.toFixed(2)}px;top:${SS.toFixed(2)}px}`;
        continue;
      }
      const top = () => kk * P + mt, bottom = () => bottomAt(kk);
      if (first) { first = false; SS = 0; }
      else if (force || u.forced) { if (c !== 0 || (u.t + SS) > top() + 1) { c = cols - 1; advance(); } SS = top() - u.t; }
      else if (u.b + SS > bottom() + 0.5 && !((u.split || tallRow(u)) && trySplitCols(u))) { if (u.t + SS > top() + 1) { advance(); SS = top() - u.t; } }
      if (!force && !u.forced && u.keep && !parted && ui > 0) {
        const need = keepNeed(us, ui, sc);
        if (need && need < colH && u.b + SS + need > bottom() + 0.5 && u.t + SS > top() + 1) { advance(); SS = top() - u.t; }
      }
      force = false;
      if (!parted && (u.split || tallRow(u)) && u.b + SS > bottom() + 0.5) trySplitCols(u);
      if (!parted && u.b - u.t > colH) { // taller than a column: it keeps its place and the next block starts on a fresh page
        kk = Math.max(kk, Math.floor((u.b + SS - 1) / P)); c = cols - 1;
      }
      const x = own ? own.x : c * (colW + gapX), ss = own ? own.ss : SS;
      if (x || ss) css2 += `${u.sel}{position:relative;left:${x.toFixed(2)}px;top:${ss.toFixed(2)}px}`;
      // where the text on the current page ends (the bottom of the lowest block placed in the column being filled)
      if (kk !== lastPg) { lastPg = kk; lastB = 0; }
      lastB = Math.max(lastB, u.b + ss);
      if (!lineH) { const l = parseFloat(getComputedStyle(u.el).lineHeight) / sc; if (l > 0) lineH = l; }
    }
    n = kk + 1;
    const total = n * H + (n - 1) * GAP;
    rules.textContent += css2 + `#editor{height:${total - mt - mb}px !important;min-height:0 !important}`;
    page.style.height = total + 'px';
    pgs = Array.from({ length: n }, (_, i) => ({ top: i * P, h: H, w: d.w * MM, land: baseLand }));
    if (sel0 && api.editor.querySelector('.pgs-part')) restoreSel(sel0);
    drawSheets(n, false);
    drawHf(d, false);
    // ask for a balancing pass: text on the last page = the columns filled before this one + the part of this one that is used
    return { kk, colH, lh: lineH, share: Math.ceil(((c * colH + Math.max(0, lastB - (kk * P + mt))) / cols) / (lineH || 18)) * (lineH || 18) };
  }
  let S = 0, k = 0, prevB = mt, css = '', pend = null, carry = 0, tblS0 = 0, curT = null, tblR = 0;
  const newPage = (i, L, m) => { const dm = dimsFor(L), prev = pgs[i - 1]; return { top: prev ? prev.top + prev.h + GAP : 0, h: dm.h * MM, w: dm.w * MM, land: L, m }; };
  pgs = [newPage(0, us.length ? us[0].land : baseLand, us.length ? us[0].m : d.m)];
  const cuts = [];
  secs = [];
  const CT = () => pgs[k].top + pgs[k].m.t * MM, CB = () => pgs[k].top + pgs[k].h - pgs[k].m.b * MM;
  const nextTop = () => pgs[k].top + pgs[k].h + GAP;
  for (let ui = 0; ui < us.length; ui++) {
    const u = us[ui];
    if (u.brk && u.el.classList.contains('sect-break')) pend = parseSect(u.el);
    if (u.row) { if (u.tsel !== curT) { curT = u.tsel; tblS0 = S; tblR = 0; } } else if (curT) { carry = S - tblS0 - tblR; curT = null; tblR = 0; }
    const g = Math.max(0, u.t - prevB);
    let add = u.row ? 0 : carry;
    if (!u.row) carry = 0;
    let moved = 0;
    const tNow = () => u.t + S, bNow = () => u.b + S;
    const go = () => { k++; pgs[k] = newPage(k, u.land, u.m); };
    const umt = u.m.t * MM;
    const pushWhole = () => {
      const delta = nextTop() + umt - tNow();
      if (delta > 0) {
        if (u.row) { S += delta; } else { moved += delta; S += delta; }
        go();
        if (pend) { secs.push({ ...pend, page: k }); pend = null; }
      }
    };
    const trySplit = () => {
      const lhPx = parseFloat(getComputedStyle(u.el).lineHeight) / sc;
      const lh = (lhPx > 0 ? lhPx : (parseFloat(getComputedStyle(u.el).fontSize) / sc) * 1.3) * sc;
      let did = 0, pieceTop = u.t, last = -1;
      while (bNow() > CB() + 0.5) {
        const lim = pr.top + (CB() - S) * sc;
        let cut = lineSplit(u.el, lim, last);
        if (!cut) break;
        const px = (c) => (c.top - pr.top) / sc;
        if ((u.b - px(cut)) * sc < 1.5 * lh) {
          const c2 = lineSplit(u.el, cut.top - 1, last);
          if (!c2) break;
          cut = c2;
        }
        const cutNat = px(cut);
        if ((cutNat - pieceTop) * sc < 1.5 * lh) break;
        const gap = nextTop() + umt - (cutNat + S);
        if (gap <= 0) break;
        cuts.push({ range: cut.range, gap });
        S += gap; go(); did++; pieceTop = cutNat; last = cut.idx;
        if (pend) { secs.push({ ...pend, page: k }); pend = null; }
      }
      return did;
    };
    // A row taller than a whole page body can't be moved anywhere that fits: cut each cell at line boundaries and continue it on the next page.
    const cellsOf = () => [...u.el.cells].filter((c) => c.textContent.trim().length && !c.querySelector('img,table'));
    const splitRow = () => {
      const cells = cellsOf();
      if (!cells.length) return 0;
      const hs = new Map(cells.map((c) => [c, contentH(c)]));
      const primary = cells.reduce((a, b) => (hs.get(b) > hs.get(a) ? b : a));
      const lastOf = new Map();
      const px = (c) => (c.top - pr.top) / sc;
      let did = 0, guard = 0;
      while (bNow() > CB() + 0.5 && guard++ < 200) {
        const lim = pr.top + (CB() - S) * sc;
        let gP = 0, gMax = 0, any = 0;
        for (const c of cells) {
          const cut = lineSplit(c, lim, lastOf.has(c) ? lastOf.get(c) : -1);
          if (!cut) continue;
          const gap = nextTop() + umt - (px(cut) + S);
          if (gap <= 0) continue;
          cuts.push({ range: cut.range, gap });
          lastOf.set(c, cut.idx); any++;
          if (c === primary) gP = gap;
          gMax = Math.max(gMax, gap);
        }
        if (!any) break;
        const inc = gP || gMax;
        S += inc; tblRNow += inc; go(); did++;
        if (pend) { secs.push({ ...pend, page: k }); pend = null; }
      }
      return did;
    };
    let tblRNow = tblR;
    let rowSplit = 0;
    if (!u.brk && u.row && !u.forced && (u.b - u.t) > (CB() - CT()) && cellsOf().length) {
      // tall row: start in place when there is room for a few lines, else on a fresh page
      if (tNow() > CB() - 3 * 18) pushWhole();
      const off0 = S - tblS0 - tblR;
      rowSplit = splitRow();
      if (rowSplit) { if (off0 > 0) css += `${u.sel}{position:relative;top:${off0.toFixed(2)}px}`; tblR = tblRNow; }
    }
    if (!u.brk && !rowSplit) {
      let did = 0;
      if (u.forced) pushWhole();
      else if (u.keep && ui > 0) { const need = keepNeed(us, ui, sc); if (need && need < CB() - CT() && bNow() + need > CB() + 0.5 && tNow() > CT() + 1) pushWhole(); }
      if (!u.forced && u.split && bNow() > CB() + 0.5 && tNow() < CB() - 2 * (parseFloat(getComputedStyle(u.el).lineHeight) / sc || 18)) did = trySplit();
      if (!did && !u.forced && bNow() > CB() + 0.5 && tNow() > CT() + 1) pushWhole();
      if (u.split && bNow() > CB() + 0.5) trySplit();
    }
    if (u.row) {
      if (!rowSplit) { const off = S - tblS0 - tblR; if (off > 0) css += `${u.sel}{position:relative;top:${off.toFixed(2)}px}`; }
    } else if (moved + add > 0) css += `${u.sel}{margin-top:${(g + moved + add).toFixed(2)}px !important}`;
    while (bNow() - 1 >= nextTop()) go();
    prevB = u.b;
  }
  for (const c of cuts.reverse()) {
    const sp = document.createElement('span');
    sp.className = 'pgs-gap'; sp.contentEditable = 'false'; sp.style.height = c.gap.toFixed(2) + 'px';
    c.range.insertNode(sp);
  }
  n = k + 1;
  pgs.length = n;
  rules.textContent = wr + css;
  page.style.height = pgs[k].top + pgs[k].h + 'px';
  drawSheets(n, false);
  drawHf(d, false);
}

const Wpx = () => pageWmm * api.MM;
function drawSheets(num, whole) {
  while (sheets.children.length > num) sheets.lastChild.remove();
  while (sheets.children.length < num) { const s = document.createElement('div'); s.className = 'sheet'; sheets.append(s); }
  [...sheets.children].forEach((s, i) => {
    s.style.top = whole ? '0' : (pgs[i] ? pgs[i].top : i * P) + 'px';
    s.style.height = whole ? '100%' : (pgs[i] ? pgs[i].h : H) + 'px';
    const g = !whole && pgs[i];
    s.style.left = g ? (Wpx() - g.w) / 2 + 'px' : '';
    s.style.right = g ? 'auto' : '';
    s.style.width = g ? g.w + 'px' : '';
  });
}

function drawHf(d, whole) {
  const h = hf(), MM = api.MM;
  const fam = getComputedStyle(api.editor).fontFamily;
  const sig = JSON.stringify([h, secs, n, d, whole, pgs, fam, whole ? api.page.offsetHeight : 0]);
  if (sig === hfSig) return;
  hfSig = sig;
  const z = slotParts(h);
  const zonesFor = whole ? 1 : n;
  let html = '';
  const zone = (which, i, top, height) => {
    const g = !whole && pgs[i];
    const place = g ? `left:${(Wpx() - g.w) / 2}px;right:auto;width:${g.w}px;` : '';
    const pm = g && g.m ? g.m : d.m;
    const blank = false;
    const hp = hfFor(i);
    if (h.firstDiff && i === 0) hp.eff = { ...hp.eff, header: h.firstHeader || '', footer: h.firstFooter || '', num: 'none' };
    const parts = slotParts(hp.eff)[which];
    const numText = (f, k, t) => numText0(f, k - hp.off, t);
    const any = !blank && ALIGNS.some((a) => parts[a].length);
    const cells = ALIGNS.map((a) => `<span class="hf-${a}">${blank ? '' : parts[a].map((p) => api.esc(typeof p === 'string' ? p : numText(h.numFormat, i + 1, n))).join(' · ')}</span>`).join('');
    const name = which === 'top' ? 'header' : 'footer';
    html += `<div class="hf-zone hf-${name}${any ? '' : ' empty'}" style="${place}top:${top}px;height:${height}px;padding:0 ${pm.r * MM}px 0 ${pm.l * MM}px" title="Double-click to edit the ${name}">${any ? cells : `<span class="hf-hint">Double-click to add a ${name}</span>`}</div>`;
  };
  for (let i = 0; i < zonesFor; i++) {
    const base = whole ? 0 : pgs[i].top;
    const pmg = !whole && pgs[i].m ? pgs[i].m : d.m;
    zone('top', i, base, pmg.t * MM);
    if (whole) html += `<div class="hf-zone hf-footer-wrap" style="bottom:0;height:${d.m.b * MM}px"></div>`;
    else zone('bottom', i, base + pgs[i].h - pmg.b * MM, pmg.b * MM);
  }
  if (whole) {
    // one continuous sheet: footer sits at the very bottom
    const parts = z.bottom, any = ALIGNS.some((a) => parts[a].length);
    html = html.replace('<div class="hf-zone hf-footer-wrap" style="', `<div class="hf-zone hf-footer${any ? '' : ' empty'}" title="Double-click to edit the footer" style="padding:0 ${d.m.r * MM}px 0 ${d.m.l * MM}px;`)
      .replace(/<\/div>$/, (any ? ALIGNS.map((a) => `<span class="hf-${a}">${parts[a].map((p) => api.esc(typeof p === 'string' ? p : numText0(h.numFormat, 1, n))).join(' · ')}</span>`).join('') : '<span class="hf-hint">Double-click to add a footer</span>') + '</div>');
  }
  hfLayer.style.fontFamily = fam;
  hfLayer.innerHTML = html;
}

// Orientation in force just before section break `el`.
function landBefore(el) {
  let land = !!api.pageDims().landscape;
  for (const k of api.editor.children) {
    if (k === el) break;
    if (k.classList.contains('sect-break')) { const q2 = parseSect(k); if (q2.landscape !== undefined) land = !!q2.landscape; }
  }
  return land;
}

function openDialog() {
  const dlg = api.$('#dlg-hf'), h = hf();
  api.$('#hf-header').value = h.header;
  api.$('#hf-header-align').value = h.headerAlign;
  api.$('#hf-footer').value = h.footer;
  api.$('#hf-footer-align').value = h.footerAlign;
  api.$('#hf-num').value = h.num;
  api.$('#hf-format').value = h.numFormat;
  api.$('#hf-first').checked = !!h.firstDiff;
  api.$('#hf-first-header').value = h.firstHeader || '';
  api.$('#hf-first-footer').value = h.firstFooter || '';
  dlg.returnValue = '';
  dlg.showModal();
}

async function editSect(el) {
  const s = parseSect(el), h = hf();
  const v = await api.ask('Section settings', [
    { id: 'header', label: 'Header for this section (blank keeps the previous one)', value: s.header !== undefined ? s.header : '' },
    { id: 'footer', label: 'Footer for this section (blank keeps the previous one)', value: s.footer !== undefined ? s.footer : '' },
    { id: 'restart', label: 'Restart page numbers at (blank continues)', type: 'number', value: s.restart != null ? s.restart : '' },
    { id: 'landscape', label: 'Landscape orientation', type: 'check', value: s.landscape !== undefined ? !!s.landscape : landBefore(el) },
    { id: 'margins', label: 'Margins', type: 'select', options: [['', 'Same as before'], ['normal', 'Normal'], ['narrow', 'Narrow'], ['moderate', 'Moderate'], ['wide', 'Wide']], value: s.margins || '' },
  ], { ok: 'Apply', note: 'These apply to the pages after this break. Landscape pages and margins are drawn on screen (single-column documents), and carried into Word and print.' });
  if (!v) return;
  const o = {};
  if (v.header.trim()) o.header = v.header.trim();
  if (v.footer.trim()) o.footer = v.footer.trim();
  if (String(v.restart).trim() !== '') o.restart = Math.max(0, parseInt(v.restart, 10) || 1);
  if (!!v.landscape !== landBefore(el) || s.landscape !== undefined) o.landscape = !!v.landscape;
  if (v.margins) o.margins = v.margins;
  api.begin();
  el.dataset.sect = JSON.stringify(o);
  api.done();
  void h; hfSig = '';
  api.changed();
}

export function init(a) {
  api = a;
  const { page } = api;
  sheets = document.createElement('div'); sheets.className = 'sheets'; sheets.setAttribute('aria-hidden', 'true');
  decoLayer = document.createElement('div'); decoLayer.className = 'sheets'; decoLayer.setAttribute('aria-hidden', 'true');
  hfLayer = document.createElement('div'); hfLayer.className = 'hf-layer';
  page.prepend(sheets);
  sheets.after(decoLayer);
  page.append(hfLayer);
  page.classList.add('paged');
  noteRules = document.createElement('style'); noteRules.id = 'pgs-notes'; noteRules.media = 'screen';
  document.head.append(noteRules);
  rules = document.createElement('style'); rules.id = 'pgs-rules'; rules.media = 'screen';
  document.head.append(rules);

  hfLayer.addEventListener('dblclick', (e) => { if (e.target.closest('.hf-zone')) openDialog(); });
  api.cmd('hf', openDialog);
  api.cmd('sectionBreak', () => {
    const d = document.createElement('div');
    d.className = 'page-break sect-break'; d.contentEditable = 'false'; d.dataset.sect = '{}';
    api.begin(); api.caretIn(api.insertBlock(d)); api.done();
    editSect(d);
  });
  api.editor.addEventListener('dblclick', (e) => { const b = e.target.closest && e.target.closest('.sect-break'); if (b) editSect(b); });
  api.$('#dlg-hf').addEventListener('close', (e) => {
    if (e.target.returnValue !== 'ok') return;
    api.doc.hf = {
      header: api.$('#hf-header').value.trim(), headerAlign: api.$('#hf-header-align').value,
      footer: api.$('#hf-footer').value.trim(), footerAlign: api.$('#hf-footer-align').value,
      num: api.$('#hf-num').value, numFormat: api.$('#hf-format').value, firstDiff: api.$('#hf-first').checked,
      firstHeader: api.$('#hf-first-header').value.trim(), firstFooter: api.$('#hf-first-footer').value.trim(),
    };
    hfSig = '';
    api.applyPage();
    api.changed(true);
  });
}
