// Compare documents: show what changed between this document and an earlier version or another file.
// The result opens as a new document with every difference as a tracked change, so it can be
// accepted, rejected and exported like any other.
import { versionsOf } from './docs.js';

let api;
const LEAF = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,td,th';
const SKIP = '.toc,.index,.biblio,.chart,.shape,.eq,.smartart,.textbox,.wordart,.page-break,.sect-break,.rep-head';
const NOTELIST = 'ol.footnotes,ol.endnotes';
const OBJ = '.fn-ref,.en-ref,.cap-num,.xref,.cite,.eq,.mfield,.tf,.idx,.wordart,.smartart,.shape,.chart,img,svg';
const MAX_CELLS = 20e6;
const AUTHOR = 'Compare';

const norm = (t) => t.replace(/\s+/g, ' ').trim();

function parse(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('.pg-part,.pgs-part').forEach((w) => w.replaceWith(...w.childNodes));
  d.querySelectorAll('del.tc').forEach((x) => x.remove()); // compare as if existing changes were accepted
  d.querySelectorAll('ins.tc').forEach((x) => x.replaceWith(...x.childNodes));
  return d;
}
const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const imgSig = (img) => 'img' + hash(img.getAttribute('src') || '');
// A paragraph's identity: its text plus its pictures, so a replaced or added picture counts as a change.
// Inline objects (equations, WordArt) are left out of a paragraph's text: they are compared as objects, so a change to one is not a text edit.
// Note marks (the 1 in a footnote reference) are left out too: they are renumbered when a note is added or removed, which is not a text edit.
const INLINE = '.eq,.wordart,.fn-ref,.en-ref';
const plain = (el) => { if (!el.querySelector(INLINE)) return norm(el.textContent); const c = el.cloneNode(true); c.querySelectorAll(INLINE).forEach((q) => q.remove()); return norm(c.textContent); };
const sig = (el) => [plain(el), ...[...el.querySelectorAll('img')].map(imgSig)].join(' ').trim();
const leaves = (root) => [...root.querySelectorAll(LEAF)].filter((el) => !el.closest(SKIP) && !el.querySelector(LEAF) && (norm(el.textContent) || el.querySelector('img,.eq,.wordart')));

// Best in-order pairing of two sequences. score(i, j) > 0 means a and b may be paired.
// Returns [[i, j], ...] ascending, or null when the input is too large to align.
function align(na, nb, score) {
  if (!na || !nb) return [];
  if ((na + 1) * (nb + 1) > MAX_CELLS) return null;
  const w = nb + 1, dp = new Int32Array((na + 1) * w);
  for (let i = 1; i <= na; i++) {
    for (let j = 1; j <= nb; j++) {
      let best = Math.max(dp[(i - 1) * w + j], dp[i * w + j - 1]);
      const s = score(i - 1, j - 1);
      if (s > 0) best = Math.max(best, dp[(i - 1) * w + j - 1] + s);
      dp[i * w + j] = best;
    }
  }
  const out = [];
  let i = na, j = nb;
  while (i > 0 && j > 0) {
    const s = score(i - 1, j - 1), v = dp[i * w + j];
    if (s > 0 && v === dp[(i - 1) * w + j - 1] + s) { out.push([i - 1, j - 1]); i--; j--; } else if (v === dp[(i - 1) * w + j]) i--; else j--;
  }
  return out.reverse();
}

