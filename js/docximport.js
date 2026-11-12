// Richer .docx import. Mammoth handles the body text; this reads the parts it skips straight from the zip:
// footnotes and endnotes, comments, tracked changes, and the default header and footer.
// Strategy: rewrite word/document.xml so those things survive as private-use marker characters inside
// ordinary text, let mammoth convert it, then turn the markers back into Inkwell's own elements.
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
function sectData(prev, next) {
  const d = {};
  if (next.header && next.header !== prev.header) d.header = next.header;
  if (next.footer && next.footer !== prev.footer) d.footer = next.footer;
  d.landscape = !!next.landscape;
  if (next.restart != null && !isNaN(next.restart)) d.restart = next.restart;
  return d;
}

// Rewrites the document XML in place and returns what the later steps need.
function mark(doc, comments, notes, sects) {
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

// Turns the markers in mammoth's HTML back into elements.
function unmark(html, comments, notes) {
  let prev;
  html = html.replace(new RegExp(`<p>(${O}[SX]\\|[^${O}${M}${C}]*${M}${C})</p>`, 'g'), '$1');   // block markers must not sit inside a paragraph
  const used = new Map();                // comment id -> first span emitted (so one comment keeps one id)
  do {
    prev = html;
    html = html.replace(new RegExp(`${O}([^${O}${M}${C}]*)${M}([^${O}${C}]*)${C}`, 'g'), (all, head, body) => {
      const f = head.split('|');
      if (f[0] === 'I' || f[0] === 'D') {
        const tag = f[0] === 'I' ? 'ins' : 'del';
        return `<${tag} class="tc" data-author="${esc(dec(f[1]))}" data-time="${esc(f[2])}">${body}</${tag}>`;
      }
      if (f[0] === 'C') {
        const id = dec(f[1]);
        if (!used.has(id)) used.set(id, 'cm' + uid());
        return `<span class="cm" data-cm="${used.get(id)}" data-author="${esc(dec(f[2]))}" data-time="${esc(f[3])}" data-text="${esc(dec(f[4]))}">${body}</span>`;
      }
      if (f[0] === 'S') return `<div class="page-break sect-break" contenteditable="false" data-sect="${esc(dec(f[1]))}"></div>`;
      if (f[0] === 'X') return `<div class="textbox"${Number(f[1]) > 40 ? ` style="width:${Math.min(Number(f[1]), 720)}px"` : ''}>${dec(f[2])}</div>`;
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
    const refs = mark(docXml, comments, notes, sects);
    zip.file('word/document.xml', new XMLSerializer().serializeToString(docXml));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const extra = {};
    const hf = await headerFooter(zip).catch(() => null);
    if (hf) extra.hf = hf;
    const finish = (html) => {
      html = unmark(html, comments, notes);
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
