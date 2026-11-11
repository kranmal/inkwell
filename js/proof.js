// Proofing coordinator: spelling (worker + Hunspell) and grammar (local rules),
// painted with the CSS Custom Highlight API so the document DOM is never touched.
import { blocksOf, toRange } from './textmap.js';
import { checkGrammar } from './grammar.js';

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
const DICT_KEY = 'inkwell.dict';

const P = {
  editor: null, onUpdate: () => {}, enabled: true, lang: 'en_US', ready: false, failed: false,
  worker: null, cache: new Map(), suggCache: new Map(), pending: new Map(), seq: 0, runId: 0, timer: null,
  ignoredWords: new Set(), ignoredOnce: new Set(), userDict: new Set(), issues: [], words: 0,
};

function loadDict() {
  try { P.userDict = new Set(JSON.parse(localStorage.getItem(DICT_KEY) || '[]')); } catch { P.userDict = new Set(); }
}
function saveDict() {
  try { localStorage.setItem(DICT_KEY, JSON.stringify([...P.userDict])); } catch { /* private mode */ }
}

function ask(msg) {
  return new Promise((resolve) => {
    const id = ++P.seq;
    P.pending.set(id, resolve);
    P.worker.postMessage({ ...msg, id });
  });
}

function startWorker() {
  try {
    P.worker = new Worker(new URL('./spell-worker.js', import.meta.url));
  } catch { P.failed = true; return; }
  P.worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { if (m.lang === P.lang) { P.ready = true; P.failed = false; schedule(0); } return; }
    if (m.type === 'error' && !m.id) { P.failed = true; schedule(0); return; }
    const done = P.pending.get(m.id);
    if (done) { P.pending.delete(m.id); done(m); }
  };
  P.worker.onerror = () => { P.failed = true; schedule(0); };
  P.worker.postMessage({ type: 'load', lang: P.lang });
}

export function init({ editor, onUpdate, lang, enabled }) {
  P.editor = editor; P.onUpdate = onUpdate; P.lang = lang; P.enabled = enabled;
  loadDict();
  startWorker();
  schedule(0);
}

export function setLang(lang) {
  if (lang === P.lang) return;
  P.lang = lang; P.ready = false; P.cache.clear(); P.suggCache.clear();
  if (P.worker) P.worker.postMessage({ type: 'load', lang });
  schedule(0);
}
export function setEnabled(on) { P.enabled = on; schedule(0); }
export function schedule(delay = 450) { clearTimeout(P.timer); P.timer = setTimeout(run, delay); }
export function clearMarks() { if (canHighlight) for (const k of ['spell', 'grammar', 'style']) CSS.highlights.delete(k); }
export const state = () => ({ issues: P.issues, ready: P.ready, failed: P.failed, enabled: P.enabled, words: P.words, canHighlight });

const skipWord = (w) => w.length < 2 || /\p{N}/u.test(w) || w === w.toUpperCase() || /\p{Ll}\p{Lu}/u.test(w);
const norm = (w) => w.replace(/’/g, "'");
const onceKey = (b, s, e) => `${b.text.slice(Math.max(0, s - 12), s)}|${b.text.slice(s, e)}|${b.text.slice(e, e + 12)}`;

function snippet(text, s, e) {
  const a = Math.max(0, s - 28), z = Math.min(text.length, e + 28);
  const clean = (t) => t.replace(/\s+/g, ' ');
  return { pre: (a > 0 ? '…' : '') + clean(text.slice(a, s)), hit: text.slice(s, e), post: clean(text.slice(e, z)) + (z < text.length ? '…' : '') };
}

