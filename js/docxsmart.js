// Native Word SmartArt (DrawingML diagram parts) from an Inkwell SmartArt config {kind, items}.
// A diagram is five parts: the data model, a layout definition, a quick style, a colour set and a
// pre-drawn copy of the shapes (the drawing), which is what Word shows until it re-lays the diagram out.
const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
const AN = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const URN = 'urn:microsoft.com/office/officeart/2005/8/';
export const SMART_LAYOUT = { process: 'process1', cycle: 'cycle2', hierarchy: 'hierarchy1', list: 'default', pyramid: 'pyramid1' };
const CAT = { process: 'process', cycle: 'cycle', hierarchy: 'hierarchy', list: 'list', pyramid: 'pyramid' };
const PAL = ['2A78D6', 'EB6834', '1BAF7A', 'EDA100', '6250D6', 'E34948', '008300', 'E87BA4'];
const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const guid = (n, k) => `{${String(n).padStart(8, '0')}-0000-4000-8000-${String(k).padStart(12, '0')}}`;

export const smartItems = (cfg) => ((cfg && cfg.items) || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8);

// Shapes in a 640-wide space, the same geometry as the on-screen SVG. Each is {g, x, y, w, h, fill, text, size, color, align, rot}.
export function smartShapes(cfg) {
  const items = smartItems(cfg), n = items.length || 1, W = 640, out = [];
  const S = (o) => out.push({ fill: 'FFFFFF', size: 14, color: 'FFFFFF', align: 'ctr', ...o });
  let H = 200;
  const gray = '9A9A9A';
  if (cfg.kind === 'cycle') {
    H = 380;
    const cx = W / 2, cy = H / 2, R = 130, r = Math.max(38, Math.min(58, 190 / n + 22));
    items.forEach((t, k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / n, a2 = -Math.PI / 2 + ((k + 1) * 2 * Math.PI) / n;
      if (n > 1) {
        const am = (a + a2) / 2, mx = cx + R * Math.cos(am), my = cy + R * Math.sin(am);
        S({ g: 'rightArrow', x: mx - 13, y: my - 9, w: 26, h: 18, fill: gray, rot: Math.round(((am + Math.PI / 2) * 180) / Math.PI * 60000) });
      }
      S({ g: 'ellipse', x: cx + R * Math.cos(a) - r, y: cy + R * Math.sin(a) - r, w: 2 * r, h: 2 * r, fill: PAL[k % 8], text: t, size: 12 });
    });
  } else if (cfg.kind === 'hierarchy') {
    const kids = items.slice(1), m = kids.length || 1;
    H = kids.length ? 230 : 90;
    const bw = Math.min(170, (W - 20 - (m - 1) * 14) / m), bh = 62, tx = W / 2, total = m * bw + (m - 1) * 14, x0 = (W - total) / 2;
    if (kids.length) {
      S({ g: 'rect', line: 1, x: tx, y: 10 + bh, w: 0, h: 102 - 10 - bh, fill: gray });
      const cxs = kids.map((_, k) => x0 + k * (bw + 14) + bw / 2);
      if (m > 1) S({ g: 'rect', line: 1, x: cxs[0], y: 112, w: cxs[m - 1] - cxs[0], h: 0, fill: gray });
      cxs.forEach((cx) => S({ g: 'rect', line: 1, x: cx, y: 112, w: 0, h: 38, fill: gray }));
    }
    S({ g: 'roundRect', x: tx - 95, y: 10, w: 190, h: bh, fill: PAL[0], text: items[0] || '' });
    kids.forEach((t, k) => S({ g: 'roundRect', x: x0 + k * (bw + 14), y: 150, w: bw, h: bh, fill: PAL[(k + 1) % 8], text: t }));
  } else if (cfg.kind === 'list') {
    const bh = 50;
    H = n * (bh + 10) + 10;
    items.forEach((t, k) => {
      const y = 10 + k * (bh + 10);
      S({ g: 'roundRect', x: 10, y, w: W - 20, h: bh, fill: 'F1F1EE', text: t, size: 16, color: '1F1F1F', align: 'l', inset: 72 });
      S({ g: 'roundRect', x: 10, y, w: 56, h: bh, fill: PAL[k % 8], text: String(k + 1), size: 18 });
    });
  } else if (cfg.kind === 'pyramid') {
    const rh = 58;
    H = n * rh + 20;
    const cx = W / 2, full = 560;
    items.forEach((t, k) => {
      const w1 = (full * k) / n, w2 = (full * (k + 1)) / n, y1 = 10 + k * rh, h = rh - 3;
      if (k === 0) S({ g: 'triangle', x: cx - w2 / 2, y: y1, w: w2, h, fill: PAL[0], text: t, size: 12, pad: 'low' });
      else S({ g: 'trapezoid', x: cx - w2 / 2, y: y1, w: w2, h, fill: PAL[k % 8], text: t, size: 15, adj: ((w2 - w1) / 2 / Math.min(w2, h)) * 100000 });
    });
  } else {
    const gap = 26, bw = (W - 20 - (n - 1) * gap) / n, bh = 84;
    H = bh + 20;
    items.forEach((t, k) => {
      const x = 10 + k * (bw + gap);
      S({ g: 'roundRect', x, y: 10, w: bw, h: bh, fill: PAL[k % 8], text: t, size: n > 5 ? 12 : 15 });
      if (k < n - 1) S({ g: 'rightArrow', x: x + bw + 4, y: 10 + bh / 2 - 10, w: gap - 8, h: 20, fill: gray });
    });
  }
  return { W, H, shapes: out };
}

