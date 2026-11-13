// Compare documents: show what changed between this document and an earlier version or another file.
// The result opens as a new document with every difference as a tracked change, so it can be
// accepted, rejected and exported like any other.
import { versionsOf } from './docs.js';

let api;
const LEAF = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,td,th';
const SKIP = '.toc,.index,.biblio,.chart,.shape,.eq,.smartart,.textbox,.wordart,.page-break,.sect-break,.rep-head,ol.footnotes,ol.endnotes';
const OBJ = '.fn-ref,.en-ref,.cap-num,.xref,.cite,.eq,.mfield,.tf,.idx,.wordart,.smartart,.shape,.chart,img,svg';
const MAX_CELLS = 20e6;
const AUTHOR = 'Compare';

const norm = (t) => t.replace(/\s+/g, ' ').trim();
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parse(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('.pg-part,.pgs-part').forEach((w) => w.replaceWith(...w.childNodes));
  d.querySelectorAll('del.tc').forEach((x) => x.remove()); // compare as if existing changes were accepted
  d.querySelectorAll('ins.tc').forEach((x) => x.replaceWith(...x.childNodes));
  return d;
}
const leaves = (root) => [...root.querySelectorAll(LEAF)].filter((el) => !el.closest(SKIP) && !el.querySelector(LEAF) && norm(el.textContent));

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
  const ta = a.map((e) => norm(e.textContent)), tb = b.map((e) => norm(e.textContent));
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

// Word-level markup of one edited paragraph.
function wordDiff(oldText, newText, time) {
  const a = oldText.split(/(\s+)/).filter(Boolean), b = newText.split(/(\s+)/).filter(Boolean);
  const pairs = align(a.length, b.length, (i, j) => (a[i] === b[j] ? 1 : 0)) || [];
  const out = [];
  const run = (tag, toks) => {
    if (!toks.length) return;
    const el = mark(tag, time); el.textContent = toks.join('');
    out.push(el.outerHTML);
  };
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length]]) {
    run('del', a.slice(i, pi)); run('ins', b.slice(j, pj));
    if (pi < a.length) out.push(esc(a[pi]));
    i = pi + 1; j = pj + 1;
  }
  return out.join('');
}

const topOf = (root, el) => { let t = el; while (t.parentElement && t.parentElement !== root) t = t.parentElement; return t; };

// Returns the new document's HTML with every difference from oldHtml marked as a tracked change.
export function diffHtml(oldHtml, newHtml) {
  const A = parse(oldHtml), B = parse(newHtml), time = Date.now();
  const a = leaves(A), b = leaves(B);
  const ops = pairUp(a, b);
  const st = { added: 0, removed: 0, edited: 0, unmarked: 0 };
  ops.forEach((op, k) => {
    if (op.t === 'eq') return;
    if (op.t === 'mod') {
      const el = b[op.n];
      if (el.querySelector(OBJ)) { st.unmarked++; return; }
      el.innerHTML = wordDiff(norm(a[op.o].textContent), norm(el.textContent), time);
      st.edited++;
    } else if (op.t === 'ins') {
      const w = mark('ins', time);
      w.append(...b[op.n].childNodes);
      b[op.n].append(w);
      st.added++;
    } else {
      const src = a[op.o];
      if (/^(TD|TH)$/.test(src.tagName)) { st.unmarked++; return; }
      const next = ops.slice(k + 1).find((o) => o.n !== undefined);
      const anchor = next ? b[next.n] : null;
      const asLi = src.tagName === 'LI' && anchor && anchor.tagName === 'LI';
      const el = document.createElement(src.tagName === 'LI' && !asLi ? 'p' : src.tagName.toLowerCase());
      if (src.className && !asLi) el.className = src.className;
      const w = mark('del', time); w.textContent = norm(src.textContent);
      el.append(w);
      if (anchor) (asLi ? anchor : topOf(B, anchor)).before(el);
      else { const notes = B.querySelector(':scope > ol.footnotes,:scope > ol.endnotes'); if (notes) notes.before(el); else B.append(el); }
      st.removed++;
    }
  });
  return { html: B.innerHTML, stats: st, changes: st.added + st.removed + st.edited };
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
  api.toast(`Compared with ${label}: ${s.added} added, ${s.removed} removed, ${s.edited} edited${s.unmarked ? `; ${s.unmarked} changes in tables, pictures or notes are not marked` : ''}.`);
}

export function init(a) {
  api = a;
  api.cmd('compare', compare);
}
