// Thesaurus, dictation, translation and macros.
import { lookup, size as thesSize } from './thesaurus-data.js';

let api;
const $ = (s, r = document) => r.querySelector(s);
const insertText = (t) => document.execCommand('insertText', false, t);
const inEd = () => { const s = getSelection(); return s.rangeCount && api.inEditor(s.anchorNode); };

// ---------- thesaurus ----------
let thesRange = null, thesPane;
function matchCase(orig, w) {
  if (orig && orig === orig.toUpperCase() && orig.length > 1) return w.toUpperCase();
  if (orig && orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase()) return w[0].toUpperCase() + w.slice(1);
  return w;
}
function buildThes() {
  thesPane = document.createElement('section');
  thesPane.id = 'thes-pane'; thesPane.hidden = true;
  thesPane.innerHTML = `<div class="pane-head"><h2>Thesaurus</h2><button class="rb" data-cmd="closeSide" data-icon="x" aria-label="Close">${api.ic('x')}</button></div>
    <div class="find-form"><label class="field"><span>Look up a word</span><input id="thes-q" type="text" autocomplete="off" spellcheck="false"></label></div>
    <div id="thes-out" class="thes-out"></div>`;
  $('#side-pane').append(thesPane);
  $('#thes-q', thesPane).addEventListener('input', (e) => showThes(e.target.value, false));
  $('#thes-q', thesPane).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  $('#thes-out', thesPane).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-w]');
    if (!b) return;
    if (!thesRange) { api.toast('Select a word in the document to replace it.'); return; }
    api.restore();
    const s = getSelection(); s.removeAllRanges(); s.addRange(thesRange);
    api.editor.focus();
    insertText(matchCase(thesRange.toString(), b.dataset.w));
    thesRange = null;
    $('#thes-out', thesPane).innerHTML = '<p class="thes-empty">Replaced.</p>';
  });
}
function showThes(raw, fromDoc) {
  const out = $('#thes-out', thesPane);
  const q = (raw || '').trim();
  if (!q) { out.innerHTML = '<p class="thes-empty">Select a word and press Thesaurus, or type one above.</p>'; return; }
  const r = lookup(q);
  if (!r) { out.innerHTML = `<p class="thes-empty">No synonyms for “${api.esc(q)}” in the built-in list (${thesSize} words). Try the base form, such as “run” instead of “running”.</p>`; return; }
  out.innerHTML = `<h3>${api.esc(r.word)}</h3><div class="thes-list">${r.list.map((w) => `<button class="thes-w" type="button" data-w="${api.esc(w)}">${api.esc(w)}</button>`).join('')}</div>${fromDoc ? '<p class="thes-hint">Click a word to replace your selection.</p>' : ''}`;
}
function thesaurus() {
  let word = '';
  thesRange = null;
  if (inEd()) {
    const s = getSelection();
    if (s.isCollapsed && s.modify) { s.modify('move', 'backward', 'word'); s.modify('extend', 'forward', 'word'); }
    word = s.toString().replace(/[^\p{L}'-]/gu, '');
    if (word) thesRange = s.getRangeAt(0).cloneRange();
  }
  api.showSide('thes');
  $('#thes-q', thesPane).value = word;
  showThes(word, !!thesRange);
  if (!word) $('#thes-q', thesPane).focus();
}

// ---------- dictation ----------
let rec = null;
function dictate() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { api.toast('Dictation isn’t supported in this browser. Chrome, Edge and Safari have it.'); return; }
  if (rec) { rec.stop(); return; }
  api.restore();
  api.editor.focus();
  const r = new SR();
  r.lang = api.prefs.lang || navigator.language || 'en-GB';
  r.continuous = true; r.interimResults = false;
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      let t = e.results[i][0].transcript.trim();
      if (!t) continue;
      t = t.replace(/\b(full stop|period)\b\s*/gi, '. ').replace(/\bcomma\b\s*/gi, ', ').replace(/\bquestion mark\b\s*/gi, '? ').replace(/\bnew paragraph\b\s*/gi, '\n').replace(/\s+([.,?])/g, '$1');
      api.editor.focus();
      for (const [n, part] of t.split('\n').entries()) { if (n) document.execCommand('insertParagraph'); if (part) insertText(part.replace(/^([a-z])/, (m) => m) + ' '); }
    }
  };
  r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') api.toast('Microphone access was blocked. Allow it in the address bar and try again.'); else if (e.error !== 'no-speech' && e.error !== 'aborted') api.toast('Dictation stopped: ' + e.error); };
  r.onend = () => { rec = null; mark('dictate', false); };
  try { r.start(); rec = r; mark('dictate', true); api.toast('Listening. Say “full stop”, “comma” or “new paragraph” for punctuation. Press Dictate again to stop.'); }
  catch { api.toast('Couldn’t start the microphone.'); }
}
const mark = (cmd, on) => document.querySelectorAll(`[data-cmd="${cmd}"]`).forEach((b) => b.classList.toggle('on', on));

