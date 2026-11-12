// Templates, version history, document protection and mail merge.
import { loadScript } from './docx.js';
let api;
const X = () => api.doc.x;
const lock = (el) => { if (el.getAttribute('contenteditable') !== 'false') el.setAttribute('contenteditable', 'false'); };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- templates ----------
const T = (id, name, note, html) => ({ id, name, note, html });
const TEMPLATES = [
  T('letter', 'Letter', 'A formal letter with sender, date and sign-off', `<p>Your name<br>Street address<br>Town, Postcode</p><p><br></p><p>12 November 2026</p><p><br></p><p>Recipient name<br>Company<br>Street address<br>Town, Postcode</p><p><br></p><p>Dear Recipient,</p><p>Start with the purpose of your letter in a sentence or two. Keep paragraphs short and say what you want the reader to do.</p><p>Add the detail they need in the next paragraph, then close with a clear next step.</p><p>Yours sincerely,</p><p><br></p><p>Your name</p>`),
  T('resume', 'Résumé', 'One page: summary, experience, education, skills', `<p class="doc-title">Your Name</p><p class="doc-subtitle">you@example.com · 07000 000000 · Town</p><h2>Summary</h2><p>Two sentences on what you do best and the kind of role you want.</p><h2>Experience</h2><h3>Job title, Company</h3><p><i>2022 to now</i></p><ul><li>Something you achieved, with a number if you have one.</li><li>A responsibility that shows range.</li></ul><h3>Earlier job title, Company</h3><p><i>2019 to 2022</i></p><ul><li>Another achievement.</li></ul><h2>Education</h2><p><b>Degree, University</b>, 2019</p><h2>Skills</h2><p>Skill one · Skill two · Skill three · Skill four</p>`),
  T('report', 'Report', 'Title, contents, headings and a place for figures', `<p class="doc-title">Report title</p><p class="doc-subtitle">Prepared by Your Name · 12 November 2026</p><div class="toc" contenteditable="false"></div><h1>Summary</h1><p>Give the reader the answer first: what you found and what you recommend.</p><h1>Background</h1><p>Explain why the work was done and what question it set out to answer.</p><h1>Findings</h1><h2>First finding</h2><p>Describe the evidence. Use Insert, Chart for numbers and References, Caption for labels.</p><h2>Second finding</h2><p>Describe the evidence.</p><h1>Recommendations</h1><ol><li>The first thing to do.</li><li>The second thing to do.</li></ol>`),
  T('meeting', 'Meeting notes', 'Agenda, decisions and actions', `<p class="doc-title">Meeting notes</p><p><b>Date:</b> 12 November 2026<br><b>Attendees:</b> Names<br><b>Apologies:</b> Names</p><h2>Agenda</h2><ol><li>Topic one</li><li>Topic two</li></ol><h2>Discussion</h2><p>Key points raised, in the order they came up.</p><h2>Decisions</h2><ul><li>What was agreed.</li></ul><h2>Actions</h2><table class="tb-horizontal"><tbody><tr><th>Action</th><th>Owner</th><th>Due</th></tr><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table>`),
  T('invoice', 'Invoice', 'Line items with totals that add themselves up', `<p class="doc-title">Invoice</p><p><b>From:</b> Your company, address<br><b>To:</b> Customer name, address<br><b>Invoice no:</b> 001 · <b>Date:</b> 12 November 2026</p><table class="rep-head"><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody><tr><td>Item or service</td><td>2</td><td>50.00</td><td><span class="tf" data-f="=B2*C2" data-dp="2" contenteditable="false">100.00</span></td></tr><tr><td>Another item</td><td>1</td><td>80.00</td><td><span class="tf" data-f="=B3*C3" data-dp="2" contenteditable="false">80.00</span></td></tr><tr><td>Another item</td><td>3</td><td>20.00</td><td><span class="tf" data-f="=B4*C4" data-dp="2" contenteditable="false">60.00</span></td></tr><tr><td colspan="3"><b>Total</b></td><td><span class="tf" data-f="=SUM(ABOVE)" data-dp="2" contenteditable="false">240.00</span></td></tr></tbody></table><p><br></p><p>Payment due within 14 days. Bank details: sort code, account number.</p>`),
  T('plan', 'Project plan', 'Goals, timeline, risks', `<p class="doc-title">Project plan</p><p class="doc-subtitle">Owner · Version 1</p><h2>Goal</h2><p>One sentence on what success looks like.</p><h2>Timeline</h2><table class="rep-head"><thead><tr><th>Phase</th><th>Start</th><th>End</th><th>Owner</th></tr></thead><tbody><tr><td>Plan</td><td><br></td><td><br></td><td><br></td></tr><tr><td>Build</td><td><br></td><td><br></td><td><br></td></tr><tr><td>Launch</td><td><br></td><td><br></td><td><br></td></tr></tbody></table><h2>Risks</h2><ul><li>Risk, how likely it is and what you will do about it.</li></ul>`),
];
let tplDlg;
function buildTemplates() {
  tplDlg = document.createElement('dialog');
  tplDlg.className = 'dlg wide';
  tplDlg.innerHTML = `<form method="dialog"><h2>Start from a template</h2><div class="tpl-grid">${TEMPLATES.map((t) => `<button type="button" class="tpl" data-id="${t.id}"><span class="tpl-name">${t.name}</span><span class="tpl-note">${t.note}</span></button>`).join('')}</div><div class="dlg-actions"><span class="spacer"></span><button class="btn" value="cancel">Close</button></div></form>`;
  document.body.append(tplDlg);
  tplDlg.querySelector('.tpl-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.tpl');
    const t = b && TEMPLATES.find((x) => x.id === b.dataset.id);
    if (!t) return;
    tplDlg.close();
    api.createDoc(t.name, t.html);
  });
}