function drawingXml(cfg, wEmu) {
  const { W, H, shapes } = smartShapes(cfg), k = wEmu / W, hEmu = Math.round(H * k), e = (v) => Math.round(v * k);
  const sp = shapes.map((s, i) => {
    const geom = s.line ? 'line' : s.g;
    const av = s.adj ? `<a:avLst><a:gd name="adj" fmla="val ${Math.min(Math.round(s.adj), 50000 * Math.max(1, s.w / Math.min(s.w, s.h)))}"/></a:avLst>` : '<a:avLst/>';
    const fill = `<a:solidFill><a:srgbClr val="${s.fill}"/></a:solidFill>`;
    const look = s.line ? `<a:noFill/><a:ln w="${s.fill === '9A9A9A' ? 25400 : 25400}">${fill}</a:ln>` : `${fill}<a:ln><a:noFill/></a:ln>`;
    const run = s.text ? `<a:p><a:pPr algn="${s.align}"/><a:r><a:rPr lang="en-US" sz="${Math.round(s.size * 75)}" b="1"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></a:rPr><a:t>${esc(s.text)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US"/></a:p>';
    const ins = s.inset ? e(s.inset - 10) : 45720;
    const tx = `<dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="${ins}" tIns="45720" rIns="45720" bIns="${s.pad === 'low' ? 160000 : 45720}" numCol="1" spcCol="1270" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${run}</dsp:txBody>`;
    const xf = `<a:xfrm${s.rot ? ` rot="${s.rot}"` : ''}><a:off x="${e(s.x)}" y="${e(s.y)}"/><a:ext cx="${e(s.w)}" cy="${e(s.h)}"/></a:xfrm>`;
    const txx = s.text && !s.line ? `<dsp:txXfrm><a:off x="${e(s.x)}" y="${e(s.y)}"/><a:ext cx="${e(s.w)}" cy="${e(s.h)}"/></dsp:txXfrm>` : '';
    return `<dsp:sp modelId="${guid(3, i + 1)}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>${xf}<a:prstGeom prst="${geom}">${av}</a:prstGeom>${look}</dsp:spPr>${s.line ? '' : tx}${txx}</dsp:sp>`;
  }).join('');
  return { xml: `${HDR}<dsp:drawing xmlns:dgm="${DGM}" xmlns:dsp="${DSP}" xmlns:a="${AN}"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${sp}</dsp:spTree></dsp:drawing>`, ratio: H / W };
}

