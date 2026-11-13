// Shapes, text boxes and charts.
let api;
let chartTarget = null;

// ---------- shapes ----------
const SHAPES = {
  rect: { name: 'Rectangle', w: 140, h: 90 },
  round: { name: 'Rounded rectangle', w: 140, h: 90 },
  ellipse: { name: 'Ellipse', w: 130, h: 90 },
  tri: { name: 'Triangle', w: 110, h: 96, poly: [[50, 0], [100, 100], [0, 100]] },
  arrow: { name: 'Arrow', w: 150, h: 70, poly: [[0, 30], [60, 30], [60, 0], [100, 50], [60, 100], [60, 70], [0, 70]] },
  line: { name: 'Line', w: 180, h: 3 },
  star: { name: 'Star', w: 110, h: 105, poly: [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]] },
};
const shapeKind = (el) => Object.keys(SHAPES).find((k) => el.classList.contains('shape-' + k)) || 'rect';

function insertShape(kind) {
  const def = SHAPES[kind];
  if (!def) return;
  api.closeMenus();
  api.restore();
  const s = getSelection();
  if (!s.rangeCount || !api.inEditor(s.anchorNode)) { api.toast('Click in the document first.'); return; }
  const at = api.selEl();
  if (at && at.closest('[contenteditable="false"]')) { api.toast('Put the cursor in the text first.'); return; }
  api.commit();
  const el = document.createElement('span');
  el.className = 'shape shape-' + kind;
  el.setAttribute('contenteditable', 'false');
  el.style.width = def.w + 'px'; el.style.height = def.h + 'px'; el.style.backgroundColor = '#2a78d6';
  const r = s.getRangeAt(0);
  r.collapse(false);
  r.insertNode(el);
  r.setStartAfter(el); r.collapse(true);
  s.removeAllRanges(); s.addRange(r);
  api.done();
  api.selectImg(el);
}
function fill(val) {
  api.closeMenus();
  const el = api.selImg;
  if (!el || !el.matches('.shape,.textbox')) { api.toast('Select a shape or text box first.'); return; }
  api.commit();
  el.style.backgroundColor = val || '';
  api.done();
  api.placeImgBox();
}
function insertTextbox() {
  const box = document.createElement('div');
  box.className = 'textbox';
  box.style.width = '260px';
  const p = document.createElement('p');
  p.textContent = 'Text box';
  box.append(p);
  api.insertBlock(box);
  const r = document.createRange(); r.selectNodeContents(p);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  api.done();
  api.selectImg(box);
}

// ---------- charts ----------
export const TYPES = ['column', 'stacked', 'bar', 'line', 'area', 'combo', 'scatter', 'radar', 'pie', 'donut'];
export const MAX_SERIES = 12;
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#17a2b8', '#8a5a2b', '#7a8b99', '#c2185b'];
const OTHER = '#9a9a9a', INK = '#1f1f1f', INK2 = '#5f5f5f', GRID = '#e6e6e6', AXIS = '#bdbdbd';
const W = 640, H = 360, FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
const DEMO = 'Quarter, 2025, 2026\nQ1, 120, 150\nQ2, 135, 162\nQ3, 128, 171\nQ4, 149, 190';
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const full = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const short = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const cut = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const f1 = (n) => Number(n.toFixed(1));

