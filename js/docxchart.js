// Native (editable) Word charts: a DrawingML chart part plus an embedded workbook so "Edit Data" works in Word.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => String.fromCharCode(65 + i);                // series columns B.. (max 12 series, so one letter is enough)
const hex = (c) => String(c).replace('#', '').toUpperCase();
const txPr = (sz = 900, bold = false) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function cat(cfg) {
  const n = cfg.labels.length;
  return `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f><c:strCache><c:ptCount val="${n}"/>${cfg.labels.map((l, i) => `<c:pt idx="${i}"><c:v>${esc(l)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`;
}
function ser(cfg, s, i, colors, kind) {
  const n = cfg.labels.length, L = col(i + 1);
  const fill = `<a:solidFill><a:srgbClr val="${hex(colors[i % colors.length])}"/></a:solidFill>`;
  let sp;
  if (kind === 'line') sp = `<c:spPr><a:ln w="28575" cap="rnd">${fill}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${fill}</c:spPr></c:marker>`;
  else sp = `<c:spPr>${fill}</c:spPr>`;
  let dpt = '';
  if (kind === 'pie') dpt = cfg.labels.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${hex(colors[k % colors.length])}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('');
  if (kind === 'pie') sp = '';
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$${L}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>${sp}${kind === 'bar' ? '<c:invertIfNegative val="0"/>' : ''}${dpt}${cat(cfg)}<c:val><c:numRef><c:f>Sheet1!$${L}$2:$${L}$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${cfg.labels.map((_, k) => `<c:pt idx="${k}"><c:v>${Number(s.values[k]) || 0}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>${kind === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
}

export function chartXml(cfg, colors) {
  const type = cfg.type;
  const series = cfg.series;
  const ax = '<c:axId val="111111"/><c:axId val="222222"/>';
  let plot, axes = '';
  if (type === 'pie' || type === 'donut') {
    const s = series.slice(0, 1);
    plot = type === 'pie'
      ? `<c:pieChart><c:varyColors val="1"/>${s.map((q, i) => ser(cfg, q, i, colors, 'pie')).join('')}<c:firstSliceAng val="0"/></c:pieChart>`
      : `<c:doughnutChart><c:varyColors val="1"/>${s.map((q, i) => ser(cfg, q, i, colors, 'pie')).join('')}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  } else {
    const horiz = type === 'bar';
    if (type === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'line')).join('')}<c:marker val="1"/>${ax}</c:lineChart>`;
    else if (type === 'area') plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'area')).join('')}${ax}</c:areaChart>`;
    else {
      const stacked = type === 'stacked';
      plot = `<c:barChart><c:barDir val="${horiz ? 'bar' : 'col'}"/><c:grouping val="${stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${series.map((q, i) => ser(cfg, q, i, colors, 'bar')).join('')}<c:gapWidth val="80"/>${stacked ? '<c:overlap val="100"/>' : ''}${ax}</c:barChart>`;
    }
    const line = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BDBDBD"/></a:solidFill></a:ln></c:spPr>';
    axes = `<c:catAx><c:axId val="111111"/><c:scaling><c:orientation val="${horiz ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${line}${txPr()}<c:crossAx val="222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
      + `<c:valAx><c:axId val="222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E6E6E6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr()}<c:crossAx val="111111"/><c:crosses val="${horiz ? 'max' : 'autoZero'}"/><c:crossBetween val="${type === 'area' ? 'midCat' : 'between'}"/></c:valAx>`;
  }
  const title = (cfg.title || '').trim();
  const titleXml = title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const legend = (series.length > 1 || type === 'pie' || type === 'donut') ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr()}</c:legend>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${titleXml}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}

// A minimal workbook holding the chart's data: labels in column A, one series per column after it.
export async function workbook(JSZip, cfg) {
  const rows = [['', ...cfg.series.map((s) => s.name)], ...cfg.labels.map((l, i) => [l, ...cfg.series.map((s) => Number(s.values[i]) || 0)])];
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
