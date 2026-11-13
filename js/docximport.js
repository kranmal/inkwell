// Richer .docx import. Mammoth handles the body text; this reads the parts it skips straight from the zip:
// footnotes and endnotes, comments, tracked changes, and the default header and footer.
// Strategy: rewrite word/document.xml so those things survive as private-use marker characters inside
// ordinary text, let mammoth convert it, then turn the markers back into Inkwell's own elements.
import { smartConfig } from './docxsmart.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const O = '', M = '', C = '';          // open, middle, close markers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const enc = (s) => encodeURIComponent(s || '');
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const attr = (el, n) => el.getAttributeNS(W, n) || el.getAttribute('w:' + n) || '';
const kids = (el, n) => [...el.getElementsByTagNameNS(W, n)];
const uid = () => 'i' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);

const parse = (xml) => {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  return d.getElementsByTagName('parsererror').length ? null : d;
};
const read = async (zip, path) => { const f = zip.file(path); return f ? parse(await f.async('string')) : null; };

// Text of a paragraph-bearing element as simple HTML (bold and italic only), paragraphs joined by <br>.
const paraHtml = (p) => kids(p, 'r').map((r) => {
  const t = kids(r, 't').map((x) => x.textContent).join('') + (kids(r, 'tab').length ? ' ' : '');
  if (!t) return '';
  let h = esc(t);
  if (kids(r, 'i').length) h = `<i>${h}</i>`;
  if (kids(r, 'b').length) h = `<b>${h}</b>`;
  return h;
}).join('');
function simpleHtml(el) {
  return kids(el, 'p').map(paraHtml).filter(Boolean).join('<br>');
}

async function readNotes(zip, file, tag) {
  const d = await read(zip, file);
  const out = new Map();
  if (!d) return out;
  for (const n of kids(d.documentElement, tag)) {
    const type = attr(n, 'type');
    if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue;
    out.set(attr(n, 'id'), simpleHtml(n) || '<br>');
  }
  return out;
}

async function readComments(zip) {
  const d = await read(zip, 'word/comments.xml');
  const out = new Map();
  if (!d) return out;
  for (const c of kids(d.documentElement, 'comment')) {
    const text = kids(c, 'p').map((p) => kids(p, 't').map((t) => t.textContent).join('')).join('\n').trim();
    const date = Date.parse(attr(c, 'date'));
    out.set(attr(c, 'id'), { author: attr(c, 'author') || 'Author', time: isNaN(date) ? Date.now() : date, text });
  }
  return out;
}