const words = (t) => new Set(t.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
function similar(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

// Pairs the leaves of two documents: equal text first, then edited ones inside the gaps.
function pairUp(a, b) {
  const ta = a.map(sig), tb = b.map(sig);
  let lo = 0;
  while (lo < ta.length && lo < tb.length && ta[lo] === tb[lo]) lo++;
  let ea = ta.length, eb = tb.length;
  while (ea > lo && eb > lo && ta[ea - 1] === tb[eb - 1]) { ea--; eb--; }
  const eq = [];
  for (let i = 0; i < lo; i++) eq.push([i, i]);
  const mid = align(ea - lo, eb - lo, (i, j) => (ta[lo + i] === tb[lo + j] ? 1 : 0));
  if (!mid) throw new Error('too big');
  for (const [i, j] of mid) eq.push([lo + i, lo + j]);
  for (let k = 0; ea + k < ta.length; k++) eq.push([ea + k, eb + k]);
  const ops = [];
  const gap = (i0, i1, j0, j1) => {
    let pairs = [];
    if (i1 > i0 && j1 > j0) {
      const sc = (i, j) => { const s = similar(ta[i0 + i], tb[j0 + j]); return s >= 0.4 ? Math.round(s * 1000) : 0; };
      pairs = align(i1 - i0, j1 - j0, sc) || [];
    }
    let i = i0, j = j0;
    for (const [pi, pj] of pairs) {
      while (i < i0 + pi) ops.push({ t: 'del', o: i++ });
      while (j < j0 + pj) ops.push({ t: 'ins', n: j++ });
      ops.push({ t: 'mod', o: i++, n: j++ });
    }
    while (i < i1) ops.push({ t: 'del', o: i++ });
    while (j < j1) ops.push({ t: 'ins', n: j++ });
  };
  let i = 0, j = 0;
  for (const [pi, pj] of eq) {
    gap(i, pi, j, pj);
    ops.push({ t: 'eq', o: pi, n: pj });
    i = pi + 1; j = pj + 1;
  }
  gap(i, ta.length, j, tb.length);
  return ops;
}

function mark(tag, time) {
  const el = document.createElement(tag);
  el.className = 'tc'; el.dataset.author = AUTHOR; el.dataset.time = String(time);
  return el;
}

// ---------- inline formatting ----------
// A word's look is the set of formatting that wraps it, between the word and its paragraph.
const FTAG = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', SUB: 'sub', SUP: 'sup', MARK: 'mark' };
const FNAME = { b: 'Bold', i: 'Italic', u: 'Underline', s: 'Strikethrough', sub: 'Subscript', sup: 'Superscript', mark: 'Highlight', color: 'Font colour', bg: 'Highlight', font: 'Font', size: 'Font size', link: 'Link' };
const scratch = document.createElement('span');
const css = (el, prop) => { const v = el.style && el.style.getPropertyValue(prop); if (!v) return ''; scratch.style.cssText = ''; scratch.style.setProperty(prop, v); return scratch.style.getPropertyValue(prop).toLowerCase(); };
function looks(node, root) {
  const set = new Set();
  for (let e = node.parentElement; e && e !== root; e = e.parentElement) {
    if (FTAG[e.tagName]) set.add(FTAG[e.tagName]);
    if (e.tagName === 'A' && e.hasAttribute('href')) set.add('link=' + e.getAttribute('href'));
    const w = css(e, 'font-weight'), fs = css(e, 'font-style'), td = css(e, 'text-decoration') + ' ' + css(e, 'text-decoration-line'), va = css(e, 'vertical-align');
    if (w === 'bold' || +w >= 600) set.add('b');
    if (fs === 'italic' || fs === 'oblique') set.add('i');
    if (/underline/.test(td)) set.add('u');
    if (/line-through/.test(td)) set.add('s');
    if (va === 'sub' || va === 'super') set.add(va === 'sub' ? 'sub' : 'sup');
    for (const [k, prop] of [['color', 'color'], ['bg', 'background-color'], ['font', 'font-family'], ['size', 'font-size']]) { const v = css(e, prop); if (v && !set.has(k)) set.add(k + '=' + v); }
  }
  return set;
}
const lookKey = (set) => [...set].sort().join('|');
const lookDiff = (x, y) => {
  const names = new Set();
  for (const t of [...x].filter((q) => !y.has(q)).concat([...y].filter((q) => !x.has(q)))) names.add(FNAME[t.split('=')[0]] || 'Formatting');
  return [...names].join(', ') || 'Formatting';
};

// The words of a paragraph, outside its objects, each with its text node, offsets and look.
function wordsOf(el) {
  const toks = [], seen = new Map();
  const walk = (n) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) { for (const m of c.textContent.matchAll(/\S+/g)) toks.push({ node: c, s: m.index, e: m.index + m[0].length, w: m[0] }); } else if (c.nodeType === 1 && !c.matches(OBJ)) walk(c);
    }
  };
  walk(el);
  for (const t of toks) {
    const p = t.node.parentElement;
    if (!seen.has(p)) { const l = looks(t.node, el); seen.set(p, [l, lookKey(l)]); }
    [t.look, t.key] = seen.get(p);
  }
  return toks;
}