export function parseData(text) {
  const rows = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(l.includes('\t') ? '\t' : ',').map((c) => c.trim()));
  if (!rows.length) return null;
  const num = (v) => { const n = Number(String(v).replace(/[,\s%£$€]/g, '')); return v !== '' && v != null && isFinite(n) ? n : null; };
  // The first row is always the series names (they are often years, so they can't be told apart from data).
  const head = rows.length > 1 ? rows.shift() : null;
  const cols = Math.max(0, ...rows.map((r) => r.length)) - 1;
  if (!rows.length || cols < 1) return null;
  const series = [];
  for (let c = 1; c <= Math.min(cols, MAX_SERIES); c++) series.push({ name: (head && head[c]) || `Series ${c}`, values: rows.map((r) => num(r[c]) ?? 0) });
  return { labels: rows.map((r) => r[0] || ''), series, dropped: Math.max(0, cols - MAX_SERIES) };
}
export function toCsv(cfg) {
  const head = ['', ...cfg.series.map((s) => s.name)].join(', ').replace(/^, /, 'Label, ');
  return [head, ...cfg.labels.map((l, i) => [l, ...cfg.series.map((s) => s.values[i] ?? 0)].join(', '))].join('\n');
}
function scale(min, max) {
  if (min === max) max = min + 1;
  const raw = (max - min) / 5, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi, ticks };
}
// bar from baseline b to value end e along one axis, rounded at the value end
function vbar(px, b, e, w) {
  const r = Math.min(4, w / 2, Math.abs(e - b)), d = e < b ? 1 : -1;
  return `M${f1(px)},${f1(b)}V${f1(e + d * r)}Q${f1(px)},${f1(e)} ${f1(px + r)},${f1(e)}H${f1(px + w - r)}Q${f1(px + w)},${f1(e)} ${f1(px + w)},${f1(e + d * r)}V${f1(b)}Z`;
}
function hbar(py, b, e, h) {
  const r = Math.min(4, h / 2, Math.abs(e - b)), d = e > b ? -1 : 1;
  return `M${f1(b)},${f1(py)}H${f1(e + d * r)}Q${f1(e)},${f1(py)} ${f1(e)},${f1(py + r)}V${f1(py + h - r)}Q${f1(e)},${f1(py + h)} ${f1(e + d * r)},${f1(py + h)}H${f1(b)}Z`;
}
function legend(names, colors, y) {
  let out = '', px = 24;
  names.forEach((n, i) => {
    const label = cut(n, 22), w = 22 + label.length * 6.4 + 14;
    if (px + w > W - 16 && px > 24) return;
    out += `<rect x="${f1(px)}" y="${y - 9}" width="10" height="10" rx="2" fill="${colors[i]}"/><text x="${f1(px + 15)}" y="${y}" font-size="12" fill="${INK2}">${x(label)}</text>`;
    px += w;
  });
  return out;
}

