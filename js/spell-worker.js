/* Spell-check worker: Hunspell dictionaries via Typo.js, off the main thread. */
importScripts('../vendor/typo.js');

let typo = null;
let lang = null;

async function load(code) {
  const base = '../vendor/dict/' + code;
  const [aff, dic] = await Promise.all([
    fetch(base + '.aff').then((r) => { if (!r.ok) throw new Error('aff ' + r.status); return r.text(); }),
    fetch(base + '.dic').then((r) => { if (!r.ok) throw new Error('dic ' + r.status); return r.text(); }),
  ]);
  typo = new Typo(code, aff, dic);
  lang = code;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      typo = null;
      await load(m.lang);
      self.postMessage({ type: 'ready', lang });
    } else if (m.type === 'check') {
      const bad = [];
      if (typo) for (const w of m.words) if (!typo.check(w)) bad.push(w);
      self.postMessage({ type: 'checked', id: m.id, lang, words: m.words, bad, ready: !!typo });
    } else if (m.type === 'suggest') {
      const list = typo ? typo.suggest(m.word, 5) : [];
      self.postMessage({ type: 'suggested', id: m.id, word: m.word, list });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