// ---------- translation ----------
const LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['sv', 'Swedish'], ['da', 'Danish'], ['fi', 'Finnish'], ['no', 'Norwegian'], ['cs', 'Czech'], ['el', 'Greek'], ['he', 'Hebrew'], ['uk', 'Ukrainian']];
const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption,.caption';
async function translate() {
  if (!('Translator' in self)) {
    api.toast('Translation needs a browser with built-in translation, such as recent desktop Chrome. Inkwell never sends your text to a server.');
    return;
  }
  const s = getSelection();
  const sel = inEd() && !s.isCollapsed ? s.toString() : '';
  const from = (api.prefs.lang || 'en').slice(0, 2);
  const v = await api.ask('Translate', [
    { id: 'from', label: 'From', type: 'select', options: LANGS, value: LANGS.some((l) => l[0] === from) ? from : 'en' },
    { id: 'to', label: 'To', type: 'select', options: LANGS, value: from === 'es' ? 'en' : 'es' },
  ], { ok: sel ? 'Translate selection' : 'Translate document', note: sel ? 'Replaces the selected text.' : 'Makes a translated copy as a new document. Bold, links and other formatting inside a paragraph are not carried across; headings, lists and tables are kept.' });
  if (!v) return;
  if (v.from === v.to) { api.toast('Pick two different languages.'); return; }
  let tr;
  try {
    const av = await Translator.availability({ sourceLanguage: v.from, targetLanguage: v.to });
    if (av === 'unavailable') { api.toast('This browser can’t translate that language pair.'); return; }
    if (av !== 'available') api.toast('Downloading the language pack. This happens once.');
    tr = await Translator.create({ sourceLanguage: v.from, targetLanguage: v.to });
  } catch (e) { api.toast('Translation couldn’t start: ' + (e.message || e.name)); return; }
  if (sel) {
    const range = s.getRangeAt(0).cloneRange();
    const out = await tr.translate(sel);
    api.restore(); const g = getSelection(); g.removeAllRanges(); g.addRange(range); api.editor.focus();
    insertText(out);
    api.toast('Translated.');
    return;
  }
  const copy = api.editor.cloneNode(true);
  copy.querySelectorAll('.toc,.index,.biblio,ol.footnotes,ol.endnotes,.chart,.shape,.eq,.smartart,svg,img').forEach((n) => { if (n.matches('.toc,.index,.biblio')) n.innerHTML = ''; });
  const targets = [...copy.querySelectorAll(BLOCKS)].filter((b) => !b.querySelector(BLOCKS) && b.textContent.trim() && !b.closest('.toc,.index,.biblio,.eq,.shape,.chart'));
  api.toast(`Translating ${targets.length} paragraphs…`);
  let n = 0;
  for (const b of targets) {
    try { b.textContent = await tr.translate(b.textContent); } catch { /* leave this one as is */ }
    n++;
  }
  const d = api.doc;
  await api.createDoc(`${d.title} (${v.to})`, copy.innerHTML, { page: JSON.parse(JSON.stringify(d.page)), theme: d.theme, hf: d.hf && JSON.parse(JSON.stringify(d.hf)), styles: d.styles && JSON.parse(JSON.stringify(d.styles)), themeCustom: d.themeCustom && JSON.parse(JSON.stringify(d.themeCustom)) });
  api.prefs.lang = v.to; api.savePrefs();
  api.toast(`Translated ${n} paragraphs into a new document.`);
}