// ---------- version history ----------
const vdb = () => new Promise((res, rej) => {
  const r = indexedDB.open('inkwell-versions', 1);
  r.onupgradeneeded = () => { const s = r.result.createObjectStore('v', { keyPath: 'vid' }); s.createIndex('doc', 'docId'); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => { const db = await vdb(); return new Promise((res, rej) => { const t = db.transaction('v', mode); const out = fn(t.objectStore('v')); t.oncomplete = () => { db.close(); res(out && out.result); }; t.onerror = () => { db.close(); rej(t.error); }; }); };
const listV = (docId) => tx('readonly', (s) => s.index('doc').getAll(docId)).then((a) => (a || []).sort((x, y) => y.ts - x.ts));
const putV = (v) => tx('readwrite', (s) => s.put(v));
const delV = (vid) => tx('readwrite', (s) => s.delete(vid));
const wordsOf = (html) => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent.match(/\S+/g) || []).length; };
const MAX_VERSIONS = 20;

async function snapshot(rec, name, auto) {
  const list = await listV(rec.id);
  if (list[0] && list[0].html === rec.html && !name) return null;
  const ts = Date.now();
  const v = { vid: `${rec.id}:${ts}:${Math.random().toString(36).slice(2, 6)}`, docId: rec.id, ts, name: name || '', auto: !!auto, title: rec.title, html: rec.html, words: wordsOf(rec.html),
    page: rec.page, theme: rec.theme, hf: rec.hf || null, styles: rec.styles || null, themeCustom: rec.themeCustom || null, x: rec.x || {} };
  await putV(v);
  const all = [v, ...list];
  while (all.length > MAX_VERSIONS) {
    const victim = [...all].reverse().find((o) => !o.name) || all[all.length - 1];
    await delV(victim.vid);
    all.splice(all.indexOf(victim), 1);
  }
  return v;
}
let lastAuto = {};
async function onSaved(rec) {
  try {
    if (lastAuto[rec.id] === undefined) { const l = await listV(rec.id); lastAuto[rec.id] = l.length ? l[0].ts : rec.created || Date.now(); }
    if (Date.now() - lastAuto[rec.id] < 10 * 60 * 1000) return;
    lastAuto[rec.id] = Date.now();
    await snapshot(rec, '', true);
  } catch { /* history is best effort */ }
}
const fmtTime = (ts) => {
  const d = new Date(ts), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return (same ? 'Today' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
let verDlg;
function buildVersions() {
  verDlg = document.createElement('dialog');
  verDlg.className = 'dlg wide';
  verDlg.innerHTML = `<form method="dialog"><h2>Version history</h2><p class="dlg-note">Inkwell keeps a snapshot at most every 10 minutes while you work, plus any you save yourself. The latest ${MAX_VERSIONS} are kept in this browser only.</p><div class="ver-list" id="ver-list"></div><div class="dlg-actions"><button class="btn" type="button" id="ver-save">Save a version now</button><span class="spacer"></span><button class="btn" value="cancel">Close</button></div></form>`;
  document.body.append(verDlg);
  verDlg.querySelector('#ver-save').addEventListener('click', async () => {
    const v = await api.ask('Save a version', [{ id: 'n', label: 'Name (optional)', placeholder: 'e.g. Before sending to Sam' }], { ok: 'Save' });
    if (!v) return;
    await api.flush();
    const rec = { ...api.doc, html: api.editor.innerHTML };
    await snapshot(rec, v.n.trim() || 'Saved version', false);
    lastAuto[rec.id] = Date.now();
    api.toast('Version saved.');
    renderVersions();
  });
  verDlg.querySelector('#ver-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const list = await listV(api.doc.id);
    const v = list.find((x) => x.vid === b.dataset.v);
    if (!v) return;
    const keep = { page: v.page, theme: v.theme, hf: v.hf, styles: v.styles, themeCustom: v.themeCustom, x: v.x };
    if (b.dataset.a === 'del') { await delV(v.vid); renderVersions(); return; }
    if (b.dataset.a === 'copy') { verDlg.close(); await api.createDoc(`${v.title} (${fmtTime(v.ts)})`, v.html, keep); return; }
    if (b.dataset.a === 'restore') {
      await api.flush();
      await snapshot({ ...api.doc, html: api.editor.innerHTML }, 'Before restoring', false);
      verDlg.close();
      const d = api.doc;
      api.setDoc({ ...d, ...keep, title: d.title }, v.html);
      await api.save();
      api.toast('Restored. The version you replaced is in the history.');
    }
  });
}
async function renderVersions() {
  const box = verDlg.querySelector('#ver-list');
  let list = [];
  try { list = await listV(api.doc.id); } catch { box.innerHTML = '<p class="ver-empty">History isn’t available because browser storage is blocked.</p>'; return; }
  box.innerHTML = list.length ? list.map((v) => `<div class="ver"><div class="ver-main"><b>${api.esc(v.name || (v.auto ? 'Auto-saved' : 'Saved'))}</b><span>${fmtTime(v.ts)} · ${v.words} word${v.words === 1 ? '' : 's'}</span></div><button class="btn sm" type="button" data-a="restore" data-v="${api.esc(v.vid)}">Restore</button><button class="btn sm" type="button" data-a="copy" data-v="${api.esc(v.vid)}">Open as copy</button><button class="btn sm" type="button" data-a="del" data-v="${api.esc(v.vid)}" aria-label="Delete this version">Delete</button></div>`).join('')
    : '<p class="ver-empty">No versions yet. Keep writing and one appears every 10 minutes, or save one yourself.</p>';
}
async function openVersions() {
  await api.flush();
  api.toggleBackstage(false);
  await renderVersions();
  verDlg.showModal();
}

// ---------- protection ----------
const ALLOWED = new Set(['find', 'findNext', 'findPrev', 'closeSide', 'proofPane', 'wordCount', 'readAloud', 'navPane', 'focus', 'dark', 'zoomIn', 'zoomOut', 'zoom', 'zoomFit', 'print', 'backstage', 'new', 'open', 'save', 'saveAs', 'saveDocx', 'saveHtml', 'saveTxt', 'templates', 'versions', 'protect', 'saveVersion', 'mmPrev', 'mmNext', 'mmPreview', 'mmFinish', 'mmPrint', 'thesaurus', 'closeThes']);
const protectedNow = () => !!(api.doc && X().protect && X().protect.on);
const sha = async (pw, salt) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw)))].map((b) => b.toString(16).padStart(2, '0')).join('');
let bar;
function applyProtect() {
  const on = protectedNow();
  api.editor.contentEditable = on ? 'false' : 'true';
  document.body.classList.toggle('protected', on);
  bar.hidden = !on;
  if (on) bar.querySelector('span').textContent = X().protect.hash ? 'This document is protected. Reading and printing are fine; editing needs the password.' : 'This document is protected against accidental edits.';
}
async function protect() {
  const p = X().protect;
  if (p && p.on) {
    if (p.hash) {
      const v = await api.ask('Stop protection', [{ id: 'pw', label: 'Password', type: 'password' }], { ok: 'Unprotect' });
      if (!v) return;
      if ((await sha(v.pw, p.salt)) !== p.hash) { api.toast('That password isn’t right.'); return; }
    }
    delete X().protect;
    applyProtect(); api.changed(); api.toast('Protection removed. You can edit again.');
    return;
  }
  const v = await api.ask('Protect document', [
    { id: 'pw', label: 'Password (optional)', type: 'password' },
    { id: 'pw2', label: 'Type it again', type: 'password' },
  ], { ok: 'Protect', note: 'This stops edits in Inkwell and is meant to prevent accidents. It is not encryption: the file’s contents can still be read, and someone with technical know-how can bypass it.' });
  if (!v) return;
  if (v.pw !== v.pw2) { api.toast('The two passwords don’t match.'); return; }
  const salt = crypto.getRandomValues(new Uint8Array(8)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '');
  X().protect = { on: true, salt, hash: v.pw ? await sha(v.pw, salt) : '' };
  applyProtect(); api.changed();
  api.toast(v.pw ? 'Protected. Keep the password somewhere safe; it can’t be recovered.' : 'Protected against accidental edits.');
}

