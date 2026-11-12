// Equations, WordArt-style headline text and SmartArt-style diagrams.
let api;
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- equations ----------
// A small LaTeX-like language: \frac{a}{b}, \sqrt{x}, \sqrt[3]{x}, x^2, a_i, \sum_{i=1}^{n}, Greek letters and common symbols.
const SYM = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', degree: '°', ldots: '…', cdots: '⋯',
};
const OPS = {
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', propto: '∝', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', forall: '∀', exists: '∃', sum: '∑', prod: '∏', int: '∫', oint: '∮', angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴',
};
const FUNCS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lim', 'exp', 'min', 'max', 'det', 'gcd'];
const BIG = '∑∏∫∮';

function parse(src) {
  let i = 0;
  const s = String(src || '');
  const group = () => { // after '{'
    const r = row('}');
    if (s[i] === '}') i++;
    return r;
  };
  const arg = () => {
    while (s[i] === ' ') i++;
    if (s[i] === '{') { i++; return group(); }
    return atom() || { t: 'row', c: [] };
  };
  function atom() {
    while (s[i] === ' ') i++;
    const ch = s[i];
    if (ch === undefined) return null;
    if (ch === '{') { i++; return group(); }
    if (ch === '\\') {
      i++;
      let name = '';
      while (i < s.length && /[A-Za-z]/.test(s[i])) name += s[i++];
      if (!name) { const c = s[i++] || ''; return c === ' ' || c === ',' || c === ';' ? { t: 'o', v: ' ' } : { t: 'o', v: c }; }
      if (name === 'frac') { const a = arg(), b = arg(); return { t: 'frac', a, b }; }
      if (name === 'sqrt') {
        let n = null;
        if (s[i] === '[') { const j = s.indexOf(']', i); if (j > 0) { n = parse(s.slice(i + 1, j)); i = j + 1; } }
        return { t: 'sqrt', a: arg(), n };
      }
      if (name === 'text' || name === 'mathrm') { while (s[i] === ' ') i++; if (s[i] === '{') { const j = s.indexOf('}', i); const v = s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; return { t: 'text', v }; } return { t: 'text', v: '' }; }
      if (name === 'left' || name === 'right') { const c = s[i++] || ''; return c === '.' ? { t: 'row', c: [] } : { t: 'o', v: c }; }
      if (name === 'quad' || name === 'qquad') return { t: 'o', v: ' ' };
      if (SYM[name]) return { t: 'i', v: SYM[name] };
      if (OPS[name]) return { t: 'o', v: OPS[name] };
      if (FUNCS.includes(name)) return { t: 'f', v: name };
      return { t: 'text', v: '\\' + name };
    }
    if (/[0-9]/.test(ch)) { let v = ''; while (i < s.length && /[0-9.,]/.test(s[i]) && !(/[.,]/.test(s[i]) && !/[0-9]/.test(s[i + 1] || ''))) v += s[i++]; return { t: 'n', v }; }
    if (/[A-Za-z]/.test(ch)) { i++; return { t: 'i', v: ch }; }
    i++;
    if (ch === '-') return { t: 'o', v: '−' };
    if (ch === '*') return { t: 'o', v: '·' };
    return { t: 'o', v: ch };
  }
  function row(end) {
    const c = [];
    while (i < s.length && s[i] !== end) {
      if (s[i] === '}') { i++; continue; }
      if (s[i] === '^' || s[i] === '_') { c.push({ t: 'row', c: [] }); } else { const a = atom(); if (!a) break; c.push(a); }
      let sub = null, sup = null;
      for (;;) {
        while (s[i] === ' ') i++;
        if (s[i] === '^' && !sup) { i++; sup = arg(); } else if (s[i] === '_' && !sub) { i++; sub = arg(); } else break;
      }
      if (sub || sup) { const b = c.pop(); c.push(sub && sup ? { t: 'subsup', b, sub, sup } : sub ? { t: 'sub', b, s: sub } : { t: 'sup', b, s: sup }); }
    }
    return { t: 'row', c };
  }
  return row(undefined);
}