// One entry per Word section: header/footer text (undefined when the section has none of its own), orientation, page restart.
async function sectInfo(zip, docXml) {
  const docRels = await read(zip, 'word/_rels/document.xml.rels');
  if (!docRels) return [];
  const target = new Map([...docRels.getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const out = [];
  for (const sect of kids(docXml.documentElement, 'sectPr')) {
    const o = {};
    for (const [tag, key] of [['headerReference', 'header'], ['footerReference', 'footer']]) {
      const ref = kids(sect, tag).find((r) => attr(r, 'type') === 'default');
      if (!ref) continue;
      const t = target.get(ref.getAttributeNS(RN, 'id') || ref.getAttribute('r:id'));
      const part = t && await read(zip, 'word/' + t.replace(/^\/?(word\/)?/, ''));
      const sl = part && slots(part);
      o[key] = sl ? sl.filter((x) => x.text).map((x) => x.text).join(' · ') : '';
    }
    const sz = kids(sect, 'pgSz')[0];
    o.landscape = !!sz && (attr(sz, 'orient') === 'landscape' || Number(attr(sz, 'w')) > Number(attr(sz, 'h')));
    const pm = kids(sect, 'pgMar')[0];
    if (pm) { const mm = (k) => Number(attr(pm, k)) / 56.69; o.m = [mm('top'), mm('right'), mm('bottom'), mm('left')]; }
    const pn = kids(sect, 'pgNumType')[0];
    if (pn && attr(pn, 'start') !== '') o.restart = parseInt(attr(pn, 'start'), 10);
    out.push(o);
  }
  // A section without its own header or footer carries on the previous one's.
  const eff = [];
  out.forEach((o, i) => eff.push({ ...o, header: o.header !== undefined ? o.header : (eff[i - 1] || {}).header, footer: o.footer !== undefined ? o.footer : (eff[i - 1] || {}).footer }));
  return eff;
}

// What a section break should carry: the settings of the section that starts after it, where they differ.
const PRESETS = { normal: [25.4, 25.4, 25.4, 25.4], narrow: [12.7, 12.7, 12.7, 12.7], moderate: [25.4, 19.1, 25.4, 19.1], wide: [25.4, 50.8, 25.4, 50.8] };
function sectData(prev, next) {
  const d = {};
  if (next.header && next.header !== prev.header) d.header = next.header;
  if (next.footer && next.footer !== prev.footer) d.footer = next.footer;
  d.landscape = !!next.landscape;
  const name = next.m && Object.keys(PRESETS).find((k) => PRESETS[k].every((v, i) => Math.abs(v - next.m[i]) < 1.5));
  if (name) d.margins = name;
  if (next.restart != null && !isNaN(next.restart)) d.restart = next.restart;
  return d;
}


// ----- native Word charts -> Inkwell chart configs -----
const CNS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const DGMNS = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const cKids = (el, n) => [...el.getElementsByTagNameNS(CNS, n)];
const cFirst = (el, n) => el.getElementsByTagNameNS(CNS, n)[0] || null;
const cVal = (el) => { const v = el && el.getAttribute('val'); return v == null ? '' : v; };
// Text points of a c:strRef/c:numRef/c:strLit/c:numLit cache, in index order.
function cache(el) {
  if (!el) return null;
  const pts = [];
  for (const pt of cKids(el, 'pt')) { const v = cFirst(pt, 'v'); pts[Number(pt.getAttribute('idx'))] = v ? v.textContent : ''; }
  const n = cFirst(el, 'ptCount');
  const len = Math.max(pts.length, n ? Number(n.getAttribute('val')) || 0 : 0);
  return Array.from({ length: len }, (_, i) => pts[i] == null ? '' : pts[i]);
}
const KINDS = { barChart: 'column', bar3DChart: 'column', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'donut', scatterChart: 'scatter', bubbleChart: 'bubble', radarChart: 'radar' };
export function chartConfig(doc) {
  const plot = cFirst(doc.documentElement, 'plotArea');
  if (!plot) return null;
  const groups = [...plot.children].filter((c) => c.namespaceURI === CNS && KINDS[c.localName]);
  if (!groups.length) return null;
  const first = groups[0];
  let type = KINDS[first.localName];
  if (first.localName.startsWith('bar')) {
    const bar = cVal(cFirst(first, 'barDir')) === 'bar';
    const grouping = cVal(cFirst(first, 'grouping'));
    type = bar ? 'bar' : grouping === 'percentStacked' ? 'stacked100' : grouping === 'stacked' ? 'stacked' : 'column';
  }
  if (type === 'column' && groups.some((g) => g.localName === 'lineChart')) type = 'combo';
  const series = [];
  let labels = [];
  const xy = type === 'scatter' || type === 'bubble';
  groups.forEach((g, gi) => {
    for (const ser of [...g.children].filter((c) => c.localName === 'ser')) {
      const name = cache(cFirst(ser, 'tx'));
      const cat = cFirst(ser, xy ? 'xVal' : 'cat');
      const lab = cat ? cache(cFirst(cat, 'strCache') || cFirst(cat, 'numCache') || cFirst(cat, 'strLit') || cFirst(cat, 'numLit')) : null;
      const valEl = cFirst(ser, xy ? 'yVal' : 'val');
      const vals = valEl ? cache(cFirst(valEl, 'numCache') || cFirst(valEl, 'numLit')) : null;
      if (!vals) continue;
      if (lab && lab.length > labels.length) labels = lab;
      const num = (a) => a.map((v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; });
      const nm = (name && name[0]) || `Series ${series.length + 1}`;
      series.push({ name: nm, values: num(vals) });
      if (type === 'bubble') {   // a size series only when the sizes are real data (a literal is Inkwell's "equal bubbles")
        const bs = cFirst(ser, 'bubbleSize'), sz = bs && cFirst(bs, 'numRef') ? cache(cFirst(bs, 'numCache')) : null;
        if (sz) series.push({ name: `${nm} (size)`, values: num(sz) });
      }
    }
  });
  if (!series.length) return null;
  const n = Math.max(...series.map((s) => s.values.length));
  labels = Array.from({ length: n }, (_, i) => labels[i] != null && labels[i] !== '' ? String(labels[i]) : String(i + 1));
  for (const s of series) while (s.values.length < n) s.values.push(0);
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const words = (t) => (t ? [...t.getElementsByTagNameNS(A, 't')].map((x) => x.textContent).join('').trim() : '');
  const chart = cFirst(doc.documentElement, 'chart');
  const title = words([...(chart ? chart.children : [])].find((c) => c.namespaceURI === CNS && c.localName === 'title'));
  const cfg = { type, title, labels, series: series.slice(0, 12) };
  const shows = (el) => { const v = cFirst(el, 'showVal'), pc = cFirst(el, 'showPercent'); return (v && cVal(v) !== '0' && cVal(v) !== 'false') || (pc && cVal(pc) !== '0' && cVal(pc) !== 'false'); };
  if (groups.some((g) => cKids(g, 'dLbls').some(shows))) cfg.dataLabels = true;
  if (type === 'combo') {   // the lines on their own pair of axes means a secondary value axis
    const ids = (g) => cKids(g, 'axId').map(cVal).join();
    const bar = groups.find((g) => g.localName.startsWith('bar')), line = groups.find((g) => g.localName === 'lineChart');
    if (bar && line && ids(bar) !== ids(line)) cfg.secondary = true;
  }
  for (const ax of [...plot.children].filter((c) => c.namespaceURI === CNS && /Ax$/.test(c.localName))) {
    const t = words([...ax.children].find((c) => c.localName === 'title'));
    if (!t) continue;
    const isCat = ax.localName !== 'valAx' || (xy && cVal(cFirst(ax, 'axPos')) === 'b');
    if (ax.localName === 'valAx' && type === 'combo' && cfg.secondary && cVal(cFirst(ax, 'crosses')) === 'max') cfg.secTitle = t;
    else if (isCat) cfg.catTitle = t; else cfg.valTitle = t;
  }
  return cfg;
}
// r:id of each chart in word/document.xml -> config.
async function readCharts(zip) {
  const out = new Map();
  const rels = await read(zip, 'word/_rels/document.xml.rels');
  if (!rels) return out;
  for (const r of rels.getElementsByTagName('Relationship')) {
    if (!/\/chart$/.test(r.getAttribute('Type') || '')) continue;
    const part = await read(zip, 'word/' + r.getAttribute('Target').replace(/^\/?(word\/)?/, '')).catch(() => null);
    const cfg = part && chartConfig(part);
    if (cfg) out.set(r.getAttribute('Id'), cfg);
  }
  return out;
}

// r:dm of each SmartArt in word/document.xml -> {kind, items}.
async function readSmart(zip) {
  const out = new Map();
  const rels = await read(zip, 'word/_rels/document.xml.rels');
  if (!rels) return out;
  for (const r of rels.getElementsByTagName('Relationship')) {
    if (!/\/diagramData$/.test(r.getAttribute('Type') || '')) continue;
    const part = await read(zip, 'word/' + r.getAttribute('Target').replace(/^\/?(word\/)?/, '')).catch(() => null);
    const cfg = part && smartConfig(part);
    if (cfg) out.set(r.getAttribute('Id'), cfg);
  }
  return out;
}

// Rewrites the document XML in place and returns what the later steps need.
function mark(doc, comments, notes, sects, charts, smart) {
  const refs = [];                       // note references in document order
  const active = new Set();
  const after = (host, text) => {        // a paragraph holding only a marker, placed right after `host`
    const p = doc.createElementNS(W, 'w:p'), r = doc.createElementNS(W, 'w:r'), t = doc.createElementNS(W, 'w:t');
    t.textContent = `${O}${text}${M}${C}`;
    r.append(t); p.append(r);
    host.parentNode.insertBefore(p, host.nextSibling);
  };
  // Section breaks: each sectPr inside a paragraph ends a section; the break carries the next section's settings.
  if (sects && sects.length > 1) {
    kids(doc.documentElement, 'sectPr').filter((sp) => sp.parentNode.localName === 'pPr').forEach((sp, k) => {
      if (!sects[k + 1]) return;
      after(sp.parentNode.parentNode, `S|${enc(JSON.stringify(sectData(sects[k], sects[k + 1])))}`);
    });
  }
  // Charts: the chart becomes a paragraph of its own after the host paragraph, and the drawing goes.
  if (charts && charts.size) {
    for (const ch of [...doc.getElementsByTagNameNS(CNS, 'chart')]) {
      const cfg = charts.get(ch.getAttributeNS(RNS, 'id') || ch.getAttribute('r:id'));
      let host = null, top = null;
      for (let n = ch.parentNode; n && n !== doc; n = n.parentNode) {
        if (n.namespaceURI === W && n.localName === 'p' && !host) host = n;
        if (n.localName === 'drawing' && !top) top = n;
        if (n.localName === 'AlternateContent') top = n;
      }
      if (!cfg || !host || !top) continue;
      after(host, `H|${enc(JSON.stringify(cfg))}`);
      top.remove();
    }
  }
  // SmartArt: the same, from the diagram's data model.
  if (smart && smart.size) {
    for (const ch of [...doc.getElementsByTagName('*')].filter((e) => e.localName === 'relIds' && e.namespaceURI === DGMNS)) {
      const cfg = smart.get(ch.getAttributeNS(RNS, 'dm') || ch.getAttribute('r:dm'));
      let host = null, top = null;
      for (let n = ch.parentNode; n && n !== doc; n = n.parentNode) {
        if (n.namespaceURI === W && n.localName === 'p' && !host) host = n;
        if (n.localName === 'drawing' && !top) top = n;
        if (n.localName === 'AlternateContent') top = n;
      }
      if (!cfg || !host || !top) continue;
      after(host, `G|${enc(JSON.stringify(cfg))}`);
      top.remove();
    }
  }
  // Text boxes: take their text out of the drawing and put it in a paragraph of its own after the host paragraph.
  for (const tb of kids(doc.documentElement, 'txbxContent')) {
    let fallback = false, host = null, shape = null, wide = 0;
    for (let n = tb.parentNode; n && n !== doc; n = n.parentNode) {
      if (n.localName === 'Fallback') fallback = true;
      if (n.namespaceURI === W && n.localName === 'p' && !host) host = n;
      if (!shape && (n.localName === 'drawing' || n.localName === 'pict')) shape = n;
    }
    if (shape) {
      const ex = shape.getElementsByTagName('wp:extent')[0] || [...shape.getElementsByTagName('*')].find((e) => e.localName === 'extent');
      if (ex) wide = Math.round((Number(ex.getAttribute('cx')) || 0) / 9525);
    }
    if (fallback || !host) continue;
    const html = kids(tb, 'p').map(paraHtml).map((h) => `<p>${h || '<br>'}</p>`).join('');
    if (html) after(host, `X|${wide}|${enc(html)}`);
  }
  // Drop the drawings and their VML fallbacks so the text is not read twice.
  for (const tb of kids(doc.documentElement, 'txbxContent')) {
    let top = null;
    for (let n = tb.parentNode; n && n !== doc; n = n.parentNode) {
      if (n.localName === 'AlternateContent') { top = n; break; }
      if (!top && (n.localName === 'drawing' || n.localName === 'pict')) top = n;
    }
    if (top && top.parentNode) top.remove();
  }
  // A tracked change to a cell's shading (w:tcPrChange): mammoth drops cell shading, so the cell's first text carries a marker
  // with the new and old fill, and finish() turns it into the cell's background plus a mark that Reject can undo.
  // A cell's own borders as CSS (top, right, bottom, left): w:sz is eighths of a point, drawn at 96 dpi as px = sz / 6.
  const BCSS = { single: 'solid', thick: 'solid', dashed: 'dashed', dotted: 'dotted', double: 'double', nil: 'none', none: 'none' };
  const bordersOf = (pr) => {
    const bs = pr && [...pr.children].find((c) => c.localName === 'tcBorders');
    if (!bs) return '';
    let out = '';
    for (const [side, names] of [['top', ['top']], ['right', ['right', 'end']], ['bottom', ['bottom']], ['left', ['left', 'start']]]) {
      const e = [...bs.children].find((c) => names.includes(c.localName));
      if (!e) continue;
      const st = BCSS[attr(e, 'val')] || 'solid';
      if (st === 'none') { out += `border-${side}: none;`; continue; }
      const px = Math.max(1, Math.round((parseInt(attr(e, 'sz'), 10) || 4) / 6 * 10) / 10), col = attr(e, 'color');
      out += `border-${side}: ${px}px ${st} ${/^[0-9a-f]{6}$/i.test(col) ? '#' + col.toLowerCase() : '#000'};`;
    }
    return out;
  };
  const fillOf = (pr) => { const sh = pr && [...pr.children].find((c) => c.localName === 'shd'), v = sh ? attr(sh, 'fill') : ''; return /^[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : ''; };
  // The cell's first text, made if the cell is empty (a zero-width space for the mark to wrap).
  const firstText = (tc) => {
    let t = kids(tc, 't')[0];
    if (!t) {
      const p0 = kids(tc, 'p')[0];
      if (!p0) return null;
      const r = doc.createElementNS(W, 'w:r');
      t = doc.createElementNS(W, 'w:t');
      t.textContent = '\u200b';
      r.append(t); p0.append(r);
    }
    t.setAttribute('xml:space', 'preserve');
    return t;
  };
  const DEFAULT_FILLS = ['f2f2f0', 'f3f5f4'];      // what Inkwell itself writes for header and striped cells
  for (const tc of kids(doc.documentElement, 'tc')) {
    const pr = [...tc.children].find((c) => c.localName === 'tcPr'), ch = pr && [...pr.children].find((c) => c.localName === 'tcPrChange');
    if (!ch) {                                  // an untracked shading or border: carried the same way, with nothing to undo
      const fill = fillOf(pr), bd = bordersOf(pr);
      if (!pr || (!bd && (!fill || DEFAULT_FILLS.includes(fill)))) continue;
      const t0 = firstText(tc);
      if (t0) t0.textContent = `${O}L|${enc(DEFAULT_FILLS.includes(fill) ? '' : fill)}|${enc(bd)}${M}${t0.textContent}${C}`;
      continue;
    }
    const old = [...ch.children].find((c) => c.localName === 'tcPr');
    const was = fillOf(old), now = fillOf(pr), wasB = bordersOf(old), nowB = bordersOf(pr);
    const spanOf = (q) => { const g = q && [...q.children].find((c) => c.localName === 'gridSpan'); return Math.max(1, parseInt(g && attr(g, 'val'), 10) || 1); };
    const vOf = (q) => (q && [...q.children].some((c) => c.localName === 'vMerge') ? 1 : 0);
    const wasCs = spanOf(old), wasV = vOf(old);
    if (was === now && wasB === nowB && wasCs === spanOf(pr) && wasV === vOf(pr)) continue;
    const t = firstText(tc);
    if (!t) continue;
    t.textContent = `${O}K|${enc(attr(ch, 'author'))}|${Date.parse(attr(ch, 'date')) || Date.now()}|${enc(was)}|${enc(now)}|${enc(wasB)}|${enc(nowB)}|${wasCs}|${wasV}${M}${t.textContent}${C}`;
  }
  const walk = (el) => {
    for (const n of [...el.childNodes]) {
      if (n.nodeType !== 1) continue;
      if (n.namespaceURI === W) {
        const name = n.localName;
        if (name === 'commentRangeStart') { active.add(attr(n, 'id')); continue; }
        if (name === 'commentRangeEnd') { active.delete(attr(n, 'id')); continue; }
        if (name === 'footnoteReference' || name === 'endnoteReference') {
          const kind = name === 'footnoteReference' ? 'f' : 'e', id = attr(n, 'id');
          const map = notes[kind];
          if (map.has(id)) {
            const t = doc.createElementNS(W, 'w:t');
            t.textContent = `${O}N|${kind}|${enc(id)}${M}${C}`;
            const run = n.parentNode;
            for (const pr of kids(run, 'rPr')) pr.remove();      // the reference style would add its own superscript
            n.replaceWith(t);
            refs.push({ kind, id });
          }
          continue;
        }
        if (name === 'del') {                                  // mammoth drops w:del outright: re-label it as w:ins so its runs survive
          const ins = doc.createElementNS(W, 'w:ins');
          ins.setAttribute('w:author', attr(n, 'author')); ins.setAttribute('w:date', attr(n, 'date')); ins.setAttribute('w:inkdel', '1');
          while (n.firstChild) ins.append(n.firstChild);
          n.replaceWith(ins);
          walk(ins);
          continue;
        }
        if (name === 'delText' || name === 't') {
          let text = n.textContent;
          const wrap = [];
          const fc = formatChange(n.parentNode);
          if (fc) wrap.push(fc);
          for (let p = n.parentNode; p && p !== doc; p = p.parentNode) {
            if (p.namespaceURI === W && (p.localName === 'ins' || p.localName === 'del')) {
              wrap.push(`${p.localName === 'ins' && !p.getAttribute('w:inkdel') ? 'I' : 'D'}|${enc(attr(p, 'author'))}|${Date.parse(attr(p, 'date')) || Date.now()}`);
              break;
            }
          }
          for (const id of active) {
            const c = comments.get(id);
            if (c) wrap.push(`C|${enc(id)}|${enc(c.author)}|${c.time}|${enc(c.text)}`);
          }
          if (!wrap.length && name === 't') continue;
          for (const w of wrap) text = `${O}${w}${M}${text}${C}`;
          if (name === 'delText') {
            const t = doc.createElementNS(W, 'w:t');
            t.setAttribute('xml:space', 'preserve');
            t.textContent = text;
            n.replaceWith(t);
          } else { n.textContent = text; n.setAttribute('xml:space', 'preserve'); }
          continue;
        }
      }
      walk(n);
    }
  };
  walk(doc.documentElement);
  return refs;
}

// A run's tracked formatting change (w:rPrChange) as a marker: who, when, what changed, and the tags the text had before.
// Compared: bold, italic, underline, strikethrough, super/subscript, colour, size and font.
const LOOKS = [['b', 'Bold', 'strong'], ['i', 'Italic', 'em'], ['u', 'Underline', 'u'], ['strike', 'Strikethrough', 's']];
function looksOf(rPr) {
  const own = (name) => [...rPr.children].filter((c) => c.namespaceURI === W && c.localName === name);
  const on = (name) => { const e = own(name)[0]; if (!e) return false; const v = attr(e, 'val'); return !(v === '0' || v === 'false' || v === 'none'); };
  const va = own('vertAlign')[0];
  const val = (name, key = 'val') => { const e = own(name)[0]; return e ? attr(e, key) : ''; };
  const col = val('color'), sz = Number(val('sz')), font = val('rFonts', 'ascii') || val('rFonts', 'hAnsi');
  return { b: on('b'), i: on('i'), u: on('u'), strike: on('strike') || on('dstrike'), va: va ? attr(va, 'val') : '',
    color: /^[0-9a-f]{6}$/i.test(col) ? '#' + col.toLowerCase() : '', size: sz > 0 ? sz / 2 : 0, font: /^[\w .-]{1,60}$/.test(font) ? font : '' };
}
// mammoth drops colour, size and font, so they are put back as an inline style (on the new text, and on the old text in data-was).
const styleOf = (l) => [l.color && `color:${l.color}`, l.size && `font-size:${l.size}pt`, l.font && `font-family:'${l.font}'`].filter(Boolean).join(';');
function formatChange(run) {
  if (!run || run.localName !== 'r') return '';
  const rPr = [...run.children].find((c) => c.localName === 'rPr'), ch = rPr && [...rPr.children].find((c) => c.localName === 'rPrChange');
  if (!ch) return '';
  const was = looksOf([...ch.children].find((c) => c.localName === 'rPr') || ch), now = looksOf(rPr);
  const labels = LOOKS.filter(([k]) => was[k] !== now[k]).map(([, l]) => l);
  if (was.color !== now.color) labels.push('Colour');
  if (was.size !== now.size) labels.push('Size');
  if (was.font !== now.font) labels.push('Font');
  if (was.va !== now.va) labels.push(now.va === 'superscript' || was.va === 'superscript' ? 'Superscript' : 'Subscript');
  if (!labels.length) return '';
  const tags = [...LOOKS.filter(([k]) => was[k]).map(([, , t]) => t), ...(was.va === 'superscript' ? ['sup'] : was.va === 'subscript' ? ['sub'] : [])];
  return `F|${enc(attr(ch, 'author'))}|${Date.parse(attr(ch, 'date')) || Date.now()}|${enc(labels.join(', '))}|${enc(tags.map((t) => `<${t}>`).join(''))}|${enc(tags.reverse().map((t) => `</${t}>`).join(''))}|${enc(styleOf(now))}|${enc(styleOf(was))}`;
}

// Turns the markers in mammoth's HTML back into elements.
function unmark(html, comments, notes) {
  let prev;
  html = html.replace(new RegExp(`<p>(${O}[SXH]\\|[^${O}${M}${C}]*${M}${C})</p>`, 'g'), '$1');   // block markers must not sit inside a paragraph
  const used = new Map();                // comment id -> first span emitted (so one comment keeps one id)
  do {
    prev = html;
    html = html.replace(new RegExp(`${O}([^${O}${M}${C}]*)${M}([^${O}${C}]*)${C}`, 'g'), (all, head, body) => {
      const f = head.split('|');
      if (f[0] === 'I' || f[0] === 'D') {
        const tag = f[0] === 'I' ? 'ins' : 'del';
        return `<${tag} class="tc" data-author="${esc(dec(f[1]))}" data-time="${esc(f[2])}">${body}</${tag}>`;
      }
      if (f[0] === 'F') {       // a tracked formatting change: the text as it was is kept in data-was
        const plain = body.replace(/<[^>]*>/g, '');
        const sty = (st, t) => (st ? `<span style="${esc(st)}">${t}</span>` : t);
        const was = dec(f[4]) + sty(dec(f[7] || ''), plain) + dec(f[5]);
        return `<span class="fc" data-author="${esc(dec(f[1]))}" data-time="${esc(f[2])}" data-label="${esc(dec(f[3]))}" data-was="${esc(was)}" data-lift="1">${sty(dec(f[6] || ''), body)}</span>`;
      }
      if (f[0] === 'L') return `<span data-look="1" data-new-bg="${esc(dec(f[1]))}" data-new-border="${esc(dec(f[2]))}"${body === '\u200b' ? ' data-pad="1"' : ''}>${body}</span>`;
      if (f[0] === 'K') {       // a tracked cell change: the old look goes in the mark, the new one is applied to the cell in finish()
        const wasFill = dec(f[3]), wasB = dec(f[5]), fillDiff = wasFill !== dec(f[4]), bordDiff = wasB !== dec(f[6]);
        const label = [fillDiff && 'shading', bordDiff && 'borders'].filter(Boolean).join(', ') || 'merged or split';
        const style = (wasFill ? `background-color: #${wasFill};` : '') + wasB;
        return `<span class="fc" data-author="${esc(dec(f[1]))}" data-time="${esc(f[2])}" data-label="Cell ${label}"${fillDiff || bordDiff ? ` data-cell-style="${esc(style)}"` : ''} data-new-bg="${esc(dec(f[4]))}" data-new-border="${esc(dec(f[6]))}" data-old-cs="${esc(f[7])}" data-old-v="${esc(f[8])}"${body === '\u200b' ? ' data-pad="1"' : ''}>${body}</span>`;
      }
      if (f[0] === 'C') {
        const id = dec(f[1]);
        if (!used.has(id)) used.set(id, 'cm' + uid());
        return `<span class="cm" data-cm="${used.get(id)}" data-author="${esc(dec(f[2]))}" data-time="${esc(f[3])}" data-text="${esc(dec(f[4]))}">${body}</span>`;
      }
      if (f[0] === 'S') return `<div class="page-break sect-break" contenteditable="false" data-sect="${esc(dec(f[1]))}"></div>`;
      if (f[0] === 'X') return `<div class="textbox"${Number(f[1]) > 40 ? ` style="width:${Math.min(Number(f[1]), 720)}px"` : ''}>${dec(f[2])}</div>`;
      if (f[0] === 'H') return `<figure class="chart" data-chart="${esc(dec(f[1]))}" contenteditable="false"></figure>`;
      if (f[0] === 'G') return `<figure class="smartart" data-sa="${esc(dec(f[1]))}" contenteditable="false"></figure>`;
      if (f[0] === 'N') {
        const kind = f[1], id = dec(f[2]);
        return `<sup class="${kind === 'f' ? 'fn' : 'en'}-ref" data-fn="${kind}${esc(id)}" contenteditable="false">1</sup>`;
      }
      return all;
    });
  } while (html !== prev);
  return html;
}

// Header and footer: the text, its alignment, and where a page number sat.
function slots(part) {
  const p = kids(part.documentElement, 'p').find((q) => q.textContent.trim() || kids(q, 'fldChar').length || kids(q, 'fldSimple').length);
  if (!p) return null;
  const jc = p.getElementsByTagNameNS(W, 'jc')[0];
  const align = jc ? ({ center: 'center', right: 'right', end: 'right' }[attr(jc, 'val')] || 'left') : 'left';
  const parts = [{ text: '', page: false }];
  const cur = () => parts[parts.length - 1];
  for (const r of kids(p, 'r')) {
    for (const c of r.childNodes) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 't') cur().text += c.textContent;
      else if (c.localName === 'tab') parts.push({ text: '', page: false });
      else if (c.localName === 'instrText' && /\bPAGE\b/i.test(c.textContent)) cur().page = true;
    }
  }
  for (const f of kids(p, 'fldSimple')) if (/\bPAGE\b/i.test(attr(f, 'instr'))) cur().page = true;
  // Page-number fields cache a digit as text; drop it from the visible text.
  for (const s of parts) if (s.page) s.text = s.text.replace(/\d+/g, '');
  const names = parts.length >= 3 ? ['left', 'center', 'right'] : parts.length === 2 ? ['left', 'right'] : [align];
  return parts.map((s, i) => ({ align: names[Math.min(i, names.length - 1)], text: s.text.replace(/\s+/g, ' ').trim(), page: s.page }));
}

async function headerFooter(zip) {
  const docRels = await read(zip, 'word/_rels/document.xml.rels');
  const body = await read(zip, 'word/document.xml');
  if (!docRels || !body) return null;
  const target = new Map([...docRels.getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const out = {};
  const sect = kids(body.documentElement, 'sectPr')[0];   // the first section sets the document-level header and footer
  if (!sect) return null;
  for (const [tag, key] of [['headerReference', 'header'], ['footerReference', 'footer']]) {
    const ref = kids(sect, tag).find((r) => attr(r, 'type') === 'default') || kids(sect, tag)[0];
    const t = ref && target.get(ref.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || ref.getAttribute('r:id'));
    if (!t) continue;
    const part = await read(zip, 'word/' + t.replace(/^\/?(word\/)?/, ''));
    const s = part && slots(part);
    if (!s) continue;
    const text = s.filter((x) => x.text);
    if (text.length) { out[key] = text.map((x) => x.text).join(' · '); out[key + 'Align'] = text[0].align; }
    const pg = s.find((x) => x.page);
    if (pg) { out.num = `${key === 'header' ? 'top' : 'bottom'}-${pg.align}`; out.numFormat = '1'; }
  }
  const titlePg = kids(sect, 'titlePg').length > 0;
  if (titlePg) out.firstDiff = true;
  return Object.keys(out).length ? out : null;
}

// Returns { buffer, finish(html) -> html, extra } for mammoth: convert `buffer`, then pass its HTML to finish().
export async function prepare(JSZip, arrayBuffer) {
  const none = { buffer: arrayBuffer, finish: (h) => h, extra: {} };
  let zip;
  try { zip = await JSZip.loadAsync(arrayBuffer); } catch { return none; }
  try {
    const docXml = await read(zip, 'word/document.xml');
    if (!docXml) return none;
    const notes = { f: await readNotes(zip, 'word/footnotes.xml', 'footnote'), e: await readNotes(zip, 'word/endnotes.xml', 'endnote') };
    const comments = await readComments(zip);
    const sects = await sectInfo(zip, docXml).catch(() => []);
    const charts = await readCharts(zip).catch(() => new Map());
    const smart = await readSmart(zip).catch(() => new Map());
    const refs = mark(docXml, comments, notes, sects, charts, smart);
    zip.file('word/document.xml', new XMLSerializer().serializeToString(docXml));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const extra = {};
    const hf = await headerFooter(zip).catch(() => null);
    if (hf) extra.hf = hf;
    const finish = (html) => {
      html = unmark(html, comments, notes);
      if (html.includes('data-new-bg')) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        for (const sp of tpl.content.querySelectorAll('span[data-new-bg]')) {
          const cell = sp.closest('td,th'), bg = sp.getAttribute('data-new-bg'), bd = sp.getAttribute('data-new-border');
          const oldCs = parseInt(sp.getAttribute('data-old-cs'), 10) || 1, oldV = sp.getAttribute('data-old-v') === '1';
          for (const k of ['new-bg', 'new-border', 'old-cs', 'old-v']) sp.removeAttribute('data-' + k);
          if (cell && bg) cell.style.backgroundColor = '#' + bg;
          if (cell && bd) for (const part of bd.split(';')) { const [prop, ...v] = part.split(':'); if (v.length) cell.style.setProperty(prop.trim(), v.join(':').trim()); }
          // Old merge: the width is exact; a cell that was merged downwards is taken to have spanned the rows below it that are now its own, or two.
          if (sp.hasAttribute('data-look')) {      // untracked: nothing to undo, so drop the wrapper
            if (sp.hasAttribute('data-pad')) sp.remove(); else sp.replaceWith(...sp.childNodes);
            continue;
          }
          if (cell) {
            const rs = oldV ? Math.max(cell.rowSpan, 2) : 1;
            if (oldCs !== cell.colSpan || rs !== cell.rowSpan) sp.setAttribute('data-cell-span', oldCs + ',' + rs);
          }
        }
        html = tpl.innerHTML;
      }
      // Note lists go at the end, in reference order.
      for (const [kind, cls] of [['f', 'footnotes'], ['e', 'endnotes']]) {
        const mine = refs.filter((r) => r.kind === kind);
        if (!mine.length) continue;
        html += `<ol class="${cls}">${mine.map((r) => `<li data-fn="${kind}${esc(r.id)}">${notes[kind].get(r.id)}</li>`).join('')}</ol>`;
      }
      return html;
    };
    return { buffer, finish, extra };
  } catch (err) {
    console.warn('Rich import skipped:', err);
    return none;
  }
}