// ---------- mail merge ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const delim = (text.split('\n')[0].match(/\t/g) || []).length ? '\t' : (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
// Accepts CSV/TSV text or a JSON array of objects; returns rows (first row = field names).
function tableFrom(text) {
  const t = text.trim();
  if (/^[\[{]/.test(t)) {
    try {
      let data = JSON.parse(t);
      if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray) || [data];
      const cols = [...new Set(data.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))];
      if (cols.length) return [cols, ...data.map((o) => cols.map((c) => (o && o[c] != null ? String(o[c]) : '')))];
    } catch { /* fall through to CSV */ }
  }
  return parseCsv(text);
}
// Reads the first sheet of an .xlsx: shared strings, inline strings and numbers.
async function xlsxRows(buf) {
  const JSZip = await loadScript('vendor/jszip.min.js', 'JSZip');
  const zip = await JSZip.loadAsync(buf);
  const xml = async (n) => { const f = zip.file(n); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const shared = [];
  const sst = await xml('xl/sharedStrings.xml');
  if (sst) for (const si of sst.getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  const wb = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels');
  let path = 'xl/worksheets/sheet1.xml';
  if (wb && rels) {
    const sh = wb.getElementsByTagName('sheet')[0];
    const rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
    if (rel) path = 'xl/' + rel.getAttribute('Target').replace(/^\/?(xl\/)?/, '');
  }
  const sheet = await xml(path);
  if (!sheet) throw new Error('No sheet');
  const col = (ref) => ref.replace(/\d+/g, '').split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  for (const r of sheet.getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
      let val = '';
      if (t === 's' && v) val = shared[Number(v.textContent)] || '';
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
      else if (v) val = v.textContent;
      row[col(c.getAttribute('r') || 'A1')] = val;
    }
    rows.push(Array.from(row, (x) => x || ''));
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
function setRecipients(rows) {
  if (rows.length < 2 || !rows[0].every((c) => String(c).trim())) { api.toast('Needs a header row with names, then at least one recipient.'); return false; }
  const cols = rows[0].map((c) => String(c).trim());
  X().merge = { cols, rows: rows.slice(1).map((r) => cols.map((_, i) => String(r[i] || '').trim())), i: 0, on: false };
  syncMerge(); api.changed();
  api.toast(`${X().merge.rows.length} recipients loaded.`);
  return true;
}
function mergeFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,.tsv,.txt,.json,.xlsx';
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      setRecipients(ext === 'xlsx' ? await xlsxRows(await f.arrayBuffer()) : tableFrom(await f.text()));
    } catch (err) { console.error(err); api.toast('Sorry, that file could not be read.'); }
  });
  inp.click();
}
const M = () => X().merge || null;
async function recipients() {
  const m = M();
  const sample = 'Name,Company,City\nAda Lovelace,Analytical Engines,London\nGrace Hopper,Navy,Arlington';
  const v = await api.ask('Mail merge recipients', [
    { id: 'csv', label: 'Paste your list. The first row holds the field names.', type: 'textarea', rows: 8, value: m ? [m.cols, ...m.rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') : sample },
  ], { ok: 'Use this list', wide: true, note: 'Copy from Excel or Sheets and paste, or type comma-separated lines. Stored with this document only.' });
  if (!v) return;
  setRecipients(tableFrom(v.csv));
}
async function insertField() {
  const m = M();
  if (!m) { await recipients(); if (!M()) return; }
  api.restore();
  const s = getSelection();
  if (!s.rangeCount || !api.inEditor(s.anchorNode)) { api.toast('Put the cursor where the field should go first.'); return; }
  const range = s.getRangeAt(0).cloneRange();
  const v = await api.ask('Insert merge field', [{ id: 'f', label: 'Field', type: 'select', options: M().cols }], { ok: 'Insert' });
  if (!v) return;
  api.commit();
  const f = document.createElement('span');
  f.className = 'mfield'; f.dataset.field = v.f; f.setAttribute('contenteditable', 'false'); f.textContent = `«${v.f}»`;
  range.collapse(false); range.insertNode(f);
  range.setStartAfter(f); range.collapse(true); s.removeAllRanges(); s.addRange(range);
  syncMerge();
  api.done();
}
function syncMerge() {
  const m = M();
  for (const f of api.editor.querySelectorAll('span.mfield')) {
    lock(f);
    const k = m ? m.cols.indexOf(f.dataset.field) : -1;
    const t = m && m.on && k >= 0 ? (m.rows[m.i] || [])[k] || '' : `«${f.dataset.field}»`;
    if (f.textContent !== t) f.textContent = t;
    f.classList.toggle('mf-live', !!(m && m.on));
  }
  const c = document.getElementById('mm-count');
  if (c) c.textContent = m ? (m.on ? `Record ${m.i + 1} of ${m.rows.length}` : `${m.rows.length} recipients`) : 'No recipients';
  const pv = document.querySelector('[data-cmd="mmPreview"]');
  if (pv) pv.classList.toggle('on', !!(m && m.on));
}
function mmStep(d) {
  const m = M();
  if (!m) { api.toast('Choose recipients first.'); return; }
  m.on = true; m.i = (m.i + d + m.rows.length) % m.rows.length;
  syncMerge();
}
function mmPreview() {
  const m = M();
  if (!m) { api.toast('Choose recipients first.'); return; }
  m.on = !m.on; syncMerge();
}
async function mmFinish(print) {
  const m = M();
  if (!m) { api.toast('Choose recipients first.'); return; }
  if (!api.editor.querySelector('span.mfield')) { api.toast('Insert at least one merge field first.'); return; }
  if (m.rows.length > 300) { api.toast('That’s a lot of letters. Merge in batches of up to 300.'); return; }
  const parts = m.rows.map((r) => {
    const d = api.editor.cloneNode(true);
    d.querySelectorAll('span.mfield').forEach((f) => { f.replaceWith(document.createTextNode(r[m.cols.indexOf(f.dataset.field)] || '')); });
    d.querySelectorAll('ol.footnotes,ol.endnotes').forEach((n) => n.remove());
    return d.innerHTML;
  });
  const d = api.doc;
  await api.createDoc(`${d.title} (merged)`, parts.join('<div class="page-break" contenteditable="false"></div>'), { page: clone(d.page), theme: d.theme, hf: d.hf && clone(d.hf), styles: d.styles && clone(d.styles), themeCustom: d.themeCustom && clone(d.themeCustom) });
  api.toast(`Created ${m.rows.length} merged pages.`);
  if (print) setTimeout(() => window.print(), 600);
}

export function init(a) {
  api = a;
  buildTemplates(); buildVersions();
  bar = document.createElement('div');
  bar.className = 'protect-bar'; bar.hidden = true;
  bar.innerHTML = `<span></span><button class="btn sm" type="button" data-cmd="protect">Stop protection</button>`;
  api.canvas.prepend(bar);

  api.cmd('templates', () => { api.toggleBackstage(false); tplDlg.showModal(); });
  api.cmd('versions', openVersions);
  api.cmd('protect', protect);
  api.cmd('mmRecipients', recipients);
  api.cmd('mmFile', mergeFile);
  api.cmd('mmField', insertField);
  api.cmd('mmPreview', mmPreview);
  api.cmd('mmPrev', () => mmStep(-1));
  api.cmd('mmNext', () => mmStep(1));
  api.cmd('mmFinish', () => mmFinish(false));
  api.cmd('mmPrint', () => mmFinish(true));

  api.on('guard', (cmd) => {
    if (!protectedNow() || ALLOWED.has(cmd)) return false;
    api.toast('This document is protected. Choose “Stop protection” to edit.');
    return true;
  });
  api.on('saved', onSaved);
  api.on('load', () => { applyProtect(); syncMerge(); });
  api.on('meta', syncMerge);
  api.on('refresh', () => { const b = document.querySelector('.bs-item[data-cmd="protect"] small'); if (b) b.textContent = protectedNow() ? 'On' : 'Off'; });
  api.on('backstage', () => { const b = document.querySelector('.bs-item[data-cmd="protect"] small'); if (b) b.textContent = protectedNow() ? 'On' : 'Off'; });
}