function mml(n) {
  switch (n.t) {
    case 'row': return n.c.length === 1 ? mml(n.c[0]) : `<mrow>${n.c.map(mml).join('')}</mrow>`;
    case 'n': return `<mn>${xe(n.v)}</mn>`;
    case 'i': return `<mi>${xe(n.v)}</mi>`;
    case 'f': return `<mi mathvariant="normal">${xe(n.v)}</mi><mo>&#8289;</mo>`;
    case 'o': return `<mo>${xe(n.v)}</mo>`;
    case 'text': return `<mtext>${xe(n.v)}</mtext>`;
    case 'frac': return `<mfrac>${mrow(n.a)}${mrow(n.b)}</mfrac>`;
    case 'sqrt': return n.n ? `<mroot>${mrow(n.a)}${mrow(n.n)}</mroot>` : `<msqrt>${mml(n.a)}</msqrt>`;
    case 'sup': return `<msup>${mrow(n.b)}${mrow(n.s)}</msup>`;
    case 'sub': return `<msub>${mrow(n.b)}${mrow(n.s)}</msub>`;
    case 'subsup': return big(n.b) ? `<munderover>${mrow(n.b)}${mrow(n.sub)}${mrow(n.sup)}</munderover>` : `<msubsup>${mrow(n.b)}${mrow(n.sub)}${mrow(n.sup)}</msubsup>`;
    default: return '';
  }
}
const big = (n) => n && n.t === 'o' && BIG.includes(n.v) && n.v !== '∫' && n.v !== '∮';
const mrow = (n) => (n.t === 'row' ? `<mrow>${n.c.map(mml).join('')}</mrow>` : n.t === 'f' ? `<mrow>${mml(n)}</mrow>` : mml(n));
export function eqMathML(src) { return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline">${mrow(parse(src))}</math>`; }

// Office Math for Word.
const mr = (t, plain) => `<m:r>${plain ? '<m:rPr><m:nor/></m:rPr>' : ''}<m:t xml:space="preserve">${xe(t)}</m:t></m:r>`;
function om(n) {
  switch (n.t) {
    case 'row': return omRow(n.c);
    case 'n': case 'i': case 'o': return mr(n.v);
    case 'f': return mr(n.v, true);
    case 'text': return mr(n.v, true);
    case 'frac': return `<m:f><m:num>${om(n.a)}</m:num><m:den>${om(n.b)}</m:den></m:f>`;
    case 'sqrt': return n.n ? `<m:rad><m:deg>${om(n.n)}</m:deg><m:e>${om(n.a)}</m:e></m:rad>` : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${om(n.a)}</m:e></m:rad>`;
    case 'sup': return `<m:sSup><m:e>${om(n.b)}</m:e><m:sup>${om(n.s)}</m:sup></m:sSup>`;
    case 'sub': return `<m:sSub><m:e>${om(n.b)}</m:e><m:sub>${om(n.s)}</m:sub></m:sSub>`;
    case 'subsup': return `<m:sSubSup><m:e>${om(n.b)}</m:e><m:sub>${om(n.sub)}</m:sub><m:sup>${om(n.sup)}</m:sup></m:sSubSup>`;
    default: return '';
  }
}
// Big operators (sum, product, integral) take everything after them as their body, the way Word expects.
function omRow(c) {
  let out = '';
  for (let k = 0; k < c.length; k++) {
    const n = c[k];
    const base = n.t === 'o' ? n : (n.t === 'sub' || n.t === 'sup' || n.t === 'subsup') ? n.b : null;
    if (base && base.t === 'o' && BIG.includes(base.v) && (n.t !== 'o')) {
      const sub = n.t === 'sub' ? n.s : n.t === 'subsup' ? n.sub : null, sup = n.t === 'sup' ? n.s : n.t === 'subsup' ? n.sup : null;
      const loc = base.v === '∫' || base.v === '∮' ? 'subSup' : 'undOvr';
      out += `<m:nary><m:naryPr><m:chr m:val="${base.v}"/><m:limLoc m:val="${loc}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${sub ? om(sub) : ''}</m:sub><m:sup>${sup ? om(sup) : ''}</m:sup><m:e>${omRow(c.slice(k + 1))}</m:e></m:nary>`;
      return out;
    }
    out += om(n);
  }
  return out;
}
export function eqOmml(src) { return `<m:oMath>${om(parse(src))}</m:oMath>`; }