// What a run of old words looked like, as HTML: their text inside copies of the formatting that wrapped them.
function wasHtml(src, run) {
  let n = document.createTextNode(run.map((t) => t.w).join(' '));
  for (let e = run[0].node.parentElement; e && e !== src; e = e.parentElement) { const c = e.cloneNode(false); c.append(n); n = c; }
  const d = document.createElement('div');
  d.append(n);
  return d.innerHTML;
}

// Word-level markup of one edited paragraph, done in place so its links and objects are kept.
// New words are wrapped as insertions where they sit; removed words appear as deletions in their place;
// words that stayed but changed look (bold, italic, colour and so on) are wrapped as a formatting change.
// Returns how many text marks and how many formatting marks were made.
function markText(el, src, time) {
  const toks = wordsOf(el), old = wordsOf(src);
  const pairs = align(old.length, toks.length, (i, j) => (old[i].w === toks[j].w ? 1 : 0)) || [];
  const ev = [];   // { node, s, e, del }: wrap [s,e) as inserted and put `del` before it; or { fc }: a formatting change
  let i = 0, j = 0, text = 0, fmt = 0, lastFc = null;
  for (const [pi, pj] of [...pairs, [old.length, toks.length]]) {
    const gone = old.slice(i, pi).map((t) => t.w).join(' '), add = toks.slice(j, pj);
    const last = pj >= toks.length;
    if (add.length) {
      let first = true;
      for (let k = 0; k < add.length;) {
        let q = k;
        while (q + 1 < add.length && add[q + 1].node === add[k].node) q++;
        ev.push({ node: add[k].node, s: add[k].s, e: add[q].e, del: first && gone ? (last ? ' ' + gone : gone + ' ') : '' });
        first = false; k = q + 1;
      }
      text++;
    } else if (gone) {
      if (toks.length && !last) ev.push({ node: toks[pj].node, s: toks[pj].s, e: toks[pj].s, del: gone + ' ' });
      else if (toks.length) ev.push({ node: toks[toks.length - 1].node, s: toks[toks.length - 1].e, e: toks[toks.length - 1].e, del: ' ' + gone });
      else ev.push({ node: null, del: gone });
      text++;
    }
    if (pi < old.length) {
      const o = old[pi], n = toks[pj];
      if (o.key !== n.key) {
        if (lastFc && lastFc.pi === pi - 1 && lastFc.pj === pj - 1 && lastFc.ev.node === n.node && lastFc.ev.key === o.key + '>' + n.key) {
          lastFc.ev.e = n.e; lastFc.ev.run.push(o); lastFc.pi = pi; lastFc.pj = pj;
        } else {
          const x = { node: n.node, s: n.s, e: n.e, fc: true, run: [o], label: lookDiff(o.look, n.look), key: o.key + '>' + n.key };
          ev.push(x); lastFc = { ev: x, pi, pj }; fmt++;
        }
      }
    }
    i = pi + 1; j = pj + 1;
  }
  const delEl = (t) => { const d = mark('del', time); d.textContent = t; return d; };
  for (const x of ev.reverse()) {                    // last first, so earlier offsets stay valid
    if (!x.node) { el.append(delEl(x.del)); continue; }
    let at = x.node;
    if (x.s > 0) at = x.node.splitText(x.s);
    if (x.fc) {
      if (x.e - x.s < at.length) at.splitText(x.e - x.s);
      let top = at;                                  // take in the formatting around the words when it holds nothing else
      while (top.parentElement && top.parentElement !== el && (FTAG[top.parentElement.tagName] || top.parentElement.tagName === 'SPAN' || top.parentElement.tagName === 'A') && !top.parentElement.matches('.fc,.cm,.tc') && norm(top.parentElement.textContent) === norm(at.textContent)) top = top.parentElement;
      const w = document.createElement('span');
      w.className = 'fc'; w.dataset.author = AUTHOR; w.dataset.time = String(time); w.dataset.label = x.label; w.dataset.was = wasHtml(src, x.run); w.dataset.lift = '1';
      top.replaceWith(w); w.append(top);
      continue;
    }
    if (x.e > x.s) {
      if (x.e - x.s < at.length) at.splitText(x.e - x.s);
      const w = mark('ins', time);
      at.replaceWith(w); w.append(at);
      if (x.del) w.before(delEl(x.del));
    } else if (x.s >= x.node.length && at === x.node) x.node.after(delEl(x.del));
    else at.before(delEl(x.del));
  }
  return { text, fmt };
}

