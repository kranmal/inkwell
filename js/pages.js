// Real pages: splits the editor's flow across page-sized sheets by pushing
// whole blocks to the next sheet, and draws headers, footers and page numbers.
let api, sheets, hfLayer, rules;
let n = 1, P = 0, H = 0, paged = true, hfSig = '';
const GAP = 24;
const HF0 = { header: '', headerAlign: 'left', footer: '', footerAlign: 'left', num: 'none', numFormat: '1', firstDiff: false };
const ALIGNS = ['left', 'center', 'right'];

export const hf = () => ({ ...HF0, ...((api && api.doc && api.doc.hf) || {}) });
export const count = () => n;

export function pageAt(clientTop) {
  if (!api || !P) return 1;
  const pr = api.page.getBoundingClientRect();
  const sc = pr.width / (api.pageDims().w * api.MM) || 1;
  return Math.max(1, Math.min(n, Math.floor((clientTop - pr.top) / sc / P) + 1));
}

function numText(fmt, i, total) {
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
export function firstPageCss() {
  if (!api || !api.doc || !hf().firstDiff) return '';
  return ` @page :first { ${['top', 'bottom'].flatMap((zn) => ALIGNS.map((a) => `@${zn}-${a} { content: none; }`)).join(' ')} }`;
}

function units(ed) {
  const out = [];
  let i = 0, forced = false;
  for (const el of ed.children) {
    i++;
    if (el.classList.contains('page-break')) { out.push({ el, brk: true }); forced = true; continue; }
    if ((el.tagName === 'UL' || el.tagName === 'OL') && el.children.length) {
      let j = 0;
      for (const li of el.children) { j++; out.push({ el: li, sel: `#editor > :nth-child(${i}) > :nth-child(${j})`, forced }); forced = false; }
    } else { out.push({ el, sel: `#editor > :nth-child(${i})`, forced }); forced = false; }
  }
  return out;
}

export function layout() {
  if (!api || !api.doc || !sheets) return;
  const { page, editor, MM } = api;
  const d = api.pageDims();
  H = d.h * MM;
  const mt = d.m.t * MM, mb = d.m.b * MM;
  rules.textContent = '';
  paged = d.cols <= 1;
  if (!paged) {
    page.style.height = '';
    P = H;
    n = Math.max(1, Math.ceil((page.offsetHeight - 2) / H));
    drawSheets(1, true);
    drawHf(d, true);
    return;
  }
  P = H + GAP;
  const pr = page.getBoundingClientRect();
  const sc = pr.width / (d.w * MM) || 1;
  const us = units(editor);
  for (const u of us) {
    const r = u.el.getBoundingClientRect();
    u.t = (r.top - pr.top) / sc; u.b = (r.bottom - pr.top) / sc;
  }
  let S = 0, k = 0, prevB = mt, css = '';
  for (const u of us) {
    const g = Math.max(0, u.t - prevB);
    const t = u.t + S;
    let b = u.b + S;
    const CT = k * P + mt, CB = k * P + H - mb;
    if (!u.brk && (u.forced || (b > CB + 0.5 && t > CT + 1))) {
      const delta = (k + 1) * P + mt - t;
      if (delta > 0) { css += `${u.sel}{margin-top:${(g + delta).toFixed(2)}px !important}`; S += delta; b += delta; }
      k++;
    }
    k = Math.max(k, Math.floor((b - 1) / P));
    prevB = u.b;
  }
  n = k + 1;
  rules.textContent = css;
  page.style.height = n * H + (n - 1) * GAP + 'px';
  drawSheets(n, false);
  drawHf(d, false);
}

function drawSheets(num, whole) {
  while (sheets.children.length > num) sheets.lastChild.remove();
  while (sheets.children.length < num) { const s = document.createElement('div'); s.className = 'sheet'; sheets.append(s); }
  [...sheets.children].forEach((s, i) => {
    s.style.top = whole ? '0' : i * P + 'px';
    s.style.height = whole ? '100%' : H + 'px';
  });
}

function drawHf(d, whole) {
  const h = hf(), MM = api.MM;
  const fam = getComputedStyle(api.editor).fontFamily;
  const sig = JSON.stringify([h, n, d, whole, fam, whole ? api.page.offsetHeight : 0]);
  if (sig === hfSig) return;
  hfSig = sig;
  const z = slotParts(h);
  const zonesFor = whole ? 1 : n;
  let html = '';
  const zone = (which, i, top, height) => {
    const blank = h.firstDiff && i === 0;
    const parts = z[which];
    const any = !blank && ALIGNS.some((a) => parts[a].length);
    const cells = ALIGNS.map((a) => `<span class="hf-${a}">${blank ? '' : parts[a].map((p) => api.esc(typeof p === 'string' ? p : numText(h.numFormat, i + 1, n))).join(' · ')}</span>`).join('');
    const name = which === 'top' ? 'header' : 'footer';
    html += `<div class="hf-zone hf-${name}${any ? '' : ' empty'}" style="top:${top}px;height:${height}px;padding:0 ${d.m.r * MM}px 0 ${d.m.l * MM}px" title="Double-click to edit the ${name}">${any ? cells : `<span class="hf-hint">Double-click to add a ${name}</span>`}</div>`;
  };
  for (let i = 0; i < zonesFor; i++) {
    const base = whole ? 0 : i * P;
    zone('top', i, base, d.m.t * MM);
    if (whole) html += `<div class="hf-zone hf-footer-wrap" style="bottom:0;height:${d.m.b * MM}px"></div>`;
    else zone('bottom', i, base + H - d.m.b * MM, d.m.b * MM);
  }
  if (whole) {
    // one continuous sheet: footer sits at the very bottom
    const parts = z.bottom, any = ALIGNS.some((a) => parts[a].length);
    html = html.replace('<div class="hf-zone hf-footer-wrap" style="', `<div class="hf-zone hf-footer${any ? '' : ' empty'}" title="Double-click to edit the footer" style="padding:0 ${d.m.r * MM}px 0 ${d.m.l * MM}px;`)
      .replace(/<\/div>$/, (any ? ALIGNS.map((a) => `<span class="hf-${a}">${parts[a].map((p) => api.esc(typeof p === 'string' ? p : numText(h.numFormat, 1, n))).join(' · ')}</span>`).join('') : '<span class="hf-hint">Double-click to add a footer</span>') + '</div>');
  }
  hfLayer.style.fontFamily = fam;
  hfLayer.innerHTML = html;
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
  dlg.returnValue = '';
  dlg.showModal();
}

export function init(a) {
  api = a;
  const { page } = api;
  sheets = document.createElement('div'); sheets.className = 'sheets'; sheets.setAttribute('aria-hidden', 'true');
  hfLayer = document.createElement('div'); hfLayer.className = 'hf-layer';
  page.prepend(sheets);
  page.append(hfLayer);
  page.classList.add('paged');
  rules = document.createElement('style'); rules.id = 'pg-rules'; rules.media = 'screen';
  document.head.append(rules);

  hfLayer.addEventListener('dblclick', (e) => { if (e.target.closest('.hf-zone')) openDialog(); });
  api.cmd('hf', openDialog);
  api.$('#dlg-hf').addEventListener('close', (e) => {
    if (e.target.returnValue !== 'ok') return;
    api.doc.hf = {
      header: api.$('#hf-header').value.trim(), headerAlign: api.$('#hf-header-align').value,
      footer: api.$('#hf-footer').value.trim(), footerAlign: api.$('#hf-footer-align').value,
      num: api.$('#hf-num').value, numFormat: api.$('#hf-format').value, firstDiff: api.$('#hf-first').checked,
    };
    hfSig = '';
    api.applyPage();
    api.changed(true);
  });
}
