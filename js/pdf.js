// Save as PDF with real, selectable text. The paginated page is read straight from the DOM: every word is
// placed where the browser drew it, in a standard PDF font (Helvetica, Times or Courier, stretched to the exact
// width), with backgrounds, borders, list markers, pictures and links, and headings as bookmarks.
import { geometry } from './pages.js';
import { parseFont } from './pdffont.js';

let api;
const K = 0.75; // CSS px to PDF points
const SKIP = 'svg,script,style,.pgs-gap,.hf-hint,.hf-zone.empty,.page-break,.sect-break,.eq-preview,[hidden]';
const NOBOX = '.cm,.page-break,.sect-break,.pgs-gap';

// ---------- colour, fonts, text encoding ----------
function rgba(s) {
  const m = /^(?:rgba?|color\(srgb)\(?([^)]*)\)/.exec(s || '') || /^rgba?\(([^)]*)\)/.exec(s || '');
  if (!m) return null;
  const p = m[1].trim().split(/[\s,/]+/).filter(Boolean).map((t) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)));
  const f = /^color\(/.test(s) ? 1 : 255;
  const a = p.length > 3 ? p[3] : 1;
  return [p[0] / f, p[1] / f, p[2] / f, Number.isFinite(a) ? a : 1];
}
const onWhite = (c) => [c[0] * c[3] + 1 - c[3], c[1] * c[3] + 1 - c[3], c[2] * c[3] + 1 - c[3]];
const num = (v) => String(Math.round(v * 100) / 100);
const rg = (c) => `${num(c[0])} ${num(c[1])} ${num(c[2])}`;

