// Custom styles (modify the built-in ones, add your own) and custom theme fonts/colour.
let api;
let cur = 'normal';

export const BUILTIN = {
  normal: ['Normal', '.doc.doc p:not([class]), .doc.doc li', '.doc.doc p:not([class])'],
  title: ['Title', '.doc.doc .doc-title'],
  subtitle: ['Subtitle', '.doc.doc .doc-subtitle'],
  h1: ['Heading 1', '.doc.doc h1'],
  h2: ['Heading 2', '.doc.doc h2'],
  h3: ['Heading 3', '.doc.doc h3'],
  quote: ['Quote', '.doc.doc .quote'],
};
const uid = () => Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);
const fam = (f) => `"${String(f).replace(/["\\;{}<>]/g, '')}", sans-serif`;
const okColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '');
const num = (v) => { const n = parseFloat(v); return isFinite(n) && n >= 0 && n <= 200 ? n : null; };

const state = () => {
  const s = (api && api.doc && api.doc.styles) || {};
  return { overrides: s.overrides || {}, custom: Array.isArray(s.custom) ? s.custom : [] };
};
function write(fn) {
  const s = state();
  fn(s);
  for (const k of Object.keys(s.overrides)) if (!Object.keys(s.overrides[k] || {}).length) delete s.overrides[k];
  api.doc.styles = Object.keys(s.overrides).length || s.custom.length ? s : null;
}

function decl(p, spacing = true) {
  let out = '';
  if (p.font) out += `font-family:${fam(p.font)};`;
  if (num(p.size)) out += `font-size:${num(p.size)}pt;`;
  if (okColor(p.color)) out += `color:${p.color};`;
  if (p.bold === 'bold' || p.bold === 'normal') out += `font-weight:${p.bold === 'bold' ? 700 : 400};`;
  if (p.italic === 'italic' || p.italic === 'normal') out += `font-style:${p.italic};`;
  if (['left', 'center', 'right', 'justify'].includes(p.align)) out += `text-align:${p.align};`;
  if (spacing && num(p.before) !== null && p.before !== '' && p.before != null) out += `margin-top:${num(p.before)}pt;`;
  if (spacing && num(p.after) !== null && p.after !== '' && p.after != null) out += `margin-bottom:${num(p.after)}pt;`;
  return out;
}
export function css() {
  if (!api || !api.doc) return '';
  const s = state();
  let out = '';
  for (const [k, [, sel, spSel]] of Object.entries(BUILTIN)) {
    const p = s.overrides[k];
    if (!p) continue;
    if (spSel) {
      const a = decl(p, false), b = decl({ before: p.before, after: p.after });
      if (a) out += `${sel}{${a}}`;
      if (b) out += `${spSel}{${b}}`;
    } else { const d = decl(p); if (d) out += `${sel}{${d}}`; }
  }
  for (const c of s.custom) { const d = decl(c.props || {}); out += `.doc.doc .cs-${c.id}{${d}}`; }
  return out;
}
function themeVars() {
  const t = (api && api.doc && api.doc.themeCustom) || {};
  const v = {};
  if (t.font) v['--doc-font'] = fam(t.font);
  if (t.head) v['--head-font'] = fam(t.head);
  if (okColor(t.accent)) { v['--doc-accent'] = t.accent; v['--head-color'] = t.accent; }
  return v;
}
export const rootStyle = () => Object.entries(themeVars()).map(([k, v]) => `${k}:${v}`).join(';');