const PRESETS = [
  ['Quadratic formula', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'],
  ['Pythagoras', 'a^2 + b^2 = c^2'],
  ['Area of a circle', 'A = \\pi r^2'],
  ['Sum', '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}'],
  ['Integral', '\\int_{0}^{1} x^2 dx = \\frac{1}{3}'],
  ['Mass–energy', 'E = mc^2'],
  ['Mean', '\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i'],
  ['Limit', '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'],
];
function drawEq(el) {
  const src = el.dataset.eq || '';
  if (el.dataset.sig !== src || !el.firstChild) { el.innerHTML = eqMathML(src); el.dataset.sig = src; }
  if (el.getAttribute('contenteditable') !== 'false') el.setAttribute('contenteditable', 'false');
}
function ensureEqs() { for (const el of api.editor.querySelectorAll('span.eq')) drawEq(el); }
let eqDlg, eqTarget = null, eqRange = null;
function buildEqDialog() {
  eqDlg = document.createElement('dialog');
  eqDlg.className = 'dlg wide';
  eqDlg.innerHTML = `<form method="dialog"><h2>Equation</h2>
    <p class="dlg-note">Type it the short way: <code>\\frac{a}{b}</code> for a fraction, <code>\\sqrt{x}</code>, <code>x^2</code>, <code>a_i</code>, <code>\\pi</code>, <code>\\sum_{i=1}^{n}</code>.</p>
    <label class="field"><span>Equation</span><textarea id="eq-src" rows="3" spellcheck="false" autocomplete="off"></textarea></label>
    <div class="eq-preview" id="eq-preview" aria-live="polite"></div>
    <div class="eq-presets" id="eq-presets">${PRESETS.map(([n], k) => `<button type="button" class="btn sm" data-k="${k}">${xe(n)}</button>`).join('')}</div>
    <div class="dlg-actions"><span class="spacer"></span><button class="btn" type="button" id="eq-cancel">Cancel</button><button class="btn primary" type="button" id="eq-ok">Insert</button></div></form>`;
  document.body.append(eqDlg);
  const src = eqDlg.querySelector('#eq-src'), pv = eqDlg.querySelector('#eq-preview');
  const show = () => { pv.innerHTML = src.value.trim() ? eqMathML(src.value) : '<span class="eq-hint">Preview</span>'; };
  src.addEventListener('input', show);
  eqDlg.querySelector('#eq-presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { src.value = PRESETS[Number(b.dataset.k)][1]; show(); src.focus(); } });
  eqDlg.querySelector('#eq-cancel').addEventListener('click', () => eqDlg.close());
  eqDlg.querySelector('#eq-ok').addEventListener('click', applyEq);
  eqDlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); applyEq(); });
  eqDlg._show = show;
}
function openEq(target) {
  eqTarget = target && target.isConnected ? target : null;
  if (!eqTarget) {
    api.restore();
    const s = getSelection();
    eqRange = s.rangeCount && api.inEditor(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
    if (!eqRange) { api.toast('Click in the document first.'); return; }
  }
  eqDlg.querySelector('#eq-src').value = eqTarget ? eqTarget.dataset.eq || '' : '';
  eqDlg.querySelector('#eq-ok').textContent = eqTarget ? 'Update' : 'Insert';
  eqDlg._show();
  eqDlg.showModal();
}
function applyEq() {
  const src = eqDlg.querySelector('#eq-src').value.replace(/\s+/g, ' ').trim();
  if (!src) { api.toast('Type an equation first.'); return; }
  eqDlg.close();
  api.commit();
  let el = eqTarget;
  if (!el) {
    el = document.createElement('span');
    el.className = 'eq'; el.setAttribute('contenteditable', 'false');
    eqRange.collapse(false); eqRange.insertNode(el);
    const s = getSelection(); eqRange.setStartAfter(el); eqRange.collapse(true); s.removeAllRanges(); s.addRange(eqRange);
  }
  el.dataset.eq = src;
  drawEq(el);
  api.done();
  api.selectImg(null);
}

// ---------- WordArt ----------
const WA = { solid: 'Bold colour', outline: 'Outline', shadow: 'Shadow', gradient: 'Gradient', emboss: 'Embossed' };
async function wordArt(target) {
  const el = target && target.isConnected && target.matches('.wordart') ? target : null;
  let range = null;
  if (!el) {
    api.restore();
    const s = getSelection();
    range = s.rangeCount && api.inEditor(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
    if (!range) { api.toast('Click in the document first.'); return; }
  }
  const cur = el ? Object.keys(WA).find((k) => el.classList.contains('wa-' + k)) || 'solid' : 'gradient';
  const v = await api.ask(el ? 'Edit WordArt' : 'WordArt', [
    { id: 'text', label: 'Text', value: el ? el.textContent : (range.collapsed ? 'Your text here' : range.toString().trim().slice(0, 80) || 'Your text here') },
    { id: 'style', label: 'Style', type: 'select', value: cur, options: Object.entries(WA) },
    { id: 'size', label: 'Size (points)', type: 'number', value: el ? Math.round(parseFloat(el.style.fontSize) || 36) : 36 },
    { id: 'color', label: 'Colour', type: 'select', value: el ? el.dataset.c || '' : '', options: [['', 'Theme accent'], ...WCOL] },
  ], { ok: el ? 'Update' : 'Insert' });
  if (!v || !v.text.trim()) return;
  api.commit();
  let w = el;
  if (!w) {
    w = document.createElement('span');
    w.setAttribute('contenteditable', 'false');
    range.collapse(false); range.insertNode(w);
  }
  w.className = 'wordart wa-' + (WA[v.style] ? v.style : 'solid');
  w.textContent = v.text.trim();
  w.style.fontSize = Math.min(120, Math.max(12, Number(v.size) || 36)) + 'pt';
  const col = WCOL.find((c) => c[0] === v.color);
  if (col) { w.style.setProperty('--wa', col[0]); w.dataset.c = col[0]; } else { w.style.removeProperty('--wa'); delete w.dataset.c; }
  api.done();
  api.selectImg(w);
}
const WCOL = [['#2a78d6', 'Blue'], ['#eb6834', 'Orange'], ['#1baf7a', 'Green'], ['#6250d6', 'Violet'], ['#e34948', 'Red'], ['#1f1f1f', 'Black']];

// ---------- SmartArt ----------
const SA = { process: 'Process (steps in a row)', cycle: 'Cycle', hierarchy: 'Hierarchy (first line is the top)', list: 'Block list', pyramid: 'Pyramid' };
const SA_DEMO = { process: 'Plan\nBuild\nTest\nLaunch', cycle: 'Plan\nDo\nCheck\nAct', hierarchy: 'Director\nDesign\nEngineering\nSales', list: 'Goals\nMilestones\nRisks', pyramid: 'Vision\nStrategy\nTactics\nDaily work' };
const PAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#6250d6', '#e34948', '#008300', '#e87ba4'];
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
function lines(text, max) {
  const words = String(text).split(/\s+/), out = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}
function label(text, x, y, max, fill = '#fff', size = 15) {
  const ls = lines(text, max), lh = size * 1.2, y0 = y - ((ls.length - 1) * lh) / 2;
  return `<text x="${x.toFixed(1)}" y="${y0.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${fill}">${ls.map((l, k) => `<tspan x="${x.toFixed(1)}" dy="${k ? lh : 0}">${xe(l)}</tspan>`).join('')}</text>`;
}
export function renderSmart(cfg) {
  const items = (cfg.items || []).filter(Boolean).slice(0, 8);
  const n = items.length || 1, W = 640;
  let H = 200, body = '';
  if (cfg.kind === 'cycle') {
    H = 380;
    const cx = W / 2, cy = H / 2, R = 130, r = Math.max(38, Math.min(58, 190 / n + 22));
    items.forEach((t, k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / n, a2 = -Math.PI / 2 + ((k + 1) * 2 * Math.PI) / n, gap = (r + 8) / R;
      if (n > 1) {
        const p = (ang) => `${(cx + R * Math.cos(ang)).toFixed(1)} ${(cy + R * Math.sin(ang)).toFixed(1)}`;
        body += `<path d="M ${p(a + gap)} A ${R} ${R} 0 0 1 ${p(a2 - gap)}" fill="none" stroke="#9a9a9a" stroke-width="2.5" marker-end="url(#sa-arrow)"/>`;
      }
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${PAL[k % PAL.length]}"/>` + label(t, x, y, Math.round(r / 4.4), '#fff', 14);
    });
  } else if (cfg.kind === 'hierarchy') {
    const kids = items.slice(1), m = kids.length || 1;
    H = kids.length ? 230 : 90;
    const bw = Math.min(170, (W - 20 - (m - 1) * 14) / m), bh = 62, tx = W / 2;
    body += `<rect x="${tx - 95}" y="10" width="190" height="${bh}" rx="10" fill="${PAL[0]}"/>` + label(items[0] || '', tx, 10 + bh / 2, 20);
    const total = m * bw + (m - 1) * 14, x0 = (W - total) / 2;
    kids.forEach((t, k) => {
      const x = x0 + k * (bw + 14), cx = x + bw / 2;
      body += `<path d="M ${tx} ${10 + bh} V 112 H ${cx.toFixed(1)} V 150" fill="none" stroke="#9a9a9a" stroke-width="2"/>`;
      body += `<rect x="${x.toFixed(1)}" y="150" width="${bw.toFixed(1)}" height="${bh}" rx="10" fill="${PAL[(k + 1) % PAL.length]}"/>` + label(t, cx, 150 + bh / 2, Math.max(6, Math.round(bw / 9)), '#fff', 14);
    });
  } else if (cfg.kind === 'list') {
    const bh = 50;
    H = n * (bh + 10) + 10;
    items.forEach((t, k) => {
      const y = 10 + k * (bh + 10);
      body += `<rect x="10" y="${y}" width="${W - 20}" height="${bh}" rx="10" fill="#f1f1ee"/><rect x="10" y="${y}" width="56" height="${bh}" rx="10" fill="${PAL[k % PAL.length]}"/>`;
      body += `<text x="38" y="${y + bh / 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="18" font-weight="700" fill="#fff">${k + 1}</text>`;
      body += `<text x="82" y="${y + bh / 2}" dominant-baseline="central" font-family="${FONT}" font-size="16" font-weight="600" fill="#1f1f1f">${xe(String(t).slice(0, 60))}</text>`;
    });
  } else if (cfg.kind === 'pyramid') {
    const rh = 58;
    H = n * rh + 20;
    const cx = W / 2, top = 10, full = 560;
    items.forEach((t, k) => {
      const w1 = (full * k) / n, w2 = (full * (k + 1)) / n, y1 = top + k * rh, y2 = y1 + rh - 3;
      body += `<polygon points="${cx - w1 / 2},${y1} ${cx + w1 / 2},${y1} ${cx + w2 / 2},${y2} ${cx - w2 / 2},${y2}" fill="${PAL[k % PAL.length]}"/>`;
      body += label(t, cx, y1 + rh / 2 + (k === 0 ? 8 : 0), Math.max(8, Math.round((w1 + w2) / 2 / 9)), '#fff', k === 0 ? 12 : 15);
    });
  } else {
    const gap = 26, bw = (W - 20 - (n - 1) * gap) / n, bh = 84;
    H = bh + 20;
    items.forEach((t, k) => {
      const x = 10 + k * (bw + gap);
      body += `<rect x="${x.toFixed(1)}" y="10" width="${bw.toFixed(1)}" height="${bh}" rx="12" fill="${PAL[k % PAL.length]}"/>` + label(t, x + bw / 2, 10 + bh / 2, Math.max(6, Math.round(bw / 9)), '#fff', n > 5 ? 12 : 15);
      if (k < n - 1) body += `<path d="M ${(x + bw + 5).toFixed(1)} ${10 + bh / 2} H ${(x + bw + gap - 9).toFixed(1)}" stroke="#9a9a9a" stroke-width="2.5" marker-end="url(#sa-arrow)"/>`;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${xe((SA[cfg.kind] || 'Diagram').split(' (')[0] + ': ' + items.join(', '))}"><defs><marker id="sa-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#9a9a9a"/></marker></defs>${body}</svg>`;
}
function readSa(fig) { try { const c = JSON.parse(fig.dataset.sa || ''); return c && Array.isArray(c.items) ? c : null; } catch { return null; } }
function drawSa(fig) {
  const cfg = readSa(fig);
  fig.innerHTML = cfg ? renderSmart(cfg) : '';
  fig.dataset.sig = fig.dataset.sa || '';
  if (fig.getAttribute('contenteditable') !== 'false') fig.setAttribute('contenteditable', 'false');
}
function ensureSa() { for (const fig of api.editor.querySelectorAll('figure.smartart')) if (!fig.querySelector('svg') || fig.dataset.sig !== fig.dataset.sa) drawSa(fig); }
async function smartArt(target) {
  const fig = target && target.isConnected && target.matches('.smartart') ? target : null;
  const cfg = fig ? readSa(fig) : null;
  if (!fig) api.restore();
  const v = await api.ask(fig ? 'Edit diagram' : 'SmartArt diagram', [
    { id: 'kind', label: 'Layout', type: 'select', value: cfg ? cfg.kind : 'process', options: Object.entries(SA) },
    { id: 'items', label: 'One item per line (up to 8)', type: 'textarea', rows: 6, value: cfg ? cfg.items.join('\n') : SA_DEMO.process },
  ], { ok: fig ? 'Update' : 'Insert', wide: true });
  if (!v) return;
  const items = v.items.split('\n').map((x) => x.replace(/^[-•*\s]+/, '').trim()).filter(Boolean).slice(0, 8);
  if (!items.length) { api.toast('Add at least one item.'); return; }
  const next = { kind: SA[v.kind] ? v.kind : 'process', items };
  if (fig) {
    api.commit();
    fig.dataset.sa = JSON.stringify(next);
    drawSa(fig);
    api.done();
    api.placeImgBox();
    return;
  }
  const f = document.createElement('figure');
  f.className = 'smartart';
  f.dataset.sa = JSON.stringify(next);
  drawSa(f);
  api.restore();
  api.caretIn(api.insertBlock(f));
  api.done();
}
export async function smartPng(el) {
  const cfg = readSa(el);
  if (!cfg) return null;
  const svg = renderSmart(cfg);
  const [, , vw, vh] = (svg.match(/viewBox="([^"]+)"/) || [0, '0 0 640 200'])[1].split(' ').map(Number);
  const zoom = api ? api.zoomF() : 1;
  const w = Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width / zoom || vw), h = Math.round((w * vh) / vw);
  const c = document.createElement('canvas');
  c.width = vw * 2; c.height = vh * 2;
  const g = c.getContext('2d');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
  const bytes = await new Promise((res) => c.toBlob(async (b) => res(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/png'));
  return { bytes, w, h };
}

function editObj(el) {
  if (!el) return;
  if (el.matches('.eq')) openEq(el);
  else if (el.matches('.wordart')) wordArt(el);
  else if (el.matches('.smartart')) smartArt(el);
}

export function init(a) {
  api = a;
  buildEqDialog();
  api.cmd('equation', () => openEq(null));
  api.cmd('wordart', () => wordArt(null));
  api.cmd('smartart', () => smartArt(null));
  api.cmd('objEdit', () => editObj(api.selImg));
  const all = () => { ensureEqs(); ensureSa(); };
  api.on('meta', all);
  api.on('load', all);
  api.editor.addEventListener('dblclick', (e) => {
    const el = e.target.closest && e.target.closest('span.eq,span.wordart,figure.smartart');
    if (el) { e.preventDefault(); api.selectImg(el); editObj(el); }
  });
}
