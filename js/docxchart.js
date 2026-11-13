// Native (editable) Word charts: a DrawingML chart part plus an embedded workbook so "Edit Data" works in Word.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => String.fromCharCode(65 + i);                // series columns B.. (max 12 series, so one letter is enough)
const hex = (c) => String(c).replace('#', '').toUpperCase();
const txPr = (sz = 900, bold = false) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

const axTitle = (t, rot) => (t && String(t).trim() ? `<c:title><c:tx><c:rich><a:bodyPr${rot ? ' rot="-5400000" vert="horz"' : ''}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="0"/></a:pPr><a:r><a:rPr lang="en-US" sz="1000" b="0"/><a:t>${esc(String(t).trim())}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` : '');
const dLbls = (cfg, kind) => (cfg.dataLabels ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}<c:showLegendKey val="0"/><c:showVal val="${kind === 'pie' ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${kind === 'pie' ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>` : '');
function cat(cfg) {
  const n = cfg.labels.length;
  return `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f><c:strCache><c:ptCount val="${n}"/>${cfg.labels.map((l, i) => `<c:pt idx="${i}"><c:v>${esc(l)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`;
}
// X values of a scatter chart: the label column read as numbers, or 1, 2, 3 … where a label is not a number.
export function xValues(cfg) {
  return cfg.labels.map((l, i) => { const v = Number(String(l).replace(/[,\s%£$€]/g, '')); return String(l).trim() !== '' && isFinite(v) ? v : i + 1; });
}
function ser(cfg, s, i, colors, kind) {
  const n = cfg.labels.length, L = col(i + 1);
  const fill = `<a:solidFill><a:srgbClr val="${hex(colors[i % colors.length])}"/></a:solidFill>`;
  let sp;
  if (kind === 'line' || kind === 'radar') sp = `<c:spPr><a:ln w="28575" cap="rnd">${fill}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${fill}</c:spPr></c:marker>`;
  else sp = `<c:spPr>${fill}</c:spPr>`;
  let dpt = '';
  if (kind === 'pie') dpt = cfg.labels.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${hex(colors[k % colors.length])}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('');
  if (kind === 'pie') sp = '';
  if (kind === 'scatter') {
    sp = `<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="8"/><c:spPr>${fill}</c:spPr></c:marker>`;
    const nums = (f, v) => `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${v.map((q, k) => `<c:pt idx="${k}"><c:v>${q}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`;
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$${L}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>${sp}${dLbls(cfg, kind)}<c:xVal>${nums(`Sheet1!$A$2:$A$${n + 1}`, xValues(cfg))}</c:xVal><c:yVal>${nums(`Sheet1!$${L}$2:$${L}$${n + 1}`, cfg.labels.map((_, k) => Number(s.values[k]) || 0))}</c:yVal><c:smooth val="0"/></c:ser>`;
  }
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$${L}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>${sp}${kind === 'bar' ? '<c:invertIfNegative val="0"/>' : ''}${dpt}${dLbls(cfg, kind)}${cat(cfg)}<c:val><c:numRef><c:f>Sheet1!$${L}$2:$${L}$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${cfg.labels.map((_, k) => `<c:pt idx="${k}"><c:v>${Number(s.values[k]) || 0}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>${kind === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
}

// Bubble series come in pairs: a Y series, then its size series (an odd last Y has equal bubbles).
function bser(cfg, y, z, k, colors) {
  const n = cfg.labels.length, L = col(2 * k + 1), S = col(2 * k + 2);
  const fill = `<a:solidFill><a:srgbClr val="${hex(colors[k % colors.length])}"/></a:solidFill>`;
  const nums = (f, v) => `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${v.map((q, i) => `<c:pt idx="${i}"><c:v>${q}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`;
  const size = z ? nums(`Sheet1!$${S}$2:$${S}$${n + 1}`, z.values.slice(0, n).map((v) => Math.abs(Number(v) || 0))) : `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${cfg.labels.map((_, i) => `<c:pt idx="${i}"><c:v>1</c:v></c:pt>`).join('')}</c:numLit>`;
  return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:strRef><c:f>Sheet1!$${L}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(y.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${hex(colors[k % colors.length])}"><a:alpha val="60000"/></a:srgbClr></a:solidFill><a:ln w="19050">${fill}</a:ln></c:spPr><c:invertIfNegative val="0"/>${dLbls(cfg, 'bubble')}<c:xVal>${nums(`Sheet1!$A$2:$A$${n + 1}`, xValues(cfg))}</c:xVal><c:yVal>${nums(`Sheet1!$${L}$2:$${L}$${n + 1}`, y.values.slice(0, n).map((v) => Number(v) || 0))}</c:yVal><c:bubbleSize>${size}</c:bubbleSize><c:bubble3D val="0"/></c:ser>`;
}

export function chartXml(cfg, baseColors) {
  const type = cfg.type;
  const series = cfg.series;
  const own = (c) => (/^#?[0-9a-f]{6}$/i.test(c || '') ? c : null);   // series colours that came in from Word
  let colors = baseColors.map((c, i) => own(series[type === 'bubble' ? 2 * i : i] && series[type === 'bubble' ? 2 * i : i].color) || c);
  if (type === 'pie' || type === 'donut') {
    const pc = (series[0] && series[0].pointColors) || [];
    colors = baseColors.map((c, k) => own(pc[k]) || c);
  }
  const rng = (cfg.valMin != null || cfg.valMax != null)
    ? `${cfg.valMax != null ? `<c:max val="${Number(cfg.valMax)}"/>` : ''}${cfg.valMin != null ? `<c:min val="${Number(cfg.valMin)}"/>` : ''}` : '';
  const ax = '<c:axId val="111111"/><c:axId val="222222"/>';
  let plot, axes = '';
  if (type === 'pie' || type === 'donut') {
    const s = series.slice(0, 1);
    plot = type === 'pie'
      ? `<c:pieChart><c:varyColors val="1"/>${s.map((q, i) => ser(cfg, q, i, colors, 'pie')).join('')}<c:firstSliceAng val="0"/></c:pieChart>`
      : `<c:doughnutChart><c:varyColors val="1"/>${s.map((q, i) => ser(cfg, q, i, colors, 'pie')).join('')}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  } else {
    const horiz = type === 'bar';
    const sec = type === 'combo' && !!cfg.secondary && series.length > 1;
    if (type === 'bubble') {
      const pairs = [];
      for (let k = 0; k < series.length; k += 2) pairs.push(bser(cfg, series[k], series[k + 1], k / 2, colors));
      plot = `<c:bubbleChart><c:varyColors val="0"/>${pairs.join('')}<c:bubbleScale val="100"/><c:showNegBubbles val="0"/>${ax}</c:bubbleChart>`;
    } else if (type === 'scatter') plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'scatter')).join('')}${ax}</c:scatterChart>`;
    else if (type === 'radar') plot = `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'radar')).join('')}${ax}</c:radarChart>`;
    else if (type === 'combo') {
      plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series.slice(0, 1).map((q, i) => ser(cfg, q, i, colors, 'bar')).join('')}<c:gapWidth val="80"/>${ax}</c:barChart>`;
      if (series.length > 1) plot += `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.slice(1).map((q, i) => ser(cfg, q, i + 1, colors, 'line')).join('')}<c:marker val="1"/>${sec ? '<c:axId val="333333"/><c:axId val="444444"/>' : ax}</c:lineChart>`;
    } else if (type === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'line')).join('')}<c:marker val="1"/>${ax}</c:lineChart>`;
    else if (type === 'area') plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'area')).join('')}${ax}</c:areaChart>`;
    else {
      const stacked = type === 'stacked' || type === 'stacked100', p100 = type === 'stacked100';
      plot = `<c:barChart><c:barDir val="${horiz ? 'bar' : 'col'}"/><c:grouping val="${p100 ? 'percentStacked' : stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'bar')).join('')}<c:gapWidth val="80"/>${stacked ? '<c:overlap val="100"/>' : ''}${ax}</c:barChart>`;
    }
    const line = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BDBDBD"/></a:solidFill></a:ln></c:spPr>';
    if (type === 'scatter' || type === 'bubble') {
      const vax = (id, cross, pos, grid0) => { const grid = grid0 && cfg.grid !== false, fc = id === 222222 && cfg.numFmt ? cfg.numFmt : 'General'; return `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${grid ? '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E6E6E6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : ''}${axTitle(id === 111111 ? cfg.catTitle : cfg.valTitle, pos === 'l')}<c:numFmt formatCode="${esc(fc)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${line}${txPr()}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`; };
      axes = vax(111111, 222222, 'b', false) + vax(222222, 111111, 'l', true);
    } else axes = `<c:catAx><c:axId val="111111"/><c:scaling><c:orientation val="${horiz ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'l' : 'b'}"/>${axTitle(cfg.catTitle, horiz)}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${line}${txPr()}<c:crossAx val="222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
      + `<c:valAx><c:axId val="222222"/><c:scaling><c:orientation val="minMax"/>${rng}</c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'b' : 'l'}"/>${cfg.grid === false ? '' : '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E6E6E6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'}${axTitle(cfg.valTitle, !horiz)}<c:numFmt formatCode="${esc(type === 'stacked100' ? '0%' : cfg.numFmt || 'General')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr()}<c:crossAx val="111111"/><c:crosses val="${horiz ? 'max' : 'autoZero'}"/><c:crossBetween val="${type === 'area' ? 'midCat' : 'between'}"/></c:valAx>`;
    if (sec) axes += `<c:catAx><c:axId val="333333"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="444444"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="444444"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="r"/>${axTitle(cfg.secTitle, true)}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr()}<c:crossAx val="333333"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx>`;
  }
  const title = (cfg.title || '').trim();
  const titleXml = title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const legend = (series.length > 1 || type === 'combo' || type === 'pie' || type === 'donut') ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr()}</c:legend>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${titleXml}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}

// A minimal workbook holding the chart's data: labels in column A, one series per column after it.
export async function workbook(JSZip, cfg) {
  const rows = [['', ...cfg.series.map((s) => s.name)], ...cfg.labels.map((l, i) => [cfg.type === 'scatter' || cfg.type === 'bubble' ? xValues(cfg)[i] : l,...cfg.series.map((s) => Number(s.values[i]) || 0)])];
  const cell = (v, r, c) => {
    const ref = col(c) + (r + 1);
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  };
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  z.file('xl/worksheets/sheet1.xml', sheet);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