// ---------- charts, shapes and SmartArt ----------
// Each is compared as a whole: same data and look means unchanged. A changed one is shown as the old object
// struck out beside the new one marked as inserted; added and removed ones are marked where they are (or were).
const OBJS = '.chart,.shape,.smartart,.eq,.textbox,.wordart';
const kindOf = (el) => (el.classList.contains('chart') ? 'chart' : el.classList.contains('smartart') ? 'smartart' : el.classList.contains('eq') ? 'eq' : el.classList.contains('textbox') ? 'textbox' : el.classList.contains('wordart') ? 'wordart' : 'shape');
const objSig = (el) => { const k = kindOf(el); return k + hash(k === 'chart' ? (el.dataset.chart || '') + el.style.width : k === 'smartart' ? el.dataset.sa || '' : k === 'eq' ? el.dataset.eq || norm(el.textContent) : k === 'textbox' ? el.className + '|' + (el.getAttribute('style') || '') + '|' + el.innerHTML : el.className + '|' + (el.getAttribute('style') || '') + '|' + norm(el.textContent)); };
const objectsOf = (root) => [...root.querySelectorAll(OBJS)].filter((e) => !e.parentElement.closest(OBJS + ',ins.tc,del.tc'));
function markObjects(A, B, time, st, home) {
  const a = objectsOf(A), b = objectsOf(B), n = a.length, m = b.length;
  if (!n && !m) return;
  const sa = a.map(objSig), sb = b.map(objSig);
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = sa[i] === sb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const gaps = [];
  let i = 0, j = 0, gi = 0, gj = 0;
  const close = (ei, ej) => { if (ei > gi || ej > gj) gaps.push({ o: a.slice(gi, ei), n: b.slice(gj, ej), anchor: b[ej] || null }); };
  while (i < n && j < m) {
    if (sa[i] === sb[j]) { close(i, j); i++; j++; gi = i; gj = j; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  close(n, m);
  const tail = new Map();
  const ghost = (src) => { const w = mark('del', time); w.append(src.cloneNode(true)); return w; };
  const wrap = (el) => { const w = mark('ins', time); el.replaceWith(w); w.append(el); return w; };
  for (const g of gaps) {
    const free = [...g.o], gone = [];
    for (const el of g.n) {
      const at = free.findIndex((o) => kindOf(o) === kindOf(el));
      const w = wrap(el);
      if (at >= 0) { w.before(ghost(free.splice(at, 1)[0])); st.edited++; } else st.added++;
    }
    for (const o of free) gone.push([o, ghost(o)]);
    for (const [o, w] of gone) {
      const h = home && home(o);       // a removed object goes back next to the paragraphs that kept their place
      if (h) {
        if (h.how === 'append') h.at.append(' ', w); else if (h.how === 'before') h.at.before(w); else { (tail.get(h.at) || h.at).after(w); tail.set(h.at, w); }
        st.removed++; continue;
      }
      if (g.anchor) g.anchor.before(w);
      else if (m) { const last = b[m - 1]; (last.parentElement.matches('ins.tc') ? last.parentElement : last).after(w); } else { const notes = B.querySelector(':scope > ol.footnotes,:scope > ol.endnotes'); if (notes) notes.before(w); else B.append(w); }
      st.removed++;
    }
  }
}

// ---------- comments ----------
// Comments are data on the text, not text, so they are not tracked changes. A comment that is new stays as it is,
// one whose text changed gets the old text added to it, and one that was removed comes back as a Compare comment
// on the same words, so nothing is lost. Returns how many comments differ.
const cmGroups = (root) => {
  const m = new Map();
  for (const sp of root.querySelectorAll('span.cm')) { const id = sp.dataset.cm || ''; if (!m.has(id)) m.set(id, []); m.get(id).push(sp); }
  return [...m.values()].map((spans) => ({ spans, id: spans[0].dataset.cm || '', quote: norm(spans.map((x) => x.textContent).join('')), text: spans[0].dataset.text || '', author: spans[0].dataset.author || '' }));
};
function anchorComment(host, quote, make) {
  const nodes = [];
  const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { if (c.data.trim()) nodes.push(c); } else if (c.nodeType === 1 && !c.matches('del.tc,span.cm') && !c.matches(OBJ)) walk(c); } };
  walk(host);
  const first = quote.split(' ')[0];
  for (const q of [quote, first, '']) {
    for (const n of nodes) {
      let i = q ? n.data.indexOf(q) : n.data.search(/\S/), len = q ? q.length : (n.data.match(/\S+/) || [''])[0].length;
      if (i < 0 || !len) continue;
      let at = i > 0 ? n.splitText(i) : n;
      if (len < at.length) at.splitText(len);
      const sp = make();
      at.replaceWith(sp); sp.append(at);
      return true;
    }
  }
  return false;
}
function markComments(A, B, time, hostOf) {
  const a = cmGroups(A), b = cmGroups(B), used = new Set(), pair = new Map();
  for (const by of [(x, g) => x.id && x.id === g.id, (x, g) => x.quote === g.quote]) {
    for (const g of b) {
      if (pair.has(g)) continue;
      const m = a.find((x) => !used.has(x) && by(x, g));
      if (m) { used.add(m); pair.set(g, m); }
    }
  }
  let n = 0;
  for (const g of b) {
    const m = pair.get(g);
    if (!m) { n++; continue; }
    if (m.text !== g.text) { g.spans[0].dataset.text = `${g.text}\n(Compare: this comment was “${m.text}”)`; n++; }
  }
  let k = 0;
  for (const m of a) {
    if (used.has(m)) continue;
    const host = hostOf(m.spans[0]);
    if (!host) continue;
    const made = anchorComment(host, m.quote, () => {
      const sp = document.createElement('span');
      sp.className = 'cm';
      Object.assign(sp.dataset, { cm: 'cmp' + time.toString(36) + (k++), author: AUTHOR, time: String(time), text: `Deleted comment by ${m.author || 'Unknown'}: ${m.text}` });
      return sp;
    });
    if (made) n++;
  }
  return n;
}