export function renderChart(cfg) {
  const type = TYPES.includes(cfg.type) ? cfg.type : 'column';
  const labels = cfg.labels || [], series = (cfg.series || []).slice(0, MAX_SERIES);
  const title = (cfg.title || '').trim();
  let body = '';
  let top = 20;
  if (title) { body += `<text x="24" y="32" font-size="16" font-weight="600" fill="${INK}">${x(cut(title, 70))}</text>`; top = 48; }
  const desc = `${title || 'Chart'}: ${type} chart of ${series.map((s) => s.name).join(', ')} by ${labels.length} categories`;

  if (type === 'pie' || type === 'donut') {
    const vals = (series[0] ? series[0].values : []).map((v) => Math.max(0, v));
    let parts = labels.map((l, i) => ({ l, v: vals[i] || 0 })).filter((p) => p.v > 0);
    if (parts.length > 8) { const rest = parts.slice(7); parts = [...parts.slice(0, 7), { l: 'Other', v: rest.reduce((a, p) => a + p.v, 0), other: true }]; }
    const total = parts.reduce((a, p) => a + p.v, 0) || 1;
    const cx = 190, cy = top + (H - top - 20) / 2, R = Math.min(130, (H - top - 28) / 2);
    let a0 = -Math.PI / 2;
    parts.forEach((p, i) => {
      const a1 = a0 + (p.v / total) * Math.PI * 2, col = p.other ? OTHER : PALETTE[i];
      const pt = (a) => `${f1(cx + R * Math.cos(a))},${f1(cy + R * Math.sin(a))}`;
      const tip = `<title>${x(p.l)}: ${full.format(p.v)} (${f1((p.v / total) * 100)}%)</title>`;
      body += parts.length === 1
        ? `<circle cx="${cx}" cy="${f1(cy)}" r="${f1(R)}" fill="${col}">${tip}</circle>`
        : `<path d="M${cx},${f1(cy)}L${pt(a0)}A${f1(R)},${f1(R)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}Z" fill="${col}" stroke="#fff" stroke-width="2" stroke-linejoin="round">${tip}</path>`;
      const ly = cy - (parts.length - 1) * 12 + i * 24;
      body += `<rect x="372" y="${f1(ly - 9)}" width="10" height="10" rx="2" fill="${col}"/><text x="388" y="${f1(ly)}" font-size="12" fill="${INK}">${x(cut(p.l, 22))}</text><text x="${W - 24}" y="${f1(ly)}" font-size="12" fill="${INK2}" text-anchor="end">${full.format(p.v)} · ${f1((p.v / total) * 100)}%</text>`;
      a0 = a1;
    });
    if (type === 'donut' && parts.length) body += `<circle cx="${cx}" cy="${f1(cy)}" r="${f1(R * 0.55)}" fill="#fff"/>`;
    if (!parts.length) body += `<text x="${W / 2}" y="${H / 2}" font-size="13" fill="${INK2}" text-anchor="middle">No positive values to show</text>`;
  } else {
    if (series.length > 1) { body += legend(series.map((s) => s.name), PALETTE, top + 8); top += 26; }
    const all = series.flatMap((s) => s.values);
    const stackTot = (i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0);
    const hiV = type === 'stacked' ? Math.max(0, ...labels.map((_, i) => stackTot(i))) : Math.max(0, ...all);
    const sc = scale(Math.min(0, ...all), hiV);
    const n = Math.max(1, labels.length), m = series.length || 1;
    if (type === 'scatter') {
      const xs = labels.map((l, i) => { const v = Number(String(l).replace(/[,\s%£$€]/g, '')); return String(l).trim() !== '' && isFinite(v) ? v : i + 1; });
      const sx = scale(Math.min(...xs, Infinity) === Infinity ? 0 : Math.min(...xs), Math.max(...xs, -Infinity) === -Infinity ? 1 : Math.max(...xs));
      const L = 56, R = W - 24, T = top + 8, B = H - 40;
      const Y = (v) => B - ((v - sc.lo) / (sc.hi - sc.lo)) * (B - T), X = (v) => L + ((v - sx.lo) / (sx.hi - sx.lo)) * (R - L);
      for (const t of sc.ticks) body += `<line x1="${L}" x2="${R}" y1="${f1(Y(t))}" y2="${f1(Y(t))}" stroke="${GRID}"/><text x="${L - 8}" y="${f1(Y(t) + 4)}" font-size="11" fill="${INK2}" text-anchor="end">${short.format(t)}</text>`;
      for (const t of sx.ticks) body += `<line x1="${f1(X(t))}" x2="${f1(X(t))}" y1="${T}" y2="${B}" stroke="${GRID}"/><text x="${f1(X(t))}" y="${B + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${short.format(t)}</text>`;
      series.forEach((s, j) => xs.forEach((xv, i) => { body += `<circle cx="${f1(X(xv))}" cy="${f1(Y(s.values[i] || 0))}" r="5" fill="${PALETTE[j]}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"><title>${x(s.name)}: (${full.format(xv)}, ${full.format(s.values[i] || 0)})</title></circle>`; }));
      body += `<line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="${AXIS}"/><line x1="${L}" x2="${L}" y1="${T}" y2="${B}" stroke="${AXIS}"/>`;
    } else if (type === 'radar') {
      const rs = scale(0, Math.max(0, ...all)), cx = W / 2, cy = (top + H - 8) / 2 + 4, R0 = Math.min((H - top - 52) / 2, 140), k = Math.max(3, n);
      const ang = (i) => -Math.PI / 2 + (i / k) * Math.PI * 2, P = (i, r) => `${f1(cx + r * Math.cos(ang(i)))},${f1(cy + r * Math.sin(ang(i)))}`;
      const rad = (v) => ((v - rs.lo) / (rs.hi - rs.lo)) * R0;
      for (const t of rs.ticks) {
        if (t <= rs.lo) continue;
        body += `<path d="M${Array.from({ length: k }, (_, i) => P(i, rad(t))).join('L')}Z" fill="none" stroke="${GRID}"/><text x="${f1(cx + 4)}" y="${f1(cy - rad(t) + 11)}" font-size="10" fill="${INK2}">${short.format(t)}</text>`;
      }
      labels.forEach((l, i) => {
        const a = ang(i), tx = cx + (R0 + 14) * Math.cos(a), ty = cy + (R0 + 14) * Math.sin(a) + 4, an = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
        body += `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx + R0 * Math.cos(a))}" y2="${f1(cy + R0 * Math.sin(a))}" stroke="${GRID}"/><text x="${f1(tx)}" y="${f1(ty)}" font-size="11" fill="${INK2}" text-anchor="${an}">${x(cut(l, 14))}</text>`;
      });
      series.forEach((s, j) => {
        const pts = labels.map((_, i) => P(i, Math.max(0, rad(s.values[i] || 0))));
        body += `<path d="M${pts.join('L')}Z" fill="${PALETTE[j]}" fill-opacity="0.15" stroke="${PALETTE[j]}" stroke-width="2" stroke-linejoin="round"/>`;
        labels.forEach((l, i) => { const [px, py] = pts[i].split(','); body += `<circle cx="${px}" cy="${py}" r="3.5" fill="${PALETTE[j]}" stroke="#fff" stroke-width="1.5"><title>${x(l)} · ${x(s.name)}: ${full.format(s.values[i] || 0)}</title></circle>`; });
      });
    } else if (type === 'bar') {
      const longest = Math.max(0, ...labels.map((l) => Math.min(l.length, 18)));
      const L = 28 + longest * 6.2, R = W - 28, T = top + 6, B = H - 34;
      const X = (v) => L + ((v - sc.lo) / (sc.hi - sc.lo)) * (R - L);
      for (const t of sc.ticks) body += `<line x1="${f1(X(t))}" x2="${f1(X(t))}" y1="${T}" y2="${B}" stroke="${GRID}"/><text x="${f1(X(t))}" y="${B + 16}" font-size="11" fill="${INK2}" text-anchor="middle">${short.format(t)}</text>`;
      const band = (B - T) / n, pad = Math.min(10, band * 0.18), bh = Math.max(2, (band - pad * 2 - (m - 1) * 2) / m);
      labels.forEach((l, i) => {
        body += `<text x="${f1(L - 8)}" y="${f1(T + band * i + band / 2 + 4)}" font-size="11" fill="${INK2}" text-anchor="end">${x(cut(l, 18))}</text>`;
        series.forEach((s, j) => {
          const v = s.values[i] || 0;
          if (v) body += `<path d="${hbar(T + band * i + pad + j * (bh + 2), X(0), X(v), bh)}" fill="${PALETTE[j]}"><title>${x(l)} · ${x(s.name)}: ${full.format(v)}</title></path>`;
        });
      });
      body += `<line x1="${f1(X(0))}" x2="${f1(X(0))}" y1="${T}" y2="${B}" stroke="${AXIS}"/>`;
    } else {
      const L = 56, R = W - 24, T = top + 8, B = H - 40;
      const Y = (v) => B - ((v - sc.lo) / (sc.hi - sc.lo)) * (B - T);
      for (const t of sc.ticks) body += `<line x1="${L}" x2="${R}" y1="${f1(Y(t))}" y2="${f1(Y(t))}" stroke="${GRID}"/><text x="${L - 8}" y="${f1(Y(t) + 4)}" font-size="11" fill="${INK2}" text-anchor="end">${short.format(t)}</text>`;
      const band = (R - L) / n;
      const every = Math.ceil(n / Math.max(1, Math.floor((R - L) / 64)));
      const maxCh = Math.max(3, Math.floor((band * every) / 6.4));
      labels.forEach((l, i) => { if (i % every === 0) body += `<text x="${f1(L + band * i + band / 2)}" y="${B + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${x(cut(l, maxCh))}</text>`; });
      if (type === 'stacked') {
        const pad = Math.min(14, band * 0.18), bw = Math.max(2, band - pad * 2);
        labels.forEach((l, i) => { let acc = 0; series.forEach((s, j) => {
          const v = Math.max(0, s.values[i] || 0);
          if (v) { const y0 = Y(acc), y1 = Y(acc + v); body += `<rect x="${f1(L + band * i + pad)}" y="${f1(y1)}" width="${f1(bw)}" height="${f1(Math.max(0.5, y0 - y1 - 1))}" fill="${PALETTE[j]}"><title>${x(l)} · ${x(s.name)}: ${full.format(v)}</title></rect>`; }
          acc += v;
        }); });
      } else if (type === 'column' || type === 'combo') {
        const mm = type === 'combo' ? 1 : m, pad = Math.min(14, band * 0.18), bw = Math.max(2, (band - pad * 2 - (mm - 1) * 2) / mm);
        labels.forEach((l, i) => series.slice(0, mm).forEach((s, j) => {
          const v = s.values[i] || 0;
          if (v) body += `<path d="${vbar(L + band * i + pad + j * (bw + 2), Y(0), Y(v), bw)}" fill="${PALETTE[j]}"><title>${x(l)} · ${x(s.name)}: ${full.format(v)}</title></path>`;
        }));
        if (type === 'combo') series.forEach((s, j) => {
          if (j === 0) return;
          const pts = labels.map((l, i) => [L + band * i + band / 2, Y(s.values[i] || 0)]);
          body += `<path d="M${pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L')}" fill="none" stroke="${PALETTE[j]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
          if (n <= 24) pts.forEach((p, i) => { body += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="4" fill="${PALETTE[j]}" stroke="#fff" stroke-width="2"><title>${x(labels[i])} · ${x(s.name)}: ${full.format(s.values[i] || 0)}</title></circle>`; });
        });
      } else {
        series.forEach((s, j) => {
          const pts = labels.map((l, i) => [L + band * i + band / 2, Y(s.values[i] || 0)]);
          if (type === 'area') body += `<path d="M${f1(pts[0][0])},${f1(Y(0))}L${pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L')}L${f1(pts[pts.length - 1][0])},${f1(Y(0))}Z" fill="${PALETTE[j]}" fill-opacity="0.3"/>`;
          body += `<path d="M${pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L')}" fill="none" stroke="${PALETTE[j]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
          if (n <= 24) pts.forEach((p, i) => { body += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="4" fill="${PALETTE[j]}" stroke="#fff" stroke-width="2"><title>${x(labels[i])} · ${x(s.name)}: ${full.format(s.values[i] || 0)}</title></circle>`; });
        });
      }
      body += `<line x1="${L}" x2="${R}" y1="${f1(Y(0))}" y2="${f1(Y(0))}" stroke="${AXIS}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${x(desc)}" font-family="${FONT}">${body}</svg>`;
}
export function readCfg(fig) { try { const c = JSON.parse(fig.dataset.chart || ''); return c && Array.isArray(c.series) ? c : null; } catch { return null; } }
function draw(fig) {
  const cfg = readCfg(fig);
  fig.innerHTML = cfg ? renderChart(cfg) : '';
  if (fig.getAttribute('contenteditable') !== 'false') fig.setAttribute('contenteditable', 'false');
}
function ensureCharts() {
  for (const fig of api.editor.querySelectorAll('figure.chart')) if (!fig.querySelector('svg')) draw(fig);
}
function openChart(target) {
  chartTarget = target && target.isConnected && target.matches('.chart') ? target : null;
  const cfg = chartTarget ? readCfg(chartTarget) : null;
  api.$('#ch-type').value = cfg ? cfg.type : 'column';
  api.$('#ch-title').value = cfg ? cfg.title || '' : '';
  api.$('#ch-data').value = cfg ? toCsv(cfg) : DEMO;
  api.$('#ch-ok').textContent = chartTarget ? 'Update chart' : 'Insert chart';
  const dlg = api.$('#dlg-chart');
  dlg.returnValue = '';
  dlg.showModal();
}
function applyChart() {
  const data = parseData(api.$('#ch-data').value);
  if (!data) { api.toast('The chart needs a label column and at least one column of numbers.'); return; }
  const cfg = { type: api.$('#ch-type').value, title: api.$('#ch-title').value.trim(), labels: data.labels, series: data.series };
  if (data.dropped) api.toast('Charts show up to 12 series. The extra columns were left out.');
  if (chartTarget && chartTarget.isConnected) {
    api.commit();
    chartTarget.dataset.chart = JSON.stringify(cfg);
    draw(chartTarget);
    api.done();
    api.placeImgBox();
    return;
  }
  const fig = document.createElement('figure');
  fig.className = 'chart';
  fig.dataset.chart = JSON.stringify(cfg);
  draw(fig);
  api.restore();
  api.caretIn(api.insertBlock(fig));
  api.done();
}

