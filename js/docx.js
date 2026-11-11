// Writes a real .docx (WordprocessingML in a zip) from the editor DOM.
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
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

async function prepareImages(root, maxPx) {
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
      w = Math.min(w, maxPx);
      map.set(img, { bytes, ext, w, h: (w * nh) / nw, n: ++n });
    } catch { /* cross-origin or broken image: leave it out */ }
  }
  return map;
}

export async function exportDocx(root, { title = 'Document', page }) {
  const JSZip = await loadScript('vendor/jszip.min.js', 'JSZip');
  const contentMm = page.w - page.m.l - page.m.r;
  const contentTw = Math.round(contentMm * TW_MM);
  const images = await prepareImages(root, (contentMm / 25.4) * 96);

  const rels = [];
  const nums = [];              // each entry: abstract id (1 bullets, 2 numbers)
  const rel = (type, target, external) => {
    rels.push({ type, target, external });
    return 'rId' + (rels.length + 2);    // rId1 styles, rId2 numbering
  };

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
      else if (part) body += `<w:t xml:space="preserve">${esc(part)}</w:t>`;
    }
    return `<w:r>${rPr(f)}${body}</w:r>`;
  }

  function imageRun(img) {
    const d = images.get(img);
    if (!d) return '';
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
    if (t === 'BR') return '<w:r><w:br/></w:r>';
    if (t === 'IMG') return imageRun(node);
    if (t === 'UL' || t === 'OL' || t === 'TABLE') return '';
    let g = fmt(node, f);
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

  const para = (el, env, runs) => `<w:p>${pPr(el, env)}${runs}</w:p>`;

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
    const rows = [...el.querySelectorAll('tr')].filter((r) => r.closest('table') === el);
    if (!rows.length) return '';
    const cols = Math.max(...rows.map((r) => [...r.cells].reduce((a, c) => a + (c.colSpan || 1), 0)));
    const cw = Math.floor(contentTw / cols);
    const border = (k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    let x = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${cw}"/>`.repeat(cols)}</w:tblGrid>`;
    for (const r of rows) {
      x += '<w:tr>';
      for (const c of r.cells) {
        const span = c.colSpan || 1;
        const head = c.tagName === 'TH';
        let inner = hasBlockChild(c) ? blocks(c, { cell: true }) : para(c, {}, kids(c, head ? { b: true } : {}));
        if (!/<\/w:p>$/.test(inner)) inner += '<w:p/>';
        x += `<w:tc><w:tcPr><w:tcW w:w="${cw * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F0"/>' : ''}</w:tcPr>${inner}</w:tc>`;
      }
      x += '</w:tr>';
    }
    return x + '</w:tbl>';
  }

  function block(el, env) {
    const t = el.tagName;
    if (t === 'UL' || t === 'OL') return list(el, env);
    if (t === 'TABLE') return table(el);
    if (t === 'HR') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>';
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

  const body = blocks(root, {});

  // ----- package parts -----
  const cs = getComputedStyle(root);
  const bodyFont = fontName(cs.getPropertyValue('--doc-font'), 'Calibri');
  const headFont = fontName(cs.getPropertyValue('--head-font'), bodyFont);
  const headColor = hex(cs.getPropertyValue('--head-color').trim()) || '1F1F1F';
  const accent = hex(cs.getPropertyValue('--doc-accent').trim()) || '0F766E';
  const baseHalf = Math.round((parseFloat(cs.fontSize) || 14.67) * 0.75 * 2);

  const heading = (id, name, lvl, size) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120" w:line="288" w:lineRule="auto"/><w:outlineLvl w:val="${lvl}"/></w:pPr><w:rPr><w:rFonts w:ascii="${esc(headFont)}" w:hAnsi="${esc(headFont)}" w:cs="${esc(headFont)}"/><w:b/><w:color w:val="${headColor}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(bodyFont)}" w:hAnsi="${esc(bodyFont)}" w:cs="${esc(bodyFont)}"/><w:sz w:val="${baseHalf}"/><w:szCs w:val="${baseHalf}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + heading('Heading1', 'heading 1', 0, 40) + heading('Heading2', 'heading 2', 1, 30) + heading('Heading3', 'heading 3', 2, 25)
    + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="${esc(headFont)}" w:hAnsi="${esc(headFont)}" w:cs="${esc(headFont)}"/><w:b/><w:color w:val="141414"/><w:sz w:val="60"/><w:szCs w:val="60"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:rFonts w:ascii="${esc(headFont)}" w:hAnsi="${esc(headFont)}" w:cs="${esc(headFont)}"/><w:color w:val="6B6B6B"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="16" w:space="12" w:color="${accent}"/></w:pBdr><w:spacing w:before="200" w:after="200"/><w:ind w:left="600"/></w:pPr><w:rPr><w:i/><w:color w:val="444444"/></w:rPr></w:style>`
    + '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F2"/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>'
    + `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="${accent}"/><w:u w:val="single"/></w:rPr></w:style>`
    + '</w:styles>';

  const bullets = ['•', '◦', '▪'], fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
  const lvls = (ordered) => Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? fmts[i % 3] : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : bullets[i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>${nums.map((a, i) => `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="${a}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;

  const tw = (mm) => Math.round(mm * TW_MM);
  const sect = `<w:sectPr><w:pgSz w:w="${tw(page.w)}" w:h="${tw(page.h)}"${page.landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(page.m.t)}" w:right="${tw(page.m.r)}" w:bottom="${tw(page.m.b)}" w:left="${tw(page.m.l)}" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:num="${page.cols || 1}" w:space="708"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body || '<w:p/>'}${sect}</w:body></w:document>`;

  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>${rels.map((r, i) => `<Relationship Id="rId${i + 3}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Inkwell</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', styles);
  zip.file('word/numbering.xml', numbering);
  zip.file('word/_rels/document.xml.rels', docRels);
  for (const d of images.values()) zip.file(`word/media/image${d.n}.${d.ext}`, d.bytes);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}
