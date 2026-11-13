// Accessibility checker: looks for things that make a document hard to read with a screen reader or low vision,
// lists them in a side pane, jumps to each one, and fixes the simple ones (alt text) in place.
let api, pane, issues = [];

// ---------- colour maths (WCAG 2.x) ----------
function rgba(s) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(s || '');
  if (!m) return null;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [+m[1], +m[2], +m[3], a];
}
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function backdrop(el, root) {            // what the text sits on: the nearest opaque background, else the page
  for (let n = el; n && n !== root.parentNode; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const c = rgba(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0.95) return c;
  }
  const pg = root.closest && root.closest('.page');
  const c = pg && rgba(getComputedStyle(pg).backgroundColor);
  if (c && c[3] > 0.95) return c;
  const hex = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());   // the sheet colour
  return hex ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) : [255, 255, 255, 1];
}

const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const VAGUE = /^(click here|here|this|link|this link|read more|more|learn more|click|go|see|see here|page)$/i;

// Pure check over a root element. Each issue: { sev: 'error'|'warn'|'tip', rule, msg, el, fix? }.
export function check(root) {
  const out = [];
  const add = (sev, rule, msg, el, fix) => out.push({ sev, rule, msg, el, fix });

  // Pictures need a description.
  for (const img of root.querySelectorAll('img')) {
    if (img.closest('.smartart,.wordart')) continue;
    const alt = (img.getAttribute('alt') || '').trim();
    if (!alt) add('error', 'alt', 'Picture has no alt text', img, 'alt');
    else if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(alt) || /^(img|image|dsc|screenshot)[-_ ]?\d*$/i.test(alt)) add('warn', 'alt', `Alt text “${clip(alt, 30)}” looks like a file name`, img, 'alt');
  }
  // Charts need a title, which Word keeps as the description.
  for (const fig of root.querySelectorAll('figure.chart')) {
    let cfg = null; try { cfg = JSON.parse(fig.dataset.chart || ''); } catch { /* not a chart */ }
    if (cfg && !(cfg.title || '').trim()) add('warn', 'chart', 'Chart has no title', fig);
  }

  // Headings: a first heading, no skipped levels, none empty.
  const heads = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => !h.closest('.toc,.footnotes,.endnotes'));
  const hasTitle = !!root.querySelector('.doc-title');
  if (!heads.length && text(root).length > 1500) add('warn', 'heading', 'Long document with no headings, so a screen reader user cannot jump between sections', root.firstElementChild || root);
  let prev = hasTitle ? 1 : 0;
  for (const h of heads) {
    const lvl = +h.tagName[1];
    if (!text(h)) { add('warn', 'heading', 'Empty heading', h); continue; }
    if (prev && lvl > prev + 1) add('warn', 'heading', `Heading skips from level ${prev} to ${lvl}: “${clip(text(h), 30)}”`, h);
    prev = lvl;
  }
  if (heads.length && !hasTitle && !root.querySelector('h1')) add('tip', 'heading', 'No Title or Heading 1, so the document has no top-level heading', heads[0]);

  // Tables: a header row, no merged cells, not empty.
  for (const t of root.querySelectorAll('table')) {
    const rows = t.rows.length;
    if (rows > 1 && !t.querySelector('th') && !t.classList.contains('rep-head')) add('warn', 'table', 'Table has no header row (use Repeat header rows on the Table tab)', t);
    if (t.querySelector('td[colspan],td[rowspan],th[colspan],th[rowspan]')) add('tip', 'table', 'Table has merged cells, which screen readers can lose track of', t);
  }

  // Links: meaningful text.
  for (const a of root.querySelectorAll('a[href]')) {
    const t = text(a);
    if (!t) add('error', 'link', 'Link has no text', a);
    else if (VAGUE.test(t)) add('warn', 'link', `Link text “${t}” says nothing about where it goes`, a);
    else if (/^(https?:\/\/|www\.)\S{50,}$/i.test(t)) add('tip', 'link', 'Link text is a very long web address; a short description reads better', a);
  }

  // Contrast and size, for text with its own colour, highlight or size.
  const seen = new Set();
  for (const el of root.querySelectorAll('[style*="color"],[style*="font-size"],mark')) {
    if (el.closest('figure,.shape,.wordart,.smartart,.toc')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el), fg = rgba(cs.color);
    if (!fg) continue;
    const bg = backdrop(el, root), px = parseFloat(cs.fontSize) || 16;
    const large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    const need = large ? 3 : 4.5;
    const blend = fg[3] < 1 ? fg.map((v, i) => (i < 3 ? v * fg[3] + bg[i] * (1 - fg[3]) : 1)) : fg;
    const r = contrast(blend, bg);
    if (r < need) add(r < 2 ? 'error' : 'warn', 'contrast', `Low contrast (${r.toFixed(1)}:1, needs ${need}:1): “${clip(own, 32)}”`, el);
    if (px < 11 && !el.closest('sup,sub')) add('tip', 'size', `Very small text (${Math.round(px * 0.75)} pt): “${clip(own, 32)}”`, el);
  }

  // Blank paragraphs used as spacing.
  let run = 0, first = null;
  for (const p of root.querySelectorAll('p')) {
    if (!text(p) && !p.querySelector('img,figure,table,.eq,.page-break')) { if (!run++) first = p; if (run === 3) add('tip', 'blank', 'Several empty paragraphs in a row; use paragraph spacing instead', first); } else run = 0;
  }
  return out;
}