const STACKS = [
  'Helvetica, Arial, "Liberation Sans", sans-serif',
  '"Times New Roman", Times, "Liberation Serif", serif',
  'Courier, "Courier New", "Liberation Mono", monospace',
];
const BASE = [
  ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
];
function family(css) {
  const first = (css.split(',')[0] || '').replace(/["']/g, '').trim().toLowerCase();
  const all = css.toLowerCase();
  if (/courier|mono|consolas|menlo|code|typewriter/.test(first)) return 2;
  if (/georgia|times|cambria|garamond|palatino|book|serif$|charter|minion|merriweather|lora|playfair/.test(first) && !/sans/.test(first)) return 1;
  if (!first || /^(system-ui|-apple-system|ui-sans-serif)$/.test(first)) return 0;
  if (/(^|,)\s*monospace\s*$/.test(all) && !/sans|serif/.test(first)) return 2;
  if (/(^|,)\s*serif\s*$/.test(all) && !/sans/.test(all)) return 1;
  return 0;
}
const mctx = document.createElement('canvas').getContext('2d');
const wCache = new Map();
function stdWidth(text, fam, bold, italic) { // width of text at 1px in the matching standard font
  const font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px ${STACKS[fam]}`;
  mctx.font = font;
  return mctx.measureText(text).width / 100;
}
const aCache = new Map();
function ascentOf(cs) {
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if (aCache.has(font)) return aCache.get(font);
  mctx.font = font;
  const m = mctx.measureText('x');
  const v = (m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.82) / parseFloat(cs.fontSize);
  aCache.set(font, v);
  return v;
}

const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F, 0x2212: 0x2D, 0x2010: 0x2D, 0x2011: 0x2D, 0x2009: 0x20, 0x202F: 0xA0, 0x2002: 0x20, 0x2003: 0x20 };
let lost = 0;
function winAnsi(str) { // -> hex string for a PDF text operand
  let h = '';
  for (const ch of str) {
    const c = ch.codePointAt(0);
    let b;
    if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF)) b = c;
    else if (WIN[c] !== undefined) b = WIN[c];
    else if (c === 0x200B || c === 0xAD || c === 0x200C || c === 0x200D || c === 0xFEFF || c === 0x09 || c === 0x0A) continue;
    else { b = 0x3F; lost++; }
    h += b.toString(16).padStart(2, '0');
  }
  return h;
}

// ---------- low-level PDF file ----------
const enc = new TextEncoder();
async function deflate(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function utf16(s) {
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${h}>`;
}
class Pdf {
  constructor() { this.objs = []; }
  reserve() { this.objs.push(null); return this.objs.length; }
  set(id, body, stream) { this.objs[id - 1] = { body, stream }; }
  add(body, stream) { const id = this.reserve(); this.set(id, body, stream); return id; }
  async addStream(dict, data, compress = true) {
    const z = compress ? await deflate(data) : null;
    return this.add(`<< ${dict}${z ? ' /Filter /FlateDecode' : ''} /Length ${(z || data).length} >>`, z || data);
  }
  build(rootId, infoId) {
    const parts = []; let len = 0;
    const put = (x) => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
    put('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n');
    const offs = [];
    this.objs.forEach((o, i) => {
      offs.push(len);
      put(`${i + 1} 0 obj\n${o.body}\n`);
      if (o.stream) { put('stream\n'); put(o.stream); put('\nendstream\n'); }
      put('endobj\n');
    });
    const x0 = len;
    put(`xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`);
    for (const o of offs) put(String(o).padStart(10, '0') + ' 00000 n \n');
    put(`trailer\n<< /Size ${this.objs.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${x0}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
}

// ---------- images ----------
async function rasterOf(el, w, h) { // -> {w, h, jpeg?:Uint8Array, rgb?:Uint8Array, alpha?:Uint8Array} or null
  try {
    let src = el;
    if (el.tagName.toLowerCase() === 'svg') {
      const c = el.cloneNode(true);
      c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!c.getAttribute('width')) c.setAttribute('width', w);
      if (!c.getAttribute('height')) c.setAttribute('height', h);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c));
      await img.decode();
      src = img;
    } else if (!el.complete || !el.naturalWidth) return null;
    const nw = src.naturalWidth || w, nh = src.naturalHeight || h;
    const sc = el.tagName.toLowerCase() === 'svg' ? 2 : Math.min(1, 2400 / Math.max(nw, nh));
    const cw = Math.max(1, Math.round((el.tagName.toLowerCase() === 'svg' ? w : nw) * sc)), ch = Math.max(1, Math.round((el.tagName.toLowerCase() === 'svg' ? h : nh) * sc));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const x = cv.getContext('2d');
    x.drawImage(src, 0, 0, cw, ch);
    const px = x.getImageData(0, 0, cw, ch).data;
    let alpha = false;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
    if (!alpha) {
      const f = document.createElement('canvas'); f.width = cw; f.height = ch;
      const fx = f.getContext('2d'); fx.fillStyle = '#fff'; fx.fillRect(0, 0, cw, ch); fx.drawImage(cv, 0, 0);
      const blob = await new Promise((r) => f.toBlob(r, 'image/jpeg', 0.92));
      return { w: cw, h: ch, jpeg: new Uint8Array(await blob.arrayBuffer()) };
    }
    const rgb = new Uint8Array(cw * ch * 3), a = new Uint8Array(cw * ch);
    for (let i = 0, j = 0, k = 0; i < px.length; i += 4, j += 3, k++) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; a[k] = px[i + 3]; }
    return { w: cw, h: ch, rgb, alpha: a };
  } catch { return null; }
}

// ---------- list markers ----------
const roman = (n) => { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s; };
const alpha = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
function markerOf(li, cs) {
  const t = cs.listStyleType;
  if (cs.display !== 'list-item' || t === 'none') return null;
  if (t === 'disc' || t === 'circle' || t === 'square') return { shape: t };
  if (/^["']/.test(t)) return { text: t.slice(1, -1) };
  const list = li.parentElement;
  let n = 1;
  if (list && (list.tagName === 'OL' || list.tagName === 'UL')) {
    const items = [...list.children].filter((c) => c.tagName === 'LI');
    const rev = list.hasAttribute('reversed');
    const st = parseInt(list.getAttribute('start'), 10);
    n = Number.isFinite(st) ? st : (rev ? items.length : 1);
    for (const c of items) {
      const v = parseInt(c.getAttribute('value'), 10);
      if (Number.isFinite(v)) n = v;
      if (c === li) break;
      n += rev ? -1 : 1;
    }
  }
  let s;
  if (t === 'lower-alpha' || t === 'lower-latin') s = alpha(n);
  else if (t === 'upper-alpha' || t === 'upper-latin') s = alpha(n).toUpperCase();
  else if (t === 'lower-roman') s = roman(n);
  else if (t === 'upper-roman') s = roman(n).toUpperCase();
  else if (t === 'decimal-leading-zero') s = String(n).padStart(2, '0');
  else s = String(n);
  return { text: s + '.' };
}

const fkey = (f) => f.fam * 4 + (f.bold ? 1 : 0) + (f.italic ? 2 : 0);

// ---------- the exporter ----------
export async function buildPdf(opts = {}) {
  lost = 0;
  const { editor, page } = api;
  await api.flush();
  await document.fonts.ready;
  window.dispatchEvent(new Event('beforeprint')); // clears zoom, find marks, selection
  await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 300); });
  try { return await collect(editor, page, opts.source); } finally { window.dispatchEvent(new Event('afterprint')); }
}

async function collect(editor, page, source) {
  const { pgs, W } = geometry();
  if (!pgs.length) throw new Error('no pages');
  const pr = page.getBoundingClientRect();
  const pages = pgs.map((g) => ({
    g, ox: pr.left + (W - g.w) / 2, oy: pr.top + g.top,
    L: [[], [], [], [], []], fonts: new Set(), imgs: new Set(), annots: [], cur: '',
  }));
  const pageOf = (cy) => { const y = cy - pr.top; let k = 0; while (k < pgs.length - 1 && y >= pgs[k + 1].top - 1) k++; return k; };
  const X = (p, x) => num((x - p.ox) * K), Y = (p, y) => num((p.g.h - (y - p.oy)) * K);
  const roots = [editor, page.querySelector('.hf-layer')].filter(Boolean);
  const styles = new Map();
  const sty = (el) => { let s = styles.get(el); if (!s) { s = getComputedStyle(el); styles.set(el, s); } return s; };
  const visible = (el) => { const s = sty(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const rect = (p, layer, x, y, w, h, c) => { if (w > 0.01 && h > 0.01) p.L[layer].push(`${rg(c)} rg ${X(p, x)} ${num((p.g.h - (y + h - p.oy)) * K)} ${num(w * K)} ${num(h * K)} re f`); };
  const images = []; // {key, raster}
  const imgKey = new Map();
  const bookmarks = [];
  const nodes = [];
  for (const root of roots) { nodes.push(root); for (const el of root.querySelectorAll('*')) nodes.push(el); }

  // embedded fonts: find the real font file for every family/weight/style in use
  const faceCache = new Map(), faces = [];
  const faceKey = (cs) => `${cs.fontFamily}|${+cs.fontWeight >= 600 ? 1 : 0}${/italic|oblique/.test(cs.fontStyle) ? 1 : 0}`;
  const faceFor = (cs) => faceCache.get(faceKey(cs)) || null;
  if (source) {
    for (const el of nodes) {
      if (el.closest(SKIP) || !(el.tagName === 'LI' || [...el.childNodes].some((c) => c.nodeType === 3 && c.data.trim()))) continue;
      const cs = sty(el), k = faceKey(cs);
      if (faceCache.has(k)) continue;
      faceCache.set(k, null);
      const bold = +cs.fontWeight >= 600, italic = /italic|oblique/.test(cs.fontStyle);
      for (const fam of cs.fontFamily.split(/,(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/).map((x) => x.trim().replace(/^["']|["']$/g, ''))) {
        if (!fam || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system)$/i.test(fam)) break;
        let got = null;
        try { got = await source(fam, bold, italic); } catch { got = null; }
        if (!got) continue;
        const font = parseFont(got.data);
        if (!font) break;
        const face = { font, used: new Map(), name: got.name || fam, italic, idx: faces.length };
        faces.push(face); faceCache.set(k, face);
        break;
      }
    }
  }

  // 1. backgrounds, borders, pictures, leaders, markers
  for (const el of nodes) {
    if (el.closest(SKIP) && !el.matches('svg')) continue;
    if (el.closest('svg') && !el.matches('svg')) continue;
    const cs = sty(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.matches('svg,img')) { // pictures
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || (el.closest('.hf-zone.empty'))) continue;
      const bl = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), br = parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight);
      const bt = parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop), bb = parseFloat(cs.borderBottomWidth) + parseFloat(cs.paddingBottom);
      const box = { x: r.left + bl, y: r.top + bt, w: r.width - bl - br, h: r.height - bt - bb };
      const k = pageOf(r.top + r.height / 2);
      const key = el.tagName === 'IMG' ? el.currentSrc + '|' + Math.round(box.w) + 'x' + Math.round(box.h) : null;
      let idx = key ? imgKey.get(key) : undefined;
      if (idx === undefined) {
        const ras = await rasterOf(el, box.w, box.h);
        if (!ras) continue;
        idx = images.push(ras) - 1;
        if (key) imgKey.set(key, idx);
      }
      pages[k].imgs.add(idx);
      pages[k].L[2].push(`q ${num(box.w * K)} 0 0 ${num(box.h * K)} ${X(pages[k], box.x)} ${num((pages[k].g.h - (box.y + box.h - pages[k].oy)) * K)} cm /Im${idx} Do Q`);
    }
    if (el.matches(NOBOX) || el.closest('.cm')) { /* no boxes for comment highlights and breaks */ } else {
      const bg = rgba(cs.backgroundColor);
      const rects = [...el.getClientRects()];
      if (bg && bg[3] > 0 && el !== editor && !el.matches('svg,img')) {
        const c = onWhite(bg);
        if (!(c[0] > 0.99 && c[1] > 0.99 && c[2] > 0.99)) for (const r of rects) rect(pages[pageOf(r.top + r.height / 2)], 0, r.left, r.top, r.width, r.height, c);
      }
      const sides = [['Top', 0], ['Right', 1], ['Bottom', 2], ['Left', 3]];
      for (const r of rects) {
        if (r.width < 0.5 && r.height < 0.5) continue;
        const p = pages[pageOf(r.top + r.height / 2)];
        for (const [name, i] of sides) {
          const w = parseFloat(cs['border' + name + 'Width']), st = cs['border' + name + 'Style'];
          if (!(w > 0) || st === 'none' || st === 'hidden') continue;
          const col = rgba(cs['border' + name + 'Color']);
          if (!col || col[3] <= 0) continue;
          const c = onWhite(col);
          if (st === 'dashed' || st === 'dotted') {
            const hz = i % 2 === 0;
            const x0 = hz ? r.left : (i === 1 ? r.right - w / 2 : r.left + w / 2), y0 = hz ? (i === 0 ? r.top + w / 2 : r.bottom - w / 2) : r.top;
            const x1 = hz ? r.right : x0, y1 = hz ? y0 : r.bottom;
            const d = st === 'dotted' ? `[${num(w * K)} ${num(w * K * 1.5)}] 0 d 1 J` : `[${num(w * K * 3)} ${num(w * K * 2)}] 0 d 0 J`;
            p.L[1].push(`q ${rg(c).replace(/ /g, ' ')} RG ${num(w * K)} w ${d} ${X(p, x0)} ${Y(p, y0)} m ${X(p, x1)} ${Y(p, y1)} l S Q`);
          } else if (i === 0) rect(p, 1, r.left, r.top, r.width, w, c);
          else if (i === 2) rect(p, 1, r.left, r.bottom - w, r.width, w, c);
          else if (i === 3) rect(p, 1, r.left, r.top, w, r.height, c);
          else rect(p, 1, r.right - w, r.top, w, r.height, c);
        }
      }
    }
    if (el.matches('.toc p[data-i],.index-row') && el.firstElementChild && el.lastElementChild !== el.firstElementChild) { // dotted leaders
      const a = [...el.firstElementChild.getClientRects()].pop(), b = el.lastElementChild.getClientRects()[0];
      if (a && b && b.left - a.right > 14 && Math.abs(a.top - b.top) < a.height) {
        const p = pages[pageOf(a.top + a.height / 2)];
        const y = a.top + ascentOf(sty(el.firstElementChild)) * parseFloat(sty(el.firstElementChild).fontSize) - 3;
        p.L[1].push(`q 0.6 g 0.6 G 0.75 w [0.75 2.25] 0 d 1 J ${X(p, a.right + 6)} ${Y(p, y)} m ${X(p, b.left - 6)} ${Y(p, y)} l S Q`);
      }
    }
    if (el.tagName === 'LI') await marker(el, cs); // eslint-disable-line no-use-before-define
    if (/^H[1-3]$/.test(el.tagName) && el.textContent.trim() && !el.closest('.toc,.index')) {
      const r = el.getBoundingClientRect(), k = pageOf(r.top);
      bookmarks.push({ level: +el.tagName[1], title: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 200), page: k, y: (pages[k].g.h - (r.top - pages[k].oy)) * K });
    }
  }

  // list markers (drawn like text)
  function firstText(el) {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() && !n.parentElement.closest(SKIP) ? 1 : 3) });
    return tw.nextNode();
  }
  async function marker(li, cs) {
    const m = markerOf(li, cs);
    if (!m) return;
    const lr = li.getClientRects()[0];
    if (!lr) return;
    const fs = parseFloat(cs.fontSize);
    const tn = firstText(li);
    let base = lr.top + ascentOf(cs) * fs, contentLeft = lr.left + parseFloat(cs.paddingLeft);
    if (tn) {
      const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 1);
      const b = r.getBoundingClientRect();
      if (b.width) { base = b.top + ascentOf(sty(tn.parentElement)) * parseFloat(sty(tn.parentElement).fontSize); contentLeft = b.left; }
    }
    const p = pages[pageOf(base)];
    const col = onWhite(rgba(cs.color) || [0, 0, 0, 1]);
    if (m.shape) {
      const d = fs * 0.34, cx = contentLeft - fs * 0.95, cy = base - fs * 0.32;
      if (m.shape === 'square') rect(p, 3, cx - d / 2, cy - d / 2, d, d, col);
      else {
        const rr = d / 2 * K, kx = 0.5523 * rr, x = (cx - p.ox) * K, y = (p.g.h - (cy - p.oy)) * K;
        const path = `${num(x + rr)} ${num(y)} m ${num(x + rr)} ${num(y + kx)} ${num(x + kx)} ${num(y + rr)} ${num(x)} ${num(y + rr)} c ${num(x - kx)} ${num(y + rr)} ${num(x - rr)} ${num(y + kx)} ${num(x - rr)} ${num(y)} c ${num(x - rr)} ${num(y - kx)} ${num(x - kx)} ${num(y - rr)} ${num(x)} ${num(y - rr)} c ${num(x + kx)} ${num(y - rr)} ${num(x + rr)} ${num(y - kx)} ${num(x + rr)} ${num(y)} c`;
        p.L[3].push(m.shape === 'disc' ? `${rg(col)} rg ${path} f` : `${rg(col)} RG 0.75 w ${path} S`);
      }
      return;
    }
    const fam = family(cs.fontFamily), bold = +cs.fontWeight >= 600, italic = /italic|oblique/.test(cs.fontStyle);
    const sw = stdWidth(m.text, fam, bold, italic) * fs;
    word(p, m.text, contentLeft - fs * 0.3 - sw, base, sw, { fam, bold, italic, fs, col, deco: null, face: faceFor(cs) });
  }

  function glyphs(face, str) { // -> {hex, natural} or null when the font lacks a character
    const { font } = face;
    let hex = '', nat = 0, trail = 0;
    for (const ch of str) {
      let cp = ch.codePointAt(0);
      if (cp === 0x200B || cp === 0xAD || cp === 0x200C || cp === 0x200D || cp === 0xFEFF || cp === 0x0A) continue;
      if (cp === 0x09 || cp === 0xA0 || (cp >= 0x2002 && cp <= 0x2009) || cp === 0x202F) cp = 0x20;
      const g = font.gid(cp);
      if (!g) return null;
      face.used.set(g, cp);
      hex += g.toString(16).padStart(4, '0');
      const a = font.adv(g) / font.upm;
      if (cp === 0x20) trail += a; else { nat += a + trail; trail = 0; }
    }
    return hex ? { hex, natural: nat } : null;
  }
  function word(p, str, x, baseline, width, f) {
    const g = f.face ? glyphs(f.face, str) : null;
    let hex, font, tz;
    if (g) {
      const nat = g.natural * f.fs;
      tz = nat > 0 ? Math.max(20, Math.min(400, (width / nat) * 100)) : 100;
      font = `E${f.face.idx}`; hex = g.hex;
    } else {
      hex = winAnsi(str);
      if (!hex) return;
      const std = stdWidth(str.trimEnd(), f.fam, f.bold, f.italic) * f.fs;
      tz = std > 0 ? Math.max(20, Math.min(400, (width / std) * 100)) : 100;
      font = `F${fkey(f)}`;
    }
    p.fonts.add(g ? font : fkey(f));
    p.L[3].push(`${rg(f.col)} rg BT /${font} ${num(f.fs * K)} Tf ${num(tz)} Tz ${X(p, x)} ${Y(p, baseline)} Td <${hex}> Tj ET`);
    if (f.deco) {
      const dc = f.deco.color || f.col, t = Math.max(0.5 / K, f.fs * 0.06);
      if (/underline/.test(f.deco.line)) rect(p, 3, x, baseline + f.fs * 0.12, width, t, dc);
      if (/line-through/.test(f.deco.line)) rect(p, 3, x, baseline - f.fs * 0.28, width, t, dc);
    }
  }

  // 2. text
  const fcache = new Map();
  const fontOf = (el) => {
    let f = fcache.get(el);
    if (f) return f;
    const cs = sty(el);
    const fs = parseFloat(cs.fontSize);
    const col = onWhite(rgba(cs.color) || [0, 0, 0, 1]);
    let deco = null;
    for (let e = el; e && e !== page; e = e.parentElement) {
      const s = sty(e), l = s.textDecorationLine;
      if (l && l !== 'none') { const dcol = rgba(s.textDecorationColor); deco = { line: l, color: dcol && !/currentcolor/i.test(s.textDecorationColor) ? onWhite(dcol) : onWhite(rgba(s.color) || [0, 0, 0, 1]) }; break; }
    }
    f = { face: faceFor(cs), fam: family(cs.fontFamily), bold: +cs.fontWeight >= 600, italic: /italic|oblique/.test(cs.fontStyle), fs, col, deco, asc: ascentOf(cs) * fs, tt: cs.textTransform, vis: visible(el) && +cs.opacity > 0 };
    fcache.set(el, f);
    return f;
  };
  const range = document.createRange();
  const runs = (node, a, b) => {
    range.setStart(node, a); range.setEnd(node, b);
    const rs = [...range.getClientRects()].filter((r) => r.width > 0.01 && r.height > 0.01);
    if (!rs.length) return [];
    if (rs.every((r) => Math.abs(r.top - rs[0].top) < 1.5)) {
      const l = Math.min(...rs.map((r) => r.left)), rr = Math.max(...rs.map((r) => r.right));
      return [{ a, b, left: l, width: rr - l, top: rs[0].top, height: rs[0].height }];
    }
    const out = []; let cur = null;
    for (let i = a; i < b; i++) {
      const e = i + 1 < b && /[\uD800-\uDBFF]/.test(node.data[i]) ? i + 2 : i + 1;
      range.setStart(node, i); range.setEnd(node, e);
      const r = range.getBoundingClientRect();
      if (r.width > 0.01) {
        if (cur && Math.abs(r.top - cur.top) < 1.5 && r.left >= cur.left + cur.width - 1) { cur.b = e; cur.width = r.right - cur.left; } else { cur = { a: i, b: e, left: r.left, width: r.width, top: r.top, height: r.height }; out.push(cur); }
      }
      i = e - 1;
    }
    return out;
  };
  for (const root of roots) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() && !n.parentElement.closest(SKIP) ? 1 : 3) });
    let tn;
    while ((tn = tw.nextNode())) {
      const f = fontOf(tn.parentElement);
      if (!f.vis) continue;
      const text = tn.data;
      for (const m of text.matchAll(/\S+/g)) {
        for (const r of runs(tn, m.index, m.index + m[0].length)) {
          let s = text.slice(r.a, r.b);
          if (f.tt === 'uppercase') s = s.toUpperCase(); else if (f.tt === 'lowercase') s = s.toLowerCase();
          else if (f.tt === 'capitalize') s = s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
          const k = pageOf(r.top + r.height / 2);
          word(pages[k], s + ' ', r.left, r.top + f.asc, r.width, f); // the space makes copied text read naturally
        }
      }
    }
  }
  // 3. links
  for (const root of roots) for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!/^(https?:|mailto:)/i.test(href) || a.closest(SKIP)) continue;
    for (const r of a.getClientRects()) {
      if (r.width < 1) continue;
      const p = pages[pageOf(r.top + r.height / 2)];
      p.annots.push({ rect: [X(p, r.left), Y(p, r.bottom), X(p, r.right), Y(p, r.top)], uri: href });
    }
  }
  return assemble(pages, images, bookmarks, faces.filter((f) => f.used.size));
}

async function assemble(pages, images, bookmarks, faces) {
  const pdf = new Pdf();
  const catalog = pdf.reserve(), tree = pdf.reserve(), info = pdf.reserve();
  const fontIds = new Map();
  const fontId = (k) => { if (!fontIds.has(k)) fontIds.set(k, pdf.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${BASE[Math.floor(k / 4)][k % 4]} /Encoding /WinAnsiEncoding >>`)); return fontIds.get(k); };
  const efId = new Map();
  const tag = (i) => String.fromCharCode(65 + (i % 26), 65 + (Math.floor(i / 26) % 26), 65 + ((i * 7) % 26), 65 + ((i * 11) % 26), 65 + ((i * 5) % 26), 65 + ((i * 3) % 26));
  for (const f of faces) {
    const { font } = f, sc = 1000 / font.upm;
    const data = font.subset(f.used.keys());
    const file = await pdf.addStream(`/Length1 ${data.length}`, data);
    const base = `${tag(f.idx + 1)}+${String(f.name).replace(/[^A-Za-z0-9-]/g, '') || 'Font'}`;
    const desc = pdf.add(`<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${font.bbox.map((v) => Math.round(v * sc)).join(' ')}] /ItalicAngle ${f.italic ? -12 : 0} /Ascent ${Math.round(font.ascent * sc)} /Descent ${Math.round(font.descent * sc)} /CapHeight ${Math.round(font.ascent * sc * 0.7)} /StemV 80 /FontFile2 ${file} 0 R >>`);
    const gs = [...f.used.keys()].sort((a, b) => a - b);
    const cid = pdf.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 0 /W [${gs.map((g) => `${g} [${Math.round(font.adv(g) * sc)}]`).join(' ')}] >>`);
    const hx = (cp) => (cp > 0xFFFF ? (((cp - 0x10000) >> 10) + 0xD800).toString(16).padStart(4, '0') + (((cp - 0x10000) & 0x3FF) + 0xDC00).toString(16).padStart(4, '0') : cp.toString(16).padStart(4, '0'));
    let cm = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n';
    for (let i = 0; i < gs.length; i += 100) {
      const part = gs.slice(i, i + 100);
      cm += `${part.length} beginbfchar\n${part.map((g) => `<${g.toString(16).padStart(4, '0')}> <${hx(f.used.get(g))}>`).join('\n')}\nendbfchar\n`;
    }
    cm += 'endcmap CMapName currentdict /CMap defineresource pop end end';
    const tu = await pdf.addStream('', enc.encode(cm));
    efId.set(`E${f.idx}`, pdf.add(`<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`));
  }
  const imgIds = [];
  for (const [i, im] of images.entries()) {
    if (im.jpeg) imgIds[i] = await pdf.addStream(`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, im.jpeg, false);
    else {
      const mask = await pdf.addStream(`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8`, im.alpha);
      imgIds[i] = await pdf.addStream(`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${mask} 0 R`, im.rgb);
    }
  }
  const pageIds = pages.map(() => pdf.reserve());
  for (const [i, p] of pages.entries()) {
    const content = await pdf.addStream('', enc.encode(p.L.map((l) => l.join('\n')).filter(Boolean).join('\n')));
    const annots = p.annots.map((a) => pdf.add(`<< /Type /Annot /Subtype /Link /Rect [${a.rect.join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${encodeURI(a.uri).replace(/[()\\]/g, '\\$&')}) >> >>`));
    const fonts = [...p.fonts].map((k) => (typeof k === 'string' ? `/${k} ${efId.get(k)} 0 R` : `/F${k} ${fontId(k)} 0 R`)).join(' ');
    const xo = [...p.imgs].map((k) => `/Im${k} ${imgIds[k]} 0 R`).join(' ');
    pdf.set(pageIds[i], `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${num(p.g.w * K)} ${num(p.g.h * K)}] /Resources << /Font << ${fonts} >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((a) => a + ' 0 R').join(' ')}]` : ''} >>`);
  }
  pdf.set(tree, `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`);

  // bookmarks: nest by heading level
  let outlines = 0;
  if (bookmarks.length) {
    outlines = pdf.reserve();
    const nodes = bookmarks.map((b) => ({ ...b, id: pdf.reserve(), kids: [] }));
    const root = { level: 0, kids: [] }, stack = [root];
    for (const n of nodes) {
      while (stack[stack.length - 1].level >= n.level) stack.pop();
      stack[stack.length - 1].kids.push(n); n.parent = stack[stack.length - 1]; stack.push(n);
    }
    const count = (n) => n.kids.reduce((s, k) => s + 1 + count(k), 0);
    for (const n of nodes) {
      const sib = n.parent.kids, i = sib.indexOf(n);
      pdf.set(n.id, `<< /Title ${utf16(n.title)} /Parent ${n.parent === root ? outlines : n.parent.id} 0 R${i > 0 ? ` /Prev ${sib[i - 1].id} 0 R` : ''}${i < sib.length - 1 ? ` /Next ${sib[i + 1].id} 0 R` : ''}${n.kids.length ? ` /First ${n.kids[0].id} 0 R /Last ${n.kids[n.kids.length - 1].id} 0 R /Count ${count(n)}` : ''} /Dest [${pageIds[n.page]} 0 R /XYZ 0 ${num(n.y)} null] >>`);
    }
    pdf.set(outlines, `<< /Type /Outlines /First ${root.kids[0].id} 0 R /Last ${root.kids[root.kids.length - 1].id} 0 R /Count ${count(root)} >>`);
  }
  pdf.set(catalog, `<< /Type /Catalog /Pages ${tree} 0 R${outlines ? ` /Outlines ${outlines} 0 R /PageMode /UseOutlines` : ''} /Lang (${/^[a-zA-Z-]{2,10}$/.test(api.editor.lang || '') ? api.editor.lang : 'en'}) /ViewerPreferences << /DisplayDocTitle true >> >>`);
  const d = new Date(), z = (v) => String(v).padStart(2, '0');
  pdf.set(info, `<< /Title ${utf16(api.doc.title || 'Untitled')} /Producer (Inkwell) /CreationDate (D:${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}) >>`);
  return { blob: pdf.build(catalog, info), pages: pages.length, lost };
}

// The fonts installed on this computer, read with the browser's Local Font Access API (Chrome and Edge, with permission).
async function localFonts() {
  const list = await window.queryLocalFonts();
  const by = new Map();
  for (const f of list) { const k = f.family.toLowerCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
  const STY = [/^(regular|book|roman|normal|medium)$/, /^bold$/, /^(italic|oblique|book italic|regular italic)$/, /^(bold italic|bold oblique)$/];
  return async (fam, bold, italic) => {
    const want = STY[(bold ? 1 : 0) + (italic ? 2 : 0)];
    const f = (by.get(fam.toLowerCase()) || []).find((x) => want.test(x.style.toLowerCase()));
    return f ? { data: await (await f.blob()).arrayBuffer(), name: f.postscriptName } : null;
  };
}

async function savePdf(embed) {
  api.toggleBackstage(false);
  let source = null;
  if (embed === true) {
    if (!window.queryLocalFonts) { api.toast('Embedding your fonts needs Chrome or Edge. Saving with standard PDF fonts.'); } else {
      try { source = await localFonts(); } catch { api.toast('Font access was not allowed. Saving with standard PDF fonts.'); }
    }
  }
  api.toast('Building PDF…');
  try {
    const r = await buildPdf({ source });
    api.download(r.blob, api.fileBase() + '.pdf');
    api.toast(`Saved a ${r.pages}-page PDF${r.lost ? `; ${r.lost} characters the PDF fonts lack were replaced with “?”` : ''}.`);
  } catch (e) {
    console.error(e);
    api.toast('Sorry, the PDF could not be built.');
  }
}

export function init(a) {
  api = a;
  const b = document.getElementById('bs-pdf-fonts');
  if (b && !window.queryLocalFonts) b.hidden = true;
  api.cmd('savePdf', () => savePdf(false));
  api.cmd('savePdfFonts', () => savePdf(true));
}