async function run() {
  const myRun = ++P.runId;
  if (!P.editor) return;
  if (!P.enabled) { P.issues = []; clearMarks(); P.onUpdate(state()); return; }

  const blocks = blocksOf(P.editor, { skipCode: true });
  const found = [];
  const unknown = new Set();
  let words = 0;

  for (const b of blocks) {
    b.words = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(b.text))) {
      words++;
      const raw = m[0];
      if (skipWord(raw)) continue;
      const tokenStart = b.text.lastIndexOf(' ', m.index) + 1;
      const tokenEnd = (() => { const i = b.text.indexOf(' ', m.index); return i < 0 ? b.text.length : i; })();
      if (/[@/\\]|www\.|\.\w{2,4}\b.*\w/.test(b.text.slice(tokenStart, tokenEnd)) && /[@/]|www\.|\.(com|org|net|io|uk)/.test(b.text.slice(tokenStart, tokenEnd))) continue;
      const w = norm(raw);
      b.words.push({ w, s: m.index, e: m.index + raw.length });
      if (!P.cache.has(w)) unknown.add(w);
    }
  }
  P.words = words;

  if (P.ready && unknown.size) {
    const res = await ask({ type: 'check', words: [...unknown] });
    if (myRun !== P.runId) return;
    if (res.lang === P.lang && res.ready) {
      const bad = new Set(res.bad);
      for (const w of res.words) P.cache.set(w, !bad.has(w));
    }
  }

  for (const b of blocks) {
    const gram = checkGrammar(b.text).filter((g) => !P.ignoredOnce.has(onceKey(b, g.s, g.e)) && !P.ignoredWords.has('rule:' + g.rule));
    for (const g of gram) {
      found.push({ type: g.type, rule: g.rule, msg: g.msg, sugg: g.sugg, text: b.text.slice(g.s, g.e), block: b, s: g.s, e: g.e });
    }
    for (const t of b.words) {
      if (P.cache.get(t.w) !== false) continue;
      const lw = t.w.toLowerCase();
      if (P.userDict.has(lw) || P.ignoredWords.has(lw) || P.ignoredOnce.has(onceKey(b, t.s, t.e))) continue;
      if (gram.some((g) => t.s < g.e && t.e > g.s)) continue;   // grammar rule already explains it
      found.push({ type: 'spell', msg: 'Not in the dictionary', sugg: null, text: t.w, block: b, s: t.s, e: t.e });
    }
  }

  const sets = { spell: [], grammar: [], style: [] };
  let n = 0;
  for (const f of found) {
    try { f.range = toRange(f.block, f.s, f.e); } catch { continue; }
    f.id = ++n;
    f.key = onceKey(f.block, f.s, f.e);
    f.ctx = snippet(f.block.text, f.s, f.e);
    sets[f.type].push(f.range);
    delete f.block;
  }
  P.issues = found.filter((f) => f.range);
  if (canHighlight) {
    for (const k of Object.keys(sets)) {
      if (sets[k].length) CSS.highlights.set(k, new Highlight(...sets[k])); else CSS.highlights.delete(k);
    }
  }
  P.onUpdate(state());
}

export async function suggestionsFor(issue) {
  if (issue.sugg) return issue.sugg;
  if (!P.ready) return [];
  if (P.suggCache.has(issue.text)) return P.suggCache.get(issue.text);
  const res = await ask({ type: 'suggest', word: issue.text });
  const list = (res.list || []).filter((w) => w && w !== issue.text);
  P.suggCache.set(issue.text, list);
  return list;
}

export function ignoreOnce(issue) { P.ignoredOnce.add(issue.key); schedule(0); }
export function ignoreAll(issue) { P.ignoredWords.add(issue.type === 'spell' ? issue.text.toLowerCase() : 'rule:' + issue.rule); schedule(0); }
export function addToDictionary(issue) { P.userDict.add(issue.text.toLowerCase()); saveDict(); schedule(0); }

export function issueAt(x, y) {
  let node, offset;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    node = p.offsetNode; offset = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer; offset = r.startOffset;
  } else return null;
  for (const it of P.issues) {
    try { if (it.range.isPointInRange(node, offset)) return it; } catch { /* stale range */ }
  }
  return null;
}

export function score() {
  const c = { spell: 0, grammar: 0, style: 0 };
  for (const i of P.issues) c[i.type]++;
  const penalty = ((c.spell * 4 + c.grammar * 3 + c.style) / Math.max(P.words, 60)) * 100;
  return { ...c, total: P.issues.length, value: Math.max(0, Math.min(100, Math.round(100 - penalty))) };
}