// {data, layout, style, colors, drawing, ratio}; `drawingRel` is the document relationship id of the drawing part.
export function smartParts(cfg, wPx, emuPx, drawingRel, n = 1) {
  const items = smartItems(cfg), kind = SMART_LAYOUT[cfg.kind] ? cfg.kind : 'process';
  const lo = URN + 'layout/' + SMART_LAYOUT[kind], qs = URN + 'quickstyle/simple1', cs = URN + 'colors/accent1_2';
  const docId = guid(n, 1), id = (k) => guid(n, 100 + k);
  const txt = (t) => `<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(t)}</a:t></a:r></a:p></dgm:t>`;
  let pts = `<dgm:pt modelId="${docId}" type="doc"><dgm:prSet loTypeId="${lo}" loCatId="${CAT[kind]}" qsTypeId="${qs}" qsCatId="simple" csTypeId="${cs}" csCatId="accent1" phldr="0"/><dgm:spPr/>${txt('')}</dgm:pt>`;
  let cx = '';
  items.forEach((t, i) => {
    pts += `<dgm:pt modelId="${id(i * 3)}"><dgm:prSet/><dgm:spPr/>${txt(t)}</dgm:pt>`;
    pts += `<dgm:pt modelId="${id(i * 3 + 1)}" type="parTrans" cxnId="${id(1000 + i)}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></dgm:t></dgm:pt>`;
    pts += `<dgm:pt modelId="${id(i * 3 + 2)}" type="sibTrans" cxnId="${id(1000 + i)}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></dgm:t></dgm:pt>`;
    // A hierarchy hangs every later item under the first; the other layouts list them in order under the diagram.
    const parent = kind === 'hierarchy' && i > 0 ? id(0) : docId;
    const order = kind === 'hierarchy' && i > 0 ? i - 1 : i;
    cx += `<dgm:cxn modelId="${id(1000 + i)}" srcId="${parent}" destId="${id(i * 3)}" srcOrd="${order}" destOrd="0" parTransId="${id(i * 3 + 1)}" sibTransId="${id(i * 3 + 2)}"/>`;
  });
  const dr = drawingXml({ kind, items }, Math.round(wPx * emuPx));
  const ext = `<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="${drawingRel}" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst>`;
  const cat = (t, pri) => `<dgm:catLst><dgm:cat type="${t}" pri="${pri}"/></dgm:catLst>`;
  return {
    ratio: dr.ratio,
    data: `${HDR}<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${AN}"><dgm:ptLst>${pts}</dgm:ptLst><dgm:cxnLst>${cx}</dgm:cxnLst><dgm:bg/><dgm:whole/>${ext}</dgm:dataModel>`,
    layout: `${HDR}<dgm:layoutDef xmlns:dgm="${DGM}" xmlns:a="${AN}" uniqueId="${lo}"><dgm:title val=""/><dgm:desc val=""/>${cat(CAT[kind], 1000)}<dgm:layoutNode name="diagram"><dgm:alg type="lin"/><dgm:shape xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/></dgm:layoutNode></dgm:layoutDef>`,
    style: `${HDR}<dgm:styleDef xmlns:dgm="${DGM}" xmlns:a="${AN}" uniqueId="${qs}"><dgm:title val=""/><dgm:desc val=""/>${cat('simple', 10100)}<dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d></dgm:styleDef>`,
    colors: `${HDR}<dgm:colorsDef xmlns:dgm="${DGM}" xmlns:a="${AN}" uniqueId="${cs}"><dgm:title val=""/><dgm:desc val=""/>${cat('accent1', 11200)}</dgm:colorsDef>`,
    drawing: dr.xml,
  };
}

// Reads a data model back into {kind, items}. `doc` is the parsed dataN.xml.
export function smartConfig(doc) {
  const all = [...doc.getElementsByTagName('*')];
  const pts = all.filter((e) => e.localName === 'pt' && e.namespaceURI === DGM);
  const root = pts.find((p) => p.getAttribute('type') === 'doc');
  const pr = root && [...root.children].find((c) => c.localName === 'prSet');
  const lo = (pr && pr.getAttribute('loTypeId')) || '';
  const kind = /pyramid/i.test(lo) ? 'pyramid' : /cycle/i.test(lo) ? 'cycle' : /hierarchy|orgchart/i.test(lo) ? 'hierarchy' : /process|chevron|arrow/i.test(lo) ? 'process' : 'list';
  const items = pts.filter((p) => !p.getAttribute('type') || p.getAttribute('type') === 'node')
    .map((p) => [...p.getElementsByTagName('*')].filter((e) => e.localName === 't' && e.namespaceURI === AN).map((e) => e.textContent).join('').trim())
    .filter(Boolean).slice(0, 8);
  return items.length ? { kind, items } : null;
}