// ---------- macros ----------
const REC_OK = new Set(['bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'fontName', 'fontSize', 'grow', 'shrink', 'color', 'hilite', 'clear', 'ul', 'ol', 'indent', 'outdent', 'align', 'lineHeight', 'space', 'style', 'case', 'hr', 'date', 'symbol', 'pageBreak', 'imgAlign', 'tableFormula', 'rowAbove', 'rowBelow', 'colLeft', 'colRight', 'delRow', 'delCol']);
let recording = null, replaying = false;
const macros = () => (api.prefs.macros = Array.isArray(api.prefs.macros) ? api.prefs.macros : []);
function onRan(cmd, val) {
  if (!recording || replaying) return;
  if (REC_OK.has(cmd)) recording.steps.push({ c: cmd, v: val === undefined ? null : val });
}
function onInput(e) {
  if (!recording || replaying) return;
  const last = recording.steps[recording.steps.length - 1];
  if (e.inputType === 'insertText' && e.data) {
    if (last && last.t !== undefined) last.t += e.data; else recording.steps.push({ t: e.data });
  } else if (e.inputType === 'insertParagraph') recording.steps.push({ k: 'p' });
  else if (e.inputType === 'deleteContentBackward') { if (last && last.t) last.t = last.t.slice(0, -1) || ''; else recording.steps.push({ k: 'bs' }); }
}
async function macroRecord() {
  if (recording) {
    const r = recording; recording = null; mark('macroRecord', false);
    r.steps = r.steps.filter((s) => s.t !== '');
    if (!r.steps.length) { api.toast('Nothing was recorded.'); return; }
    const v = await api.ask('Save macro', [{ id: 'n', label: 'Name', value: `Macro ${macros().length + 1}` }], { ok: 'Save', note: `${r.steps.length} steps recorded.` });
    if (!v || !v.n.trim()) { api.toast('Macro discarded.'); return; }
    const list = macros().filter((m) => m.name !== v.n.trim());
    list.push({ name: v.n.trim(), steps: r.steps });
    api.prefs.macros = list; api.savePrefs();
    api.toast(`Saved “${v.n.trim()}”.`);
    return;
  }
  recording = { steps: [] }; mark('macroRecord', true);
  api.toast('Recording. Type and format as normal, then press Record macro again to stop. Only typing and formatting are recorded.');
}
async function macroRun() {
  const list = macros();
  if (!list.length) { api.toast('No macros yet. Use Record macro first.'); return; }
  const v = await api.ask('Run macro', [{ id: 'n', label: 'Macro', type: 'select', options: list.map((m) => m.name) }, { id: 'times', label: 'Times to run', type: 'number', value: 1 }], { ok: 'Run' });
  if (!v) return;
  const m = list.find((x) => x.name === v.n);
  if (!m) return;
  const times = Math.max(1, Math.min(200, parseInt(v.times, 10) || 1));
  api.restore(); api.editor.focus();
  replaying = true;
  try {
    for (let i = 0; i < times; i++) {
      for (const s of m.steps) {
        api.editor.focus();
        if (s.c) api.run(s.c, s.v, null);
        else if (s.t) insertText(s.t);
        else if (s.k === 'p') document.execCommand('insertParagraph');
        else if (s.k === 'bs') document.execCommand('delete');
      }
    }
  } finally { replaying = false; }
  api.toast(`Ran “${m.name}”${times > 1 ? ` ${times} times` : ''}.`);
}
async function macroDelete() {
  const list = macros();
  if (!list.length) { api.toast('No macros to delete.'); return; }
  const v = await api.ask('Delete macro', [{ id: 'n', label: 'Macro', type: 'select', options: list.map((m) => m.name) }], { ok: 'Delete' });
  if (!v) return;
  api.prefs.macros = list.filter((m) => m.name !== v.n); api.savePrefs();
  api.toast(`Deleted “${v.n}”.`);
}

export function init(a) {
  api = a;
  buildThes();
  api.cmd('thesaurus', thesaurus);
  api.cmd('dictate', dictate);
  api.cmd('translate', translate);
  api.cmd('macroRecord', macroRecord);
  api.cmd('macroRun', macroRun);
  api.cmd('macroDelete', macroDelete);
  api.on('ran', onRan);
  api.editor.addEventListener('beforeinput', onInput);
  window.addEventListener('beforeunload', () => { if (rec) rec.abort(); });
}