// ---------- PNG rendering for Word export ----------
const blobBytes = (canvas) => new Promise((res) => canvas.toBlob(async (b) => res(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/png'));
export async function toPng(el) {
  const k = 2;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (el.matches('.chart')) {
    const cfg = readCfg(el);
    if (!cfg) return null;
    const w = Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width / (api ? api.zoomF() : 1) || W), h = Math.round((w * H) / W);
    c.width = W * k; c.height = H * k;
    const url = URL.createObjectURL(new Blob([renderChart(cfg)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
    } catch { return null; } finally { URL.revokeObjectURL(url); }
    return { bytes: await blobBytes(c), w, h };
  }
  const kind = shapeKind(el), def = SHAPES[kind];
  const w = Math.max(4, Math.round(parseFloat(el.style.width) || def.w)), h = Math.max(2, Math.round(parseFloat(el.style.height) || def.h));
  c.width = w * k; c.height = h * k;
  g.scale(k, k);
  g.fillStyle = el.style.backgroundColor || '#2a78d6';
  g.beginPath();
  if (def.poly) def.poly.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo']((px / 100) * w, (py / 100) * h));
  else if (kind === 'ellipse') g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (kind === 'round' && g.roundRect) g.roundRect(0, 0, w, h, Math.min(14, w / 2, h / 2));
  else g.rect(0, 0, w, h);
  g.closePath(); g.fill();
  return { bytes: await blobBytes(c), w, h };
}

export function init(a) {
  api = a;
  const { $, editor } = api;
  api.cmd('shape', insertShape);
  api.cmd('fill', fill);
  api.cmd('textbox', insertTextbox);
  api.cmd('chart', () => { api.restore(); openChart(null); });
  api.cmd('chartEdit', () => openChart(api.selImg));

  const shapes = $('#m-shapes');
  if (shapes) shapes.innerHTML = Object.entries(SHAPES).map(([k, d]) => `<button data-cmd="shape" data-val="${k}"><span class="shape-ico shape shape-${k}"></span>${d.name}</button>`).join('');
  const sw = $('#m-fill .swatches');
  if (sw) sw.innerHTML = [...PALETTE, ...api.COLORS].map((c) => `<button data-cmd="fill" data-val="${c}" style="background:${c}" title="${c}" aria-label="Fill ${c}"></button>`).join('');

  $('#dlg-chart').addEventListener('close', (e) => { if (e.target.returnValue === 'ok') applyChart(); chartTarget = null; });
  editor.addEventListener('dblclick', (e) => { const fig = e.target.closest && e.target.closest('figure.chart'); if (fig) { api.selectImg(fig); openChart(fig); } });
  api.on('meta', ensureCharts);
  api.on('load', ensureCharts);
  api.on('refresh', () => {
    const el = api.selImg;
    if (!el || !el.classList.contains('textbox')) return;
    const s = getSelection();
    if (!el.isConnected || (s.rangeCount && api.inEditor(s.anchorNode) && !el.contains(s.anchorNode))) api.selectImg(null);
  });
}