const topOf = (root, el) => { let t = el; while (t.parentElement && t.parentElement !== root) t = t.parentElement; return t; };

// Returns the new document's HTML with every difference from oldHtml marked as a tracked change.
export function diffHtml(oldHtml, newHtml) {
  const A = parse(oldHtml), B = parse(newHtml), time = Date.now();
  const a = leaves(A), b = leaves(B);
  const ops = pairUp(a, b);
  const st = { added: 0, removed: 0, edited: 0, formatted: 0, comments: 0, unmarked: 0 };
  const byOld = new Map(), aIdx = new Map(a.map((e, i) => [e, i]));
  ops.forEach((o) => { if (o.o !== undefined) byOld.set(o.o, o); });
  const delContent = (src) => { const w = mark('del', time); w.textContent = norm(src.textContent); src.querySelectorAll('img').forEach((i) => w.append(i.cloneNode(true))); return w; };
  // Pictures that are new in el get an insertion mark, pictures that were in src and are gone are shown as deleted.
  const markImages = (src, el) => {
    const was = new Map(), now = new Map();
    for (const i of src.querySelectorAll('img')) was.set(imgSig(i), (was.get(imgSig(i)) || 0) + 1);
    for (const i of el.querySelectorAll('img')) now.set(imgSig(i), (now.get(imgSig(i)) || 0) + 1);
    let n = 0;
    for (const i of [...el.querySelectorAll('img')]) {
      const g = imgSig(i);
      if (was.get(g) > 0) { was.set(g, was.get(g) - 1); continue; }
      const w = mark('ins', time); i.replaceWith(w); w.append(i); n++;
    }
    for (const i of src.querySelectorAll('img')) {
      const g = imgSig(i);
      if (now.get(g) > 0) { now.set(g, now.get(g) - 1); continue; }
      const w = mark('del', time); w.append(i.cloneNode(true)); el.append(w); n++;
    }
    return n;
  };
  const rowLeaves = new Map();
  a.forEach((e, i) => { const tr = e.closest('tr'); if (tr) { if (!rowLeaves.has(tr)) rowLeaves.set(tr, []); rowLeaves.get(tr).push(i); } });
  const ghostAfter = new Map(), doneRows = new Set();
  const near = (k, dir) => { for (let q = k + dir; q >= 0 && q < ops.length; q += dir) if (ops[q].o !== undefined && ops[q].n !== undefined) return ops[q]; return null; };
  // A removed table cell: shown inside the same cell of the surviving row, or, when the whole row is gone, as a struck-out row.
  const delInTable = (src, k) => {
    const cell = src.closest('td,th'), tr = src.closest('tr');
    if (!cell || !tr) return false;
    const kept = (rowLeaves.get(tr) || []).map((i) => byOld.get(i)).find((o) => o && o.n !== undefined);
    if (kept) {
      const row = b[kept.n].closest('tr'), at = [...tr.children].indexOf(cell);
      const target = row.children[at] || row.lastElementChild;
      if (!target) return false;
      if (target.textContent.trim()) target.append(' ');
      target.append(delContent(src));
      return true;
    }
    if (doneRows.has(tr)) return true;
    const table = tr.closest('table'), ok = (o) => o && a[o.o].closest('table') === table && b[o.n].closest('tr');
    const prev = near(k, -1), next = near(k, 1);
    const g = document.createElement('tr');
    for (const c of tr.children) {
      const t = document.createElement(c.tagName.toLowerCase());
      for (const at of ['colspan', 'rowspan']) if (c.hasAttribute(at)) t.setAttribute(at, c.getAttribute(at));
      const w = delContent(c);
      if (w.textContent || w.querySelector('img')) t.append(w);
      g.append(t);
    }
    if (ok(prev)) { const anchor = b[prev.n].closest('tr'); (ghostAfter.get(anchor) || anchor).after(g); ghostAfter.set(anchor, g); } else if (ok(next)) b[next.n].closest('tr').before(g); else return false;
    doneRows.add(tr);
    return true;
  };
  const mappedA = (l) => { const i = aIdx.get(l), op = i === undefined ? null : byOld.get(i); return op && op.n !== undefined ? b[op.n] : null; };
  // A note that was added: its reference in the text is marked as inserted too.
  const refOf = (root, li) => { const id = li.dataset.fn, cls = li.closest('ol.endnotes') ? 'en-ref' : 'fn-ref'; return id ? [...root.querySelectorAll('sup.' + cls)].find((r) => r.dataset.fn === id && !r.closest('ol')) : null; };
  // A note that was removed: its reference comes back as a deleted mark at the end of the paragraph it was in, and the note
  // itself as a deleted entry in the list, so rejecting the deletion restores both. A note whose paragraph is gone is not shown.
  const ghostNote = (src) => {
    const ref = refOf(A, src), host = ref && ref.closest(LEAF), at = host && mappedA(host);
    if (!at) return false;
    const cls = src.closest('ol.endnotes') ? 'endnotes' : 'footnotes';
    const id = B.querySelector(`[data-fn="${CSS.escape(src.dataset.fn)}"]`) ? src.dataset.fn + 'x' : src.dataset.fn;
    const rc = ref.cloneNode(true); rc.dataset.fn = id;
    const g = mark('del', time); g.append(rc); at.append(g);
    let list = B.querySelector('ol.' + cls);
    if (!list) { list = document.createElement('ol'); list.className = cls; const en = B.querySelector(':scope > ol.endnotes'); if (cls === 'footnotes' && en) en.before(list); else B.append(list); }
    const li = document.createElement('li'); li.dataset.fn = id; li.append(delContent(src)); list.append(li);
    return true;
  };
  ops.forEach((op, k) => {
    if (op.t === 'eq') { if (markText(b[op.n], a[op.o], time).fmt) st.formatted++; return; }
    if (op.t === 'mod') {
      const el = b[op.n], src = a[op.o];
      const m = markText(el, src, time), pics = markImages(src, el);
      if (m.text || pics) st.edited++; else if (m.fmt) st.formatted++; else st.unmarked++;
    } else if (op.t === 'ins') {
      const w = mark('ins', time);
      w.append(...b[op.n].childNodes);
      b[op.n].append(w);
      if (b[op.n].closest(NOTELIST)) { const ref = refOf(B, b[op.n]); if (ref) { const x = mark('ins', time); ref.replaceWith(x); x.append(ref); } }
      st.added++;
    } else {
      const src = a[op.o];
      if (src.closest(NOTELIST)) { if (ghostNote(src)) st.removed++; return; }
      if (src.closest('td,th')) { if (delInTable(src, k)) st.removed++; else st.unmarked++; return; }
      const next = ops.slice(k + 1).find((o) => o.n !== undefined);
      let anchor = next ? b[next.n] : null;
      if (anchor && anchor.closest(NOTELIST)) anchor = topOf(B, anchor);   // a removed paragraph goes before the notes, not among them
      const asLi = src.tagName === 'LI' && anchor && anchor.tagName === 'LI';
      const el = document.createElement(src.tagName === 'LI' && !asLi ? 'p' : src.tagName.toLowerCase());
      if (src.className && !asLi) el.className = src.className;
      el.append(delContent(src));
      if (anchor) (asLi ? anchor : topOf(B, anchor)).before(el);
      else { const notes = B.querySelector(':scope > ol.footnotes,:scope > ol.endnotes'); if (notes) notes.before(el); else B.append(el); }
      st.removed++;
    }
  });
  st.comments = markComments(A, B, time, (sp) => { const l = sp.closest(LEAF); return l ? mappedA(l) : null; });
  markObjects(A, B, time, st, (o) => {
    const mapped = mappedA;
    const lf = o.closest(LEAF);
    if (lf) { const at = mapped(lf); return at ? { at, how: 'append' } : null; }
    const top = topOf(A, o), leavesIn = (s) => (s.matches(LEAF) ? [s] : [...s.querySelectorAll(LEAF)]);
    for (let s = top.previousElementSibling; s; s = s.previousElementSibling) {
      const at = leavesIn(s).reverse().map(mapped).find(Boolean);
      if (at) return { at: topOf(B, at), how: 'after' };
    }
    for (let s = top.nextElementSibling; s; s = s.nextElementSibling) {
      const at = leavesIn(s).map(mapped).find(Boolean);
      if (at) return { at: topOf(B, at), how: 'before' };
    }
    return null;
  });
  return { html: B.innerHTML, stats: st, changes: st.added + st.removed + st.edited + st.formatted + st.comments };
}