function toHex(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) return m[1].length === 3 ? '#' + [...m[1]].map((ch) => ch + ch).join('') : c.trim().toLowerCase();
  const r = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  return r ? '#' + [r[1], r[2], r[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#0f766e';
}

export function apply() {
  if (!api || !api.doc) return;
  const { editor, $, STYLES } = api;
  let tag = document.getElementById('doc-styles');
  if (!tag) { tag = document.createElement('style'); tag.id = 'doc-styles'; document.head.append(tag); }
  const text = css();
  if (tag.textContent !== text) tag.textContent = text;
  for (const k of ['--doc-font', '--head-font', '--doc-accent', '--head-color']) editor.style.removeProperty(k);
  for (const [k, v] of Object.entries(themeVars())) editor.style.setProperty(k, v);

  const s = state();
  for (const k of Object.keys(STYLES)) if (k.startsWith('cs-')) delete STYLES[k];
  for (const c of s.custom) STYLES['cs-' + c.id] = ['P', 'cs-' + c.id, c.name];
  const menu = $('#m-style'), sep = $('#sty-sep');
  if (menu && sep) {
    menu.querySelectorAll('button.custom').forEach((b) => b.remove());
    for (const c of s.custom) {
      const b = document.createElement('button');
      b.className = 'custom'; b.dataset.cmd = 'style'; b.dataset.val = 'cs-' + c.id;
      const pv = document.createElement('span'); pv.className = 'pv'; pv.textContent = c.name;
      const p = c.props || {};
      if (p.font) pv.style.fontFamily = fam(p.font);
      if (okColor(p.color)) pv.style.color = p.color;
      if (p.bold === 'bold') pv.style.fontWeight = '700';
      if (p.italic === 'italic') pv.style.fontStyle = 'italic';
      b.append(pv);
      sep.before(b);
    }
  }
  const t = api.doc.themeCustom || {};
  const cs = getComputedStyle(editor);
  if ($('#tc-font')) $('#tc-font').value = t.font || '';
  if ($('#tc-head')) $('#tc-head').value = t.head || '';
  if ($('#tc-accent')) $('#tc-accent').value = okColor(t.accent) || toHex(cs.getPropertyValue('--doc-accent') || '');
  if ($('#tc-reset')) $('#tc-reset').disabled = !api.doc.themeCustom;
}

// ---------- theme controls ----------
function setTheme(key, val) {
  const t = { ...(api.doc.themeCustom || {}) };
  if (val) t[key] = val; else delete t[key];
  api.doc.themeCustom = Object.keys(t).length ? t : null;
  apply();
  api.changed(true);
}

// ---------- styles dialog ----------
const propsOf = (key) => {
  const s = state();
  if (BUILTIN[key]) return s.overrides[key] || {};
  const c = s.custom.find((x) => 'cs-' + x.id === key);
  return c ? c.props || {} : {};
};
function fillPicker() {
  const s = state(), pick = api.$('#sty-pick');
  pick.innerHTML = Object.entries(BUILTIN).map(([k, [n]]) => `<option value="${k}">${n}${s.overrides[k] ? ' (modified)' : ''}</option>`).join('')
    + s.custom.map((c) => `<option value="cs-${c.id}">${api.esc(c.name)}</option>`).join('');
  if (!BUILTIN[cur] && !s.custom.some((c) => 'cs-' + c.id === cur)) cur = 'normal';
  pick.value = cur;
}
function fillForm() {
  const { $ } = api, p = propsOf(cur), custom = !BUILTIN[cur];
  const c = custom ? state().custom.find((x) => 'cs-' + x.id === cur) : null;
  $('#sty-name-row').hidden = !custom;
  $('#sty-name').value = c ? c.name : '';
  $('#sty-font').value = p.font || '';
  $('#sty-size').value = p.size || '';
  $('#sty-color-on').checked = !!okColor(p.color);
  $('#sty-color').value = okColor(p.color) || '#1c1c1c';
  $('#sty-bold').value = p.bold || '';
  $('#sty-italic').value = p.italic || '';
  $('#sty-align').value = p.align || '';
  $('#sty-before').value = p.before ?? '';
  $('#sty-after').value = p.after ?? '';
  $('#sty-reset').textContent = custom ? 'Delete style' : 'Reset to default';
  $('#sty-reset').disabled = !custom && !state().overrides[cur];
  preview();
}
function preview() {
  const pv = api.$('#sty-preview');
  const cls = BUILTIN[cur] ? api.STYLES[cur][1] : cur;
  const tag = BUILTIN[cur] ? api.STYLES[cur][0].toLowerCase() : 'p';
  pv.dataset.theme = api.doc.theme || 'modern';
  pv.setAttribute('style', rootStyle());
  pv.innerHTML = `<${tag}${cls ? ` class="${cls}"` : ''}>The quick brown fox jumps over the lazy dog</${tag}>`;
}
function readForm() {
  const { $ } = api, p = {};
  if ($('#sty-font').value) p.font = $('#sty-font').value;
  if (num($('#sty-size').value)) p.size = num($('#sty-size').value);
  if ($('#sty-color-on').checked) p.color = $('#sty-color').value;
  if ($('#sty-bold').value) p.bold = $('#sty-bold').value;
  if ($('#sty-italic').value) p.italic = $('#sty-italic').value;
  if ($('#sty-align').value) p.align = $('#sty-align').value;
  if ($('#sty-before').value !== '' && num($('#sty-before').value) !== null) p.before = num($('#sty-before').value);
  if ($('#sty-after').value !== '' && num($('#sty-after').value) !== null) p.after = num($('#sty-after').value);
  return p;
}
function saveForm() {
  const p = readForm(), name = api.$('#sty-name').value.trim();
  write((s) => {
    if (BUILTIN[cur]) { if (Object.keys(p).length) s.overrides[cur] = p; else delete s.overrides[cur]; return; }
    const c = s.custom.find((x) => 'cs-' + x.id === cur);
    if (c) { c.props = p; if (name) c.name = name.slice(0, 40); }
  });
  apply();
  api.$('#sty-reset').disabled = !!BUILTIN[cur] && !state().overrides[cur];
  preview();
}
function resetOrDelete() {
  if (BUILTIN[cur]) write((s) => { delete s.overrides[cur]; });
  else {
    const cls = cur;
    api.commit();
    api.editor.querySelectorAll('.' + cls).forEach((el) => { el.classList.remove(cls); if (!el.classList.length) el.removeAttribute('class'); });
    write((s) => { s.custom = s.custom.filter((x) => 'cs-' + x.id !== cls); });
    cur = 'normal';
  }
  apply(); fillPicker(); fillForm();
}
function addStyle() {
  const s0 = state();
  if (s0.custom.length >= 12) { api.toast('A document can have up to 12 custom styles.'); return; }
  const id = uid();
  write((s) => { s.custom.push({ id, name: `My style ${s.custom.length + 1}`, props: {} }); });
  cur = 'cs-' + id;
  apply(); fillPicker(); fillForm();
  api.$('#sty-name').focus(); api.$('#sty-name').select();
}
function openDialog() {
  api.closeMenus();
  const b = api.curBlock && api.curBlock();
  if (b) {
    const custom = [...b.classList].find((c) => c.startsWith('cs-') && api.STYLES[c]);
    const t = b.tagName.toLowerCase();
    cur = custom || (BUILTIN[t] ? t : b.classList.contains('doc-title') ? 'title' : b.classList.contains('doc-subtitle') ? 'subtitle' : b.classList.contains('quote') ? 'quote' : 'normal');
  }
  fillPicker(); fillForm();
  api.$('#dlg-styles').showModal();
}

export function init(a) {
  api = a;
  const { $, FONTS } = api;
  const fontOpts = (first) => `<option value="">${first}</option>` + FONTS.map((f) => `<option value="${f}">${f}</option>`).join('');
  $('#tc-font').innerHTML = fontOpts('Theme body font');
  $('#tc-head').innerHTML = fontOpts('Theme heading font');
  $('#sty-font').innerHTML = fontOpts('Default font');
  $('#tc-font').addEventListener('change', (e) => setTheme('font', e.target.value));
  $('#tc-head').addEventListener('change', (e) => setTheme('head', e.target.value));
  $('#tc-accent').addEventListener('input', (e) => setTheme('accent', e.target.value));
  api.cmd('themeReset', () => { api.doc.themeCustom = null; apply(); api.changed(true); });
  api.cmd('stylesDlg', openDialog);

  const dlg = $('#dlg-styles');
  $('#sty-pick').addEventListener('change', (e) => { cur = e.target.value; fillForm(); });
  for (const id of ['sty-font', 'sty-size', 'sty-color', 'sty-color-on', 'sty-bold', 'sty-italic', 'sty-align', 'sty-before', 'sty-after']) {
    $('#' + id).addEventListener('input', () => { if (id === 'sty-color') $('#sty-color-on').checked = true; saveForm(); });
  }
  $('#sty-name').addEventListener('change', () => { saveForm(); fillPicker(); });
  $('#sty-reset').addEventListener('click', resetOrDelete);
  $('#sty-new').addEventListener('click', addStyle);
  dlg.addEventListener('close', () => { apply(); api.changed(true); api.refreshUI(); });
}
