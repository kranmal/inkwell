// Writes a real .docx (WordprocessingML in a zip) from the editor DOM.
import { gridOf } from './tables.js';
import { toPng, readCfg, PALETTE } from './objects.js';
import { chartXml, workbook } from './docxchart.js';
import { eqOmml } from './extras.js';
import { smartParts, smartItems } from './docxsmart.js';
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TW_MM = 56.6929;           // twips per mm
const EMU_PX = 9525;

export function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res(window[global]);
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

let cctx = null;
function hex(c) {
  if (!c || c === 'transparent' || c === 'inherit' || c === 'initial') return null;
  cctx = cctx || document.createElement('canvas').getContext('2d');
  cctx.fillStyle = '#010203';
  cctx.fillStyle = c;
  const v = cctx.fillStyle;
  if (v === '#010203' && !/^#?010203$/.test(c)) return null;
  if (v[0] === '#') return v.slice(1).toUpperCase();
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  if (p[3] === 0) return null;
  return p.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const pt = (v) => {
  if (!v) return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  if (/px$/.test(v)) return n * 0.75;
  if (/pt$/.test(v)) return n;
  if (/em$/.test(v)) return n * 11;
  return null;
};

function fontName(stack, fallback) {
  const first = (stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  if (!first || /^(-apple-system|system-ui|blinkmacsystemfont|sans-serif|serif|monospace|var\()/i.test(first)) return fallback;
  return first;
}

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'DIV', 'UL', 'OL', 'TABLE', 'HR', 'FIGURE', 'SECTION', 'ARTICLE', 'LI']);
const hasBlockChild = (el) => [...el.children].some((c) => BLOCKS.has(c.tagName));

async function prepareImages(root, maxPx, maxH = Infinity) {
  const map = new Map();
  let n = 0;
  for (const img of root.querySelectorAll('img')) {
    try {
      if (!img.complete) await img.decode().catch(() => {});
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) continue;
      let bytes, ext;
      const m = /^data:image\/(png|jpeg|jpg);base64,(.*)$/i.exec(img.src);
      if (m) {
        const bin = atob(m[2]);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
      } else {
        const c = document.createElement('canvas');
        c.width = nw; c.height = nh;
        c.getContext('2d').drawImage(img, 0, 0);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        if (!blob) continue;
        bytes = new Uint8Array(await blob.arrayBuffer());
        ext = 'png';
      }
      let w = parseFloat(img.style.width) || parseFloat(img.getAttribute('width')) || nw;
      if (/%$/.test(img.style.width)) w = (maxPx * parseFloat(img.style.width)) / 100;
      w = Math.min(w, maxPx, (maxH * nw) / nh);
      map.set(img, { bytes, ext, w, h: (w * nh) / nw, n: ++n });
    } catch { /* cross-origin or broken image: leave it out */ }
  }
  // Shapes and charts travel as pictures.
  for (const el of root.querySelectorAll('.chart, .shape')) {
    if (el.matches('.shape') || !readCfg(el)) { /* shapes are native too; fall through only when no chart data */ }
    if (el.matches('.shape') || (el.matches('.chart') && readCfg(el))) continue;
    try {
      const d = await toPng(el);
      if (!d) continue;
      const w = Math.min(d.w, maxPx, (maxH * d.w) / d.h);
      map.set(el, { bytes: d.bytes, ext: 'png', w, h: (w * d.h) / d.w, n: ++n });
    } catch { /* leave it out */ }
  }
  return map;
}

export async function exportDocx(root, { title = 'Document', page, hf = null, styles: docStyles = null, track = false, author = '', x = {} }) {
  const JSZip = await loadScript('vendor/jszip.min.js', 'JSZip');
  const contentMm = page.w - page.m.l - page.m.r;
  const contentTw = Math.round(contentMm * TW_MM);
  const images = await prepareImages(root, (contentMm / 25.4) * 96, ((page.h - page.m.t - page.m.b - 2) / 25.4) * 96);

  const rels = [];
  const nums = [];              // each entry: abstract id (1 bullets, 2 numbers)
  const rel = (type, target, external) => {
    rels.push({ type, target, external });
    return 'rId' + (rels.length + 2);    // rId1 styles, rId2 numbering
  };

  // ----- notes, comments and tracked changes -----
  let plain = false;            // inside notes/comments: no relationships (links, pictures)
  // A cell's own borders (top, left, bottom, right) from its inline style; sides it does not set are left to the table.
  const BSTYLE = { solid: 'single', dashed: 'dashed', dotted: 'dotted', double: 'double', none: 'nil', hidden: 'nil' };
  const cellBorders = (st) => {
    let o = '';
    for (const [css, tag] of [['Top', 'top'], ['Left', 'left'], ['Bottom', 'bottom'], ['Right', 'right']]) {
      const sty = st['border' + css + 'Style'];
      if (!sty) continue;
      const val = BSTYLE[sty] || 'single';
      if (val === 'nil') { o += `<w:${tag} w:val="nil"/>`; continue; }
      const px = parseFloat(st['border' + css + 'Width']) || 1;
      o += `<w:${tag} w:val="${val}" w:sz="${Math.min(96, Math.max(2, Math.round(px * 6)))}" w:space="0" w:color="${hex(st['border' + css + 'Color']) || 'auto'}"/>`;
    }
    return o ? `<w:tcBorders>${o}</w:tcBorders>` : '';
  };
  let annId = 0;
  const iso = (t) => { const d = new Date(Number(t) || Date.now()); return (isNaN(d) ? new Date() : d).toISOString().replace(/\.\d+Z$/, 'Z'); };
  const who = (el) => esc(el.dataset.author || author || 'Author');
  const notes = { fn: [], en: [] };
  const noteLi = (kind, id) => [...root.querySelectorAll(`ol.${kind === 'fn' ? 'footnotes' : 'endnotes'} > li`)].find((li) => li.dataset.fn === id);
  const comments = [];
  const cmSeen = new Map();     // comment id -> { n, left }
  for (const sp of root.querySelectorAll('span.cm')) {
    const c = cmSeen.get(sp.dataset.cm);
    if (c) c.left++; else cmSeen.set(sp.dataset.cm, { n: null, left: 1 });
  }

  // ----- runs -----
  function rPr(f) {
    let x = '';
    if (f.link) x += '<w:rStyle w:val="Hyperlink"/>';
    if (f.font) x += `<w:rFonts w:ascii="${esc(f.font)}" w:hAnsi="${esc(f.font)}" w:cs="${esc(f.font)}"/>`;
    if (f.b) x += '<w:b/>';
    if (f.i) x += '<w:i/>';
    if (f.strike) x += '<w:strike/>';
    if (f.color) x += `<w:color w:val="${f.color}"/>`;
    if (f.size) x += `<w:sz w:val="${Math.round(f.size * 2)}"/><w:szCs w:val="${Math.round(f.size * 2)}"/>`;
    if (f.u) x += '<w:u w:val="single"/>';
    if (f.hl) x += `<w:shd w:val="clear" w:color="auto" w:fill="${f.hl}"/>`;
    if (f.vert) x += `<w:vertAlign w:val="${f.vert}"/>`;
    return x ? `<w:rPr>${x}</w:rPr>` : '';
  }

  function textRun(text, f) {
    if (!text) return '';
    let body = '';
    for (const part of text.split(/(\t|\n)/)) {
      if (part === '\t') body += '<w:tab/>';
      else if (part === '\n') body += '<w:br/>';
      else if (part) body += f.del ? `<w:delText xml:space="preserve">${esc(part)}</w:delText>` : `<w:t xml:space="preserve">${esc(part)}</w:t>`;
    }
    return `<w:r>${rPr(f)}${body}</w:r>`;
  }

  // ----- editable objects: charts, shapes, text boxes -----
  const charts = [];
  let drawN = 500;
  // A chart or text box floated left or right in Inkwell is written as an anchored drawing with square wrapping, so Word wraps text beside it.
  function floatAnchor(el, xml, cx) {
    const side = el.style.float;
    if ((side !== 'left' && side !== 'right') || cx > contentMm / 25.4 * 96 * EMU_PX * 0.7) return xml;
    return xml.replace(/<wp:inline [^>]*>/, `<wp:anchor distT="38100" distB="76200" distL="${side === 'right' ? 133350 : 0}" distR="${side === 'left' ? 133350 : 0}" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>${side}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>`)
      .replace(/(<wp:extent [^>]*\/>)/, '$1<wp:wrapSquare wrapText="bothSides"/>').replace('</wp:inline>', '</wp:anchor>');
  }
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  function chartRun(el) {
    const cfg = readCfg(el);
    if (!cfg || plain) return null;
    const n = charts.push(cfg);
    const id = rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', `charts/chart${n}.xml`);
    const w = Math.min(contentMm / 25.4 * 96, parseFloat(el.style.width) || 640), h = w * 360 / 640;
    const cx = Math.round(w * EMU_PX), cy = Math.round(h * EMU_PX), k = ++drawN;
    return floatAnchor(el, `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${k}" name="Chart ${n}" descr="${esc(cfg.title || 'Chart')}"/><wp:cNvGraphicFramePr/><a:graphic ${A}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${id}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, cx);
  }
  const smarts = [];
  function smartRun(el) {
    let cfg = null;
    try { cfg = JSON.parse(el.dataset.sa || ''); } catch { /* no data */ }
    if (!cfg || plain || !smartItems(cfg).length) return null;
    const n = smarts.length + 1, R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const w = Math.min(contentMm / 25.4 * 96, parseFloat(el.style.width) || 640);
    const dm = rel(`${R}/diagramData`, `diagrams/data${n}.xml`), lo = rel(`${R}/diagramLayout`, `diagrams/layout${n}.xml`);
    const qs = rel(`${R}/diagramQuickStyle`, `diagrams/quickStyle${n}.xml`), cs = rel(`${R}/diagramColors`, `diagrams/colors${n}.xml`);
    const dr = rel('http://schemas.microsoft.com/office/2007/relationships/diagramDrawing', `diagrams/drawing${n}.xml`);
    const parts = smartParts(cfg, w, EMU_PX, dr, n);
    smarts.push(parts);
    const cx = Math.round(w * EMU_PX), cy = Math.round(w * parts.ratio * EMU_PX), k = ++drawN;
    const label = `${cfg.kind || 'process'}: ${smartItems(cfg).join(', ')}`;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${k}" name="Diagram ${n}" descr="${esc(label)}"/><wp:cNvGraphicFramePr/><a:graphic ${A}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="${dm}" r:lo="${lo}" r:qs="${qs}" r:cs="${cs}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  const PRESET = { rect: 'rect', round: 'roundRect', ellipse: 'ellipse', tri: 'triangle', arrow: 'rightArrow', line: 'rect', star: 'star5' };
  function shapeRun(el) {
    if (plain) return '';
    const kind = Object.keys(PRESET).find((q) => el.classList.contains('shape-' + q)) || 'rect';
    const w = Math.max(4, parseFloat(el.style.width) || el.offsetWidth || 100), h = Math.max(2, parseFloat(el.style.height) || el.offsetHeight || 60);
    const cx = Math.round(w * EMU_PX), cy = Math.round(h * EMU_PX), k = ++drawN;
    const fill = hex(el.style.backgroundColor) || '2A78D6';
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${k}" name="Shape ${k}"/><wp:cNvGraphicFramePr/><a:graphic ${A}><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${PRESET[kind]}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  function imageRun(img) {
    const d = images.get(img);
    if (!d || plain) return '';
    const id = rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/image${d.n}.${d.ext}`);
    const cx = Math.round(d.w * EMU_PX), cy = Math.round(d.h * EMU_PX);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${d.n}" name="Picture ${d.n}" descr="${esc(img.alt || '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${d.n}" name="image${d.n}.${d.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  function fmt(el, f) {
    const g = { ...f };
    const t = el.tagName, s = el.style;
    if (t === 'B' || t === 'STRONG') g.b = true;
    if (t === 'I' || t === 'EM') g.i = true;
    if (t === 'U') g.u = true;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') g.strike = true;
    if (t === 'SUB') g.vert = 'subscript';
    if (t === 'SUP') g.vert = 'superscript';
    if (t === 'CODE') g.font = 'Consolas';
    if (t === 'MARK') g.hl = 'FFF59D';
    if (t === 'FONT') {
      if (el.color) g.color = hex(el.color) || g.color;
      if (el.face) g.font = fontName(el.face, g.font);
    }
    if (s.fontWeight) g.b = s.fontWeight === 'bold' || parseInt(s.fontWeight, 10) >= 600;
    if (s.fontStyle) g.i = s.fontStyle === 'italic';
    const deco = s.textDecorationLine || s.textDecoration || '';
    if (deco.includes('underline')) g.u = true;
    if (deco.includes('line-through')) g.strike = true;
    if (s.color) g.color = hex(s.color) || g.color;
    if (s.backgroundColor) g.hl = hex(s.backgroundColor);
    if (s.fontSize) g.size = pt(s.fontSize) || g.size;
    if (s.fontFamily) g.font = fontName(s.fontFamily, g.font);
    if (s.verticalAlign === 'sub') g.vert = 'subscript';
    if (s.verticalAlign === 'super') g.vert = 'superscript';
    return g;
  }

  function inline(node, f) {
    if (node.nodeType === 3) return textRun(node.data, f);
    if (node.nodeType !== 1) return '';
    const t = node.tagName;
    if (t === 'BR') {
      // A break that ends its block is only the browser's placeholder, not a real line break.
      for (let n = node; n && n !== root; n = n.parentNode) {
        if (n.nextSibling) return /^(P|H[1-6]|LI|TD|TH|DIV|BLOCKQUOTE|PRE|UL|OL|TABLE)$/.test(n.nextSibling.nodeName) ? '' : '<w:r><w:br/></w:r>';
        if (/^(P|H[1-6]|LI|TD|TH|DIV|BLOCKQUOTE|PRE)$/.test(n.parentNode.nodeName)) return '';
      }
      return '';
    }
    if (t === 'IMG') return imageRun(node);
    if (t === 'UL' || t === 'OL' || t === 'TABLE') return '';
    const cl = node.classList;
    if (cl.contains('shape')) return shapeRun(node);
    if (cl.contains('chart')) return chartRun(node) || imageRun(node);
    if (cl.contains('smartart')) return smartRun(node) || '';
    if (t === 'SPAN' && cl.contains('idx')) return '';
    if (t === 'SPAN' && cl.contains('eq')) {
      if (!plain && node.dataset.eq) { try { return eqOmml(node.dataset.eq); } catch { /* fall back to text */ } }
      return textRun(node.dataset.eq || node.textContent, f);
    }
    if (t === 'SPAN' && cl.contains('wordart')) return kids(node, { ...f, b: true, size: Math.round((parseFloat(node.style.fontSize) || 14) * 2), color: hex(node.dataset.c) || '2A78D6' });
    if (t === 'SUP' && (cl.contains('fn-ref') || cl.contains('en-ref'))) {
      if (plain) return '';
      const kind = cl.contains('fn-ref') ? 'fn' : 'en';
      const li = noteLi(kind, node.dataset.fn);
      if (!li) return '';
      notes[kind].push(li);
      return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:${kind === 'fn' ? 'footnote' : 'endnote'}Reference w:id="${notes[kind].length}"/></w:r>`;
    }
    if (t === 'SPAN' && cl.contains('fc') && !plain) {
      // Table shading, borders and column widths are marked in the page only: Word has no run-level record of them.
      if ('cellStyle' in node.dataset || 'cellSpan' in node.dataset || 'tableClass' in node.dataset || 'tableCols' in node.dataset || 'hfKey' in node.dataset) return kids(node, f);
      // Tracked formatting: the runs carry the new look; w:rPrChange holds what they looked like before.
      const tmp = document.createElement('div');
      tmp.innerHTML = node.dataset.was || '';
      let n = tmp, f0 = f;
      while (n.firstChild) { n = n.firstChild; }
      const chain = [];
      for (let e = n.nodeType === 1 ? n : n.parentNode; e && e !== tmp; e = e.parentNode) chain.unshift(e);
      for (const e of chain) f0 = fmt(e, f0);
      const old = rPr(f0).replace(/^<w:rPr>|<\/w:rPr>$/g, '');
      const change = () => `<w:rPrChange w:id="${++annId}" w:author="${who(node)}" w:date="${iso(node.dataset.time)}"><w:rPr>${old}</w:rPr></w:rPrChange>`;
      return kids(node, f).replace(/<w:r>(?:<w:rPr>(.*?)<\/w:rPr>)?/g, (m, inner) => `<w:r><w:rPr>${inner || ''}${change()}</w:rPr>`);
    }
    if (cl.contains('tc') && (t === 'INS' || t === 'DEL') && !plain) {
      const tag = t === 'INS' ? 'ins' : 'del';
      const runs = kids(node, t === 'DEL' ? { ...f, del: true } : f);
      return runs ? `<w:${tag} w:id="${++annId}" w:author="${who(node)}" w:date="${iso(node.dataset.time)}">${runs}</w:${tag}>` : '';
    }
    if (t === 'SPAN' && cl.contains('cm') && !plain) {
      const c = cmSeen.get(node.dataset.cm);
      let pre = '', post = '';
      if (c.n === null) {
        c.n = ++annId;
        comments.push({ n: c.n, author: who(node), date: iso(node.dataset.time), text: node.dataset.text || '' });
        pre = `<w:commentRangeStart w:id="${c.n}"/>`;
      }
      if (--c.left === 0) post = `<w:commentRangeEnd w:id="${c.n}"/><w:r><w:commentReference w:id="${c.n}"/></w:r>`;
      return pre + kids(node, f) + post;
    }
    let g = fmt(node, f);
    if (plain && t === 'A') return kids(node, g);
    if (t === 'A' && /^(https?:|mailto:)/i.test(node.getAttribute('href') || '')) {
      g = { ...g, link: true };
      const id = rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', node.getAttribute('href'), true);
      return `<w:hyperlink r:id="${id}">${kids(node, g)}</w:hyperlink>`;
    }
    return kids(node, g);
  }
  const kids = (el, f) => [...el.childNodes].map((n) => inline(n, f)).join('');

  // ----- paragraphs -----
  function pPr(el, env) {
    const s = el.style || {};
    const t = el.tagName;
    const cl = el.classList || { contains: () => false };
    let style = '';
    if (/^H[1-3]$/.test(t)) style = 'Heading' + t[1];
    else if (/^H[4-6]$/.test(t)) style = 'Heading3';
    else if (cl.contains('doc-title')) style = 'Title';
    else if (cl.contains('doc-subtitle')) style = 'Subtitle';
    else if (cl.contains('quote') || t === 'BLOCKQUOTE' || env.quote) style = 'Quote';
    else if (cl.contains('no-spacing')) style = 'NoSpacing';
    else if (t === 'PRE') style = 'Code';
    const cs = [...(el.classList || [])].find((c) => /^cs-/.test(c));
    if (cs && customIds.has(cs.slice(3))) style = 'Custom' + cs.slice(3).replace(/[^A-Za-z0-9]/g, '');
    let x = style ? `<w:pStyle w:val="${style}"/>` : '';
    if (env.list) x += `<w:numPr><w:ilvl w:val="${Math.min(env.list.lvl, 8)}"/><w:numId w:val="${env.list.numId}"/></w:numPr>`;
    const sp = [];
    const before = pt(s.marginTop), after = pt(s.marginBottom);
    if (before != null) sp.push(`w:before="${Math.round(before * 20)}"`);
    if (after != null) sp.push(`w:after="${Math.round(after * 20)}"`);
    if (s.lineHeight && /^[\d.]+$/.test(s.lineHeight)) sp.push(`w:line="${Math.round(parseFloat(s.lineHeight) * 240)}" w:lineRule="auto"`);
    if (sp.length) x += `<w:spacing ${sp.join(' ')}/>`;
    const left = pt(s.marginLeft);
    if (left && !env.list) x += `<w:ind w:left="${Math.round(left * 20)}"/>`;
    const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[s.textAlign];
    if (jc) x += `<w:jc w:val="${jc}"/>`;
    return x ? `<w:pPr>${x}</w:pPr>` : '';
  }

  // A paragraph that is wholly an insertion or a deletion has its paragraph mark tracked too, so accepting or rejecting in Word
  // removes the paragraph instead of leaving an empty one behind.
  const para = (el, env, runs) => {
    let p = pPr(el, env);
    const kidsOf = [...el.childNodes].filter((n) => n.nodeType !== 3 || n.data.trim());
    const first = kidsOf[0];
    if (first && first.nodeType === 1 && first.matches('ins.tc,del.tc') && kidsOf.every((n) => n.nodeType === 1 && n.matches(first.tagName === 'INS' ? 'ins.tc' : 'del.tc'))) {
      const tag = first.tagName === 'INS' ? 'ins' : 'del';
      const mark = `<w:rPr><w:${tag} w:id="${++annId}" w:author="${who(first)}" w:date="${iso(first.dataset.time)}"/></w:rPr>`;
      p = p ? p.replace('</w:pPr>', mark + '</w:pPr>') : `<w:pPr>${mark}</w:pPr>`;
    }
    return `<w:p>${p}${runs}</w:p>`;
  };

  function list(el, env) {
    const lvl = env.list ? env.list.lvl + 1 : 0;
    let numId;
    if (el.tagName === 'UL') numId = 1;
    else if (env.list && env.list.ordered) numId = env.list.numId;
    else { nums.push(2); numId = nums.length + 1; }
    const sub = { ...env, list: { numId, lvl, ordered: el.tagName === 'OL' } };
    let out = '';
    for (const li of el.children) {
      if (li.tagName !== 'LI') { out += block(li, sub); continue; }
      let runs = '', later = '';
      for (const n of li.childNodes) {
        if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) later += list(n, sub);
        else if (n.nodeType === 1 && BLOCKS.has(n.tagName) && n.tagName !== 'LI') runs += kids(n, {});
        else runs += inline(n, {});
      }
      out += para(li, sub, runs) + later;
    }
    return out;
  }

  function table(el) {
    const g = gridOf(el);
    if (!g.nRows || !g.nCols) return '';
    const cl = el.classList;
    const cols = [...el.querySelectorAll(':scope > colgroup > col')].map((c) => parseFloat(c.style.width));
    const even = Math.floor(contentTw / g.nCols);
    const cw = cols.length === g.nCols && cols.every((w) => w > 0)
      ? cols.map((w) => Math.round((contentTw * w) / cols.reduce((x, y) => x + y, 0))) : Array(g.nCols).fill(even);
    const on = (k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    const off = (k) => `<w:${k} w:val="nil"/>`;
    const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
    const show = cl.contains('tb-none') || cl.contains('tb-striped') ? [] : cl.contains('tb-outer') ? ['top', 'left', 'bottom', 'right']
      : cl.contains('tb-horizontal') ? ['top', 'bottom', 'insideH'] : sides;
    let x = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${sides.map((k) => (show.includes(k) ? on(k) : off(k))).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cw.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    const repHead = cl.contains('rep-head');
    let lead = true;
    // A split: the cells under a cell whose old merge was taller than it is now were continuations of it, so each records that as its old state.
    const freed = new Map();
    for (const cell of new Set(g.grid.flat())) {
      if (!cell) continue;
      const p0 = g.pos.get(cell), m0 = [...cell.children].find((e) => e.matches('span.fc') && 'cellSpan' in e.dataset);
      if (!m0) continue;
      const wrs = Number(m0.dataset.cellSpan.split(',')[1]) || 1;
      for (let k = p0.rs; k < wrs; k++) {
        const t = g.grid[p0.r + k] && g.grid[p0.r + k][p0.c];
        if (t && g.pos.get(t).r === p0.r + k && g.pos.get(t).c === p0.c) freed.set(t, { mark: m0, wrs, k });
      }
    }
    for (let r = 0; r < g.nRows; r++) {
      const tr = g.rows[r];
      const headRow = tr.cells.length && [...tr.cells].every((c) => c.tagName === 'TH');
      if (!headRow) lead = false;
      x += `<w:tr>${headRow && (r === 0 || (repHead && lead)) ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`;
      for (let c = 0; c < g.nCols; c++) {
        const cell = g.grid[r][c];
        if (!cell) { x += `<w:tc><w:tcPr><w:tcW w:w="${cw[c]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`; continue; }
        const p = g.pos.get(cell);
        if (p.c !== c) continue;
        const width = cw.slice(c, c + p.cs).reduce((a2, b2) => a2 + b2, 0);
        const head = cell.tagName === 'TH';
        const dflt = head ? 'F2F2F0' : cl.contains('tb-striped') && tr.rowIndex % 2 === 1 ? 'F3F5F4' : null;
        const fill = hex(cell.style.backgroundColor) || dflt;
        // Cell properties in schema order: width, merge, borders, shading.
        const props = (cs, rs, st, shade, cont = p.r !== r) => {
          let o = `<w:tcW w:w="${width}" w:type="dxa"/>`;
          if (cs > 1) o += `<w:gridSpan w:val="${cs}"/>`;
          if (rs > 1) o += cont ? '<w:vMerge/>' : '<w:vMerge w:val="restart"/>';
          o += cellBorders(st);
          if (shade) o += `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`;
          return o;
        };
        let pr = props(p.cs, p.rs, cell.style, fill);
        // A Compare mark on the cell holds its old look: shading, single-side borders and merging are written as a tracked cell-property change.
        const mark = [...cell.children].find((e) => e.matches('span.fc') && ('cellStyle' in e.dataset || 'cellSpan' in e.dataset));
        // Rows below a merged cell's top carry only the span change (its old state in that row).
        const look = mark && (p.r === r || ('cellSpan' in mark.dataset && p.c === c)) ? mark : null;
        if (look) {
          const tmp = document.createElement('i');
          tmp.setAttribute('style', 'cellStyle' in look.dataset ? look.dataset.cellStyle : cell.getAttribute('style') || '');
          const was = hex(tmp.style.backgroundColor) || dflt;
          const [wcs, wrs] = 'cellSpan' in look.dataset ? look.dataset.cellSpan.split(',').map(Number) : [p.cs, p.rs];
          const below = r - p.r;
          const old = below ? (wrs > below ? props(wcs, wrs, cell.style, fill, true) : props(wcs, 1, cell.style, fill, false)) : props(wcs, wrs, tmp.style, was);
          if (old !== pr) pr += `<w:tcPrChange w:id="${++annId}" w:author="${who(look)}" w:date="${iso(look.dataset.time)}"><w:tcPr>${old}</w:tcPr></w:tcPrChange>`;
        }
        const fr = freed.get(cell);
        if (fr && !look) {
          const old = props(p.cs, fr.wrs, cell.style, fill, true);
          if (old !== pr) pr += `<w:tcPrChange w:id="${++annId}" w:author="${who(fr.mark)}" w:date="${iso(fr.mark.dataset.time)}"><w:tcPr>${old}</w:tcPr></w:tcPrChange>`;
        }
        let inner = '<w:p/>';
        if (p.r === r) {
          inner = hasBlockChild(cell) ? blocks(cell, { cell: true }) : para(cell, {}, kids(cell, head ? { b: true } : {}));
          if (!/<\/w:p>$/.test(inner)) inner += '<w:p/>';
        }
        x += `<w:tc><w:tcPr>${pr}</w:tcPr>${inner}</w:tc>`;
      }
      x += '</w:tr>';
    }
    return x + '</w:tbl>';
  }

  function toc(el) {
    const rows = [...el.querySelectorAll('[data-i]')];
    const titleEl = el.querySelector('.toc-title'), isFig = !!el.dataset.kind;
    let out = `<w:p><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr>${textRun(titleEl ? titleEl.textContent : 'Contents', { b: true, size: 14 })}</w:p>`;
    if (!rows.length) return out;
    const fld = (k) => `<w:r><w:fldChar w:fldCharType="${k}"/></w:r>`;
    rows.forEach((row, i) => {
      const lvl = Number(row.className.slice(-1)) || 1;
      const t = row.querySelector('.toc-t'), pg = row.querySelector('.toc-pg');
      out += `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${contentTw}"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="${(lvl - 1) * 280}"/></w:pPr>`
        + (i === 0 && !isFig ? fld('begin') + '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' + fld('separate') : '')
        + textRun((t || row).textContent, {}) + '<w:r><w:tab/></w:r>' + textRun(pg ? pg.textContent : '', {})
        + (i === rows.length - 1 && !isFig ? fld('end') : '') + '</w:p>';
    });
    return out;
  }

  function textbox(el) {
    const wpx = Math.min(contentMm / 25.4 * 96, parseFloat(el.style.width) || el.offsetWidth || 260);
    const hpx = Math.max(30, el.offsetHeight || 60);
    let inner = blocks(el, { cell: true });
    if (!/<\/w:p>$/.test(inner)) inner += '<w:p/>';
    const cx = Math.round(wpx * EMU_PX), cy = Math.round(hpx * EMU_PX), k = ++drawN;
    const bg = hex(el.style.backgroundColor);
    const bst = el.style.borderTopStyle, bw = parseFloat(el.style.borderTopWidth), bcol = hex(el.style.borderTopColor) || '9A9A9A';
    const ln = bst === 'none' ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${Math.round((bw > 0 ? bw : 1) * 9525)}"><a:solidFill><a:srgbClr val="${bcol}"/></a:solidFill></a:ln>`;
    return floatAnchor(el, `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${k}" name="Text Box ${k}"/><wp:cNvGraphicFramePr/><a:graphic ${A}><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${bg ? `<a:solidFill><a:srgbClr val="${bg}"/></a:solidFill>` : '<a:noFill/>'}${ln}</wps:spPr><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx><wps:bodyPr lIns="91440" tIns="45720" rIns="91440" bIns="45720"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`, cx);
  }

  function block(el, env) {
    const t = el.tagName;
    const c0 = el.classList;
    if (c0.contains('footnotes') || c0.contains('endnotes')) return '';
    if (c0.contains('toc')) return toc(el);
    if (c0.contains('chart')) return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${chartRun(el) || imageRun(el)}</w:p>`;
    if (c0.contains('textbox')) return textbox(el);
    if (c0.contains('smartart')) return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${smartRun(el) || ''}</w:p>`;
    if (c0.contains('index-row')) {
      const sub = c0.contains('index-sub');
      const [a, b] = [...el.children];
      return `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${contentTw}"/></w:tabs><w:spacing w:after="40"/><w:ind w:left="${sub ? 360 : 0}"/></w:pPr>${textRun(a ? a.textContent : el.textContent, {})}${b ? '<w:r><w:tab/></w:r>' + textRun(b.textContent, {}) : ''}</w:p>`;
    }
    if (t === 'UL' || t === 'OL') return list(el, env);
    if (t === 'TABLE') return table(el);
    if (t === 'HR') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>';
    if (c0.contains('sect-break')) {
      let d = {};
      try { d = JSON.parse(el.dataset.sect || '{}') || {}; } catch { /* default section */ }
      breaks.push(d);
      return `<w:p><w:pPr>%%SB${breaks.length - 1}%%</w:pPr></w:p>`;
    }
    if (el.classList.contains('page-break')) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (t === 'IMG') return `<w:p>${imageRun(el)}</w:p>`;
    if (hasBlockChild(el)) return blocks(el, t === 'BLOCKQUOTE' ? { ...env, quote: true } : env);
    return para(el, env, kids(el, {}));
  }

  function blocks(container, env) {
    let out = '', loose = '';
    const flush = () => { if (loose) { out += `<w:p>${loose}</w:p>`; loose = ''; } };
    for (const n of container.childNodes) {
      if (n.nodeType === 1 && (BLOCKS.has(n.tagName) || n.classList.contains('page-break'))) { flush(); out += block(n, env); }
      else if (n.nodeType === 3 && !n.data.trim()) continue;
      else loose += inline(n, {});
    }
    flush();
    return out;
  }

  const custom = (docStyles && Array.isArray(docStyles.custom) ? docStyles.custom : []).filter((c) => c && c.id);
  const customIds = new Set(custom.map((c) => String(c.id)));
  const over = (docStyles && docStyles.overrides) || {};
  const breaks = [];
  const body = blocks(root, {});

  // Notes and comments are written after the body, which is where they are discovered.
  plain = true;
  const noteXml = (kind) => {
    const tag = kind === 'fn' ? 'footnote' : 'endnote';
    const sep = `<w:${tag} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${tag}><w:${tag} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>`;
    const items = notes[kind].map((li, i) => `<w:${tag} w:id="${i + 1}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:${tag}Ref/></w:r>${textRun(' ', { size: 10 })}${kids(li, { size: 10 })}</w:p></w:${tag}>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag}s ${NS}>${sep}${items}</w:${tag}s>`;
  };
  const footnotesXml = notes.fn.length ? noteXml('fn') : '';
  const endnotesXml = notes.en.length ? noteXml('en') : '';
  const initials = (n) => n.split(/\s+/).map((w) => w[0] || '').join('').slice(0, 3).toUpperCase();
  const commentsXml = comments.length ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${NS}>${comments.map((c) => `<w:comment w:id="${c.n}" w:author="${c.author}" w:date="${c.date}" w:initials="${initials(c.author)}"><w:p>${textRun(c.text, {})}</w:p></w:comment>`).join('')}</w:comments>` : '';
  plain = false;

  // Header and footer: left, centre and right slots on one line.
  const H = hf || {};
  const field = (code) => `<w:r>${GREY}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${GREY}<w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r>${GREY}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${GREY}<w:t>1</w:t></w:r><w:r>${GREY}<w:fldChar w:fldCharType="end"/></w:r>`;
  const GREY = '<w:rPr><w:color w:val="6B6B6B"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
  const txt = (t) => `<w:r>${GREY}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const numRuns = (H) => (H.numFormat === 'page' ? txt('Page ') + field('PAGE') : H.numFormat === 'of' ? txt('Page ') + field('PAGE') + txt(' of ') + field('NUMPAGES') : field('PAGE'));
  function zone(which, H) {
    const slots = { left: [], center: [], right: [] };
    const text = (H[which] || '').trim();
    if (text) (slots[H[which + 'Align']] || slots.left).push(txt(text));
    if (H.num && H.num !== 'none') {
      const [z, a] = H.num.split('-');
      if ((z === 'top') === (which === 'header') && slots[a]) slots[a].push(numRuns(H));
    }
    if (!slots.left.length && !slots.center.length && !slots.right.length) return '';
    const join = (a) => a.join(txt(' · '));
    const tag = which === 'header' ? 'hdr' : 'ftr';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${NS}><w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="${Math.round(contentTw / 2)}"/><w:tab w:val="right" w:pos="${contentTw}"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${join(slots.left)}<w:r><w:tab/></w:r>${join(slots.center)}<w:r><w:tab/></w:r>${join(slots.right)}</w:p></w:${tag}>`;
  }
  const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  // One entry per section: the first runs up to the first section break, and each break starts the next.
  const emptyPart = (tag) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${NS}><w:p/></w:${tag}>`;
  const secDefs = [{ H, landscape: !!page.landscape, restart: null, m: page.m }];
  for (const d of breaks) {
    const prev = secDefs[secDefs.length - 1];
    const eff = { ...prev.H };
    if (d.header !== undefined) eff.header = d.header;
    if (d.footer !== undefined) eff.footer = d.footer;
    const pm = d.margins && page.presets && page.presets[d.margins];
    secDefs.push({ H: eff, m: pm ? { t: pm[0], r: pm[1], b: pm[2], l: pm[3] } : prev.m, landscape: d.landscape === undefined ? prev.landscape : !!d.landscape, restart: d.restart != null && d.restart !== '' ? Number(d.restart) : null });
  }
  for (const sd of secDefs) { sd.hx = zone('header', sd.H); sd.fx = zone('footer', sd.H); }
  // A different first page: its own header and footer text (page numbers stay off it).
  const FH = H.firstDiff ? { ...H, header: H.firstHeader || '', footer: H.firstFooter || '', num: 'none' } : null;
  const firstHx = FH ? zone('header', FH) : '', firstFx = FH ? zone('footer', FH) : '';
  const anyHdr = secDefs.some((sd) => sd.hx) || !!firstHx, anyFtr = secDefs.some((sd) => sd.fx) || !!firstFx;
  const parts = [];             // header/footer parts: { file, kind, xml }
  const partRel = (kind, xml) => {
    let p = parts.find((q) => q.kind === kind && q.xml === xml);
    if (!p) {
      const n = parts.filter((q) => q.kind === kind).length + 1;
      p = { kind, xml, file: kind + n, id: rel(RT + kind, kind + n + '.xml') };
      parts.push(p);
    }
    return p.id;
  };
  const longSide = Math.max(page.w, page.h), shortSide = Math.min(page.w, page.h);
  const tw = (mm) => Math.round(mm * TW_MM);
  const sectPr = (sd, first) => {
    let refs = '';
    if (anyHdr) refs += `<w:headerReference w:type="default" r:id="${partRel('header', sd.hx || emptyPart('hdr'))}"/>`;
    if (anyFtr) refs += `<w:footerReference w:type="default" r:id="${partRel('footer', sd.fx || emptyPart('ftr'))}"/>`;
    if (first && H.firstDiff) {
      if (anyHdr) refs += `<w:headerReference w:type="first" r:id="${partRel('header', firstHx || emptyPart('hdr'))}"/>`;
      if (anyFtr) refs += `<w:footerReference w:type="first" r:id="${partRel('footer', firstFx || emptyPart('ftr'))}"/>`;
    }
    const [pw, ph] = sd.landscape ? [longSide, shortSide] : [shortSide, longSide];
    const cols = page.cols || 1;
    return `<w:sectPr>${refs}<w:type w:val="nextPage"/><w:pgSz w:w="${tw(pw)}" w:h="${tw(ph)}"${sd.landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(sd.m.t)}" w:right="${tw(sd.m.r)}" w:bottom="${tw(sd.m.b)}" w:left="${tw(sd.m.l)}" w:header="708" w:footer="708" w:gutter="0"/>${sd.restart != null ? `<w:pgNumType w:start="${sd.restart}"/>` : ''}<w:cols w:num="${cols}" w:space="708"/>${first && H.firstDiff && refs ? '<w:titlePg/>' : ''}</w:sectPr>`;
  };
  let bodyXml = body;
  breaks.forEach((d, i) => { bodyXml = bodyXml.replace(`%%SB${i}%%`, sectPr(secDefs[i], i === 0)); });
  const sect = sectPr(secDefs[secDefs.length - 1], secDefs.length === 1).replace('<w:type w:val="nextPage"/>', '');
  if (footnotesXml) rel(RT + 'footnotes', 'footnotes.xml');
  if (endnotesXml) rel(RT + 'endnotes', 'endnotes.xml');
  if (commentsXml) rel(RT + 'comments', 'comments.xml');
  rel(RT + 'settings', 'settings.xml');
  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}>${track ? '<w:trackRevisions/>' : ''}${x && x.protect && x.protect.on ? '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>' : ''}${footnotesXml ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}${endnotesXml ? '<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>' : ''}</w:settings>`;

  // ----- package parts -----
  const cs = getComputedStyle(root);
  const bodyFont = fontName(cs.getPropertyValue('--doc-font'), 'Calibri');
  const headFont = fontName(cs.getPropertyValue('--head-font'), bodyFont);
  const headColor = hex(cs.getPropertyValue('--head-color').trim()) || '1F1F1F';
  const accent = hex(cs.getPropertyValue('--doc-accent').trim()) || '0F766E';
  const baseHalf = Math.round((parseFloat(cs.fontSize) || 14.67) * 0.75 * 2);

  // One paragraph style from a set of defaults plus whatever the user changed in "Modify styles".
  const okHex = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.slice(1).toUpperCase() : null);
  const n0 = (v) => { const n = parseFloat(v); return v !== '' && v != null && isFinite(n) && n >= 0 && n <= 200 ? n : null; };
  function pstyle(id, name, d, o = {}, isDefault = false) {
    const font = o.font ? fontName(o.font, d.font) : d.font;
    const size = n0(o.size) || d.size;
    const color = okHex(o.color) || d.color;
    const bold = o.bold === 'bold' ? true : o.bold === 'normal' ? false : d.bold;
    const italic = o.italic === 'italic' ? true : o.italic === 'normal' ? false : d.italic;
    const before = n0(o.before) != null ? n0(o.before) * 20 : d.before, after = n0(o.after) != null ? n0(o.after) * 20 : d.after;
    const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[o.align];
    const sp = [before != null ? `w:before="${Math.round(before)}"` : '', after != null ? `w:after="${Math.round(after)}"` : '', d.line ? `w:line="${d.line}" w:lineRule="auto"` : ''].filter(Boolean).join(' ');
    const ppr = (d.keepNext ? '<w:keepNext/>' : '') + (d.pBdr || '') + (d.shd || '') + (sp ? `<w:spacing ${sp}/>` : '') + (d.ind ? `<w:ind w:left="${d.ind}"/>` : '') + (jc ? `<w:jc w:val="${jc}"/>` : '') + (d.outline != null ? `<w:outlineLvl w:val="${d.outline}"/>` : '');
    const rpr = (font ? `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/>` : '')
      + (bold === true ? '<w:b/>' : bold === false && !isDefault ? '<w:b w:val="0"/>' : '') + (italic === true ? '<w:i/>' : italic === false && !isDefault ? '<w:i w:val="0"/>' : '')
      + (color ? `<w:color w:val="${color}"/>` : '') + (size ? `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>` : '');
    return `<w:style w:type="paragraph"${isDefault ? ' w:default="1"' : ''} w:styleId="${id}"><w:name w:val="${esc(name)}"/>${isDefault ? '' : '<w:basedOn w:val="Normal"/>'}${d.next ? '<w:next w:val="Normal"/>' : ''}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
  }
  const hd = (lvl, size) => ({ font: headFont, bold: true, color: headColor, size, before: 360, after: 120, line: 288, keepNext: true, outline: lvl, next: true });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(bodyFont)}" w:hAnsi="${esc(bodyFont)}" w:cs="${esc(bodyFont)}"/><w:sz w:val="${baseHalf}"/><w:szCs w:val="${baseHalf}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + pstyle('Normal', 'Normal', {}, over.normal, true)
    + pstyle('Heading1', 'heading 1', hd(0, 20), over.h1) + pstyle('Heading2', 'heading 2', hd(1, 15), over.h2) + pstyle('Heading3', 'heading 3', hd(2, 12.5), over.h3)
    + pstyle('Title', 'Title', { font: headFont, bold: true, color: '141414', size: 30, after: 80, line: 264, next: true }, over.title)
    + pstyle('Subtitle', 'Subtitle', { font: headFont, color: '6B6B6B', size: 14, after: 360, next: true }, over.subtitle)
    + pstyle('Quote', 'Quote', { italic: true, color: '444444', before: 200, after: 200, ind: 600, pBdr: `<w:pBdr><w:left w:val="single" w:sz="16" w:space="12" w:color="${accent}"/></w:pBdr>` }, over.quote)
    + custom.map((c) => pstyle('Custom' + String(c.id).replace(/[^A-Za-z0-9]/g, ''), c.name || 'Custom style', {}, c.props || {})).join('')
    + '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F2"/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>'
    + `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="${accent}"/><w:u w:val="single"/></w:rPr></w:style>`
    + '</w:styles>';

  const bullets = ['•', '◦', '▪'], fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
  const lvls = (ordered) => Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? fmts[i % 3] : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : bullets[i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>${nums.map((a, i) => `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="${a}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml || '<w:p/>'}${sect}</w:body></w:document>`;

  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>${rels.map((r, i) => `<Relationship Id="rId${i + 3}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const part = (on, file, kind = file) => (on ? `<Override PartName="/word/${file}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>` : '');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + smarts.map((_, i) => [['data', 'diagramData'], ['layout', 'diagramLayout'], ['quickStyle', 'diagramStyle'], ['colors', 'diagramColors']].map(([f, t]) => `<Override PartName="/word/diagrams/${f}${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.${t}+xml"/>`).join('') + `<Override PartName="/word/diagrams/drawing${i + 1}.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/>`).join('')
    + charts.map((_, i) => `<Override PartName="/word/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('')
    + part(true, 'settings') + parts.map((q) => part(true, q.file, q.kind)).join('') + part(footnotesXml, 'footnotes') + part(endnotesXml, 'endnotes') + part(commentsXml, 'comments') + '</Types>');
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Inkwell</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', styles);
  zip.file('word/numbering.xml', numbering);
  zip.file('word/settings.xml', settingsXml);
  for (const q of parts) zip.file(`word/${q.file}.xml`, q.xml);
  if (footnotesXml) zip.file('word/footnotes.xml', footnotesXml);
  if (endnotesXml) zip.file('word/endnotes.xml', endnotesXml);
  if (commentsXml) zip.file('word/comments.xml', commentsXml);
  zip.file('word/_rels/document.xml.rels', docRels);
  for (const [i, cfg] of charts.entries()) {
    const n = i + 1;
    zip.file(`word/charts/chart${n}.xml`, chartXml(cfg, PALETTE));
    zip.file(`word/charts/_rels/chart${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Microsoft_Excel_Sheet${n}.xlsx"/></Relationships>`);
    zip.file(`word/embeddings/Microsoft_Excel_Sheet${n}.xlsx`, await workbook(JSZip, cfg));
  }
  smarts.forEach((q, i) => {
    zip.file(`word/diagrams/data${i + 1}.xml`, q.data);
    zip.file(`word/diagrams/layout${i + 1}.xml`, q.layout);
    zip.file(`word/diagrams/quickStyle${i + 1}.xml`, q.style);
    zip.file(`word/diagrams/colors${i + 1}.xml`, q.colors);
    zip.file(`word/diagrams/drawing${i + 1}.xml`, q.drawing);
  });
  for (const d of images.values()) zip.file(`word/media/image${d.n}.${d.ext}`, d.bytes);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}