const when = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function compare() {
  api.toggleBackstage(false);
  await api.flush();
  let versions = [];
  try { versions = await versionsOf(api.doc.id); } catch { /* storage blocked: files only */ }
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg';
  dlg.innerHTML = `<form method="dialog"><h2>Compare documents</h2><p class="dlg-note">Compares this document with an earlier version or another file and opens the result as a new document. Every difference is a tracked change you can accept or reject. This document is not changed.</p>
    <label class="field"><span>Earlier version of this document</span><select id="cp-ver">${versions.length ? versions.map((v) => `<option value="${api.esc(v.vid)}">${api.esc(v.name || (v.auto ? 'Auto-saved' : 'Saved'))} · ${api.esc(when(v.ts))}</option>`).join('') : '<option value="">No saved versions yet</option>'}</select></label>
    <label class="field"><span>Or compare with a file (.docx, .html, .txt, .md)</span><input type="file" id="cp-file" accept=".docx,.html,.htm,.txt,.md"></label>
    <div class="dlg-actions"><span class="spacer"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Compare</button></div></form>`;
  document.body.append(dlg);
  const pick = await new Promise((res) => {
    let out = null;
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!e.submitter || e.submitter.value === 'ok') out = { file: dlg.querySelector('#cp-file').files[0], vid: dlg.querySelector('#cp-ver').value };
      dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); res(out); });
    dlg.showModal();
  });
  if (!pick) return;
  let other, label;
  try {
    if (pick.file) { const f = await api.fileToHtml(pick.file); other = f.html; label = pick.file.name; } else {
      const v = versions.find((x) => x.vid === pick.vid);
      if (!v) { api.toast('Choose a version or a file to compare with.'); return; }
      other = v.html; label = (v.name || 'version') + ' ' + when(v.ts);
    }
  } catch { api.toast('Sorry, that file could not be read.'); return; }
  let res;
  try { res = diffHtml(other, api.editor.innerHTML); } catch { api.toast('These documents are too large to compare.'); return; }
  if (!res.changes && !res.stats.unmarked) { api.toast('No differences found.'); return; }
  const d = api.doc;
  await api.createDoc(`Comparison: ${d.title || 'Untitled'}`, res.html, { page: d.page, theme: d.theme, hf: d.hf, styles: d.styles, themeCustom: d.themeCustom, x: d.x });
  const s = res.stats;
  api.toast(`Compared with ${label}: ${s.added} added, ${s.removed} removed, ${s.edited} edited${s.formatted ? `, ${s.formatted} reformatted` : ''}${s.comments ? `, ${s.comments} ${s.comments === 1 ? 'comment' : 'comments'} different` : ''}${s.unmarked ? `; ${s.unmarked} changes in tables or pictures are not marked` : ''}.`);
}

export function init(a) {
  api = a;
  api.cmd('compare', compare);
}