// ---------- pane ----------
const RULE = { alt: 'Pictures', chart: 'Charts', heading: 'Headings', table: 'Tables', link: 'Links', contrast: 'Colour', size: 'Text size', blank: 'Spacing' };
const SEV = { error: 'Fix', warn: 'Check', tip: 'Tip' };

function build() {
  pane = document.createElement('section');
  pane.id = 'access-pane'; pane.hidden = true;
  pane.innerHTML = `<div class="pane-head"><h2>Accessibility</h2><button class="rb" data-cmd="closeSide" data-icon="x" aria-label="Close">${api.ic('x')}</button></div>
    <div class="acc-bar"><span id="acc-sum" role="status"></span><button class="btn sm" id="acc-run" type="button">Check again</button></div>
    <div id="acc-out" class="acc-out"></div>`;
  api.$('#side-pane').append(pane);
  api.$('#acc-run', pane).addEventListener('click', run);
  api.$('#acc-out', pane).addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    const it = issues[+li.dataset.i];
    if (!it || !it.el.isConnected) { run(); return; }
    const save = e.target.closest('button[data-save]');
    if (save) {
      const v = api.$('input', li).value.trim();
      if (!v) { api.toast('Type a short description of the picture first.'); return; }
      api.commit();
      it.el.setAttribute('alt', v);
      api.done();
      run();
      return;
    }
    if (e.target.closest('input')) return;
    it.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    it.el.classList.add('acc-flash');
    setTimeout(() => it.el.classList.remove('acc-flash'), 1600);
    if (it.fix === 'alt') api.$('input', li).focus();
  });
}

function run() {
  issues = check(api.editor);
  const out = api.$('#acc-out', pane), sum = api.$('#acc-sum', pane);
  const n = (s) => issues.filter((i) => i.sev === s).length;
  if (!issues.length) {
    sum.textContent = 'No problems found';
    out.innerHTML = '<p class="thes-empty">Nothing to fix. This checks alt text, headings, tables, links, colour contrast and spacing. It cannot judge whether your wording is clear.</p>';
    return;
  }
  sum.textContent = `${n('error')} to fix, ${n('warn')} to check, ${n('tip')} ${n('tip') === 1 ? 'tip' : 'tips'}`;
  out.innerHTML = '<ul class="acc-list">' + issues.map((it, i) => `<li data-i="${i}" class="acc-${it.sev}" tabindex="0">
      <span class="acc-tag">${SEV[it.sev]}</span><span class="acc-rule">${RULE[it.rule]}</span>
      <div class="acc-msg">${api.esc(it.msg)}</div>
      ${it.fix === 'alt' ? '<div class="acc-fix"><input type="text" placeholder="Describe the picture" aria-label="Alt text"><button class="btn sm" data-save type="button">Set</button></div>' : ''}</li>`).join('') + '</ul>';
  out.querySelectorAll('li').forEach((li) => li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) li.click(); }));
}

export function init(a) {
  api = a;
  build();
  api.cmd('accessibility', () => { api.showSide('access'); run(); });
}
