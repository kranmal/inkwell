// TrueType reading and subsetting for the PDF export. Glyph ids are kept as they are, so a subset is the
// original font with every unused glyph emptied; PDF then addresses glyphs directly (Identity-H).
// CFF/OpenType (.otf), font collections (.ttc) and fonts whose licence forbids embedding return null.

const tagOf = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

export function parseFont(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 12) return null;
  const magic = dv.getUint32(0);
  if (magic !== 0x00010000 && magic !== 0x74727565) return null;
  const T = {};
  for (let i = 0, n = dv.getUint16(4); i < n; i++) {
    const o = 12 + i * 16;
    if (o + 16 > buf.byteLength) return null;
    T[tagOf(dv, o)] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap']) if (!T[t] || T[t].off + T[t].len > buf.byteLength) return null;
  if (T['OS/2'] && T['OS/2'].len >= 10 && (dv.getUint16(T['OS/2'].off + 8) & 0x0202)) return null; // restricted licence or bitmap-only
  const head = T.head.off, upm = dv.getUint16(head + 18), long = dv.getInt16(head + 50) === 1;
  const numGlyphs = dv.getUint16(T.maxp.off + 4), nHM = dv.getUint16(T.hhea.off + 34);
  if (!upm || !numGlyphs || !nHM) return null;

  // cmap
  const cm = T.cmap.off;
  let sub = null, score = -1;
  for (let i = 0, n = dv.getUint16(cm + 2); i < n; i++) {
    const pid = dv.getUint16(cm + 4 + i * 8), eid = dv.getUint16(cm + 6 + i * 8), off = cm + dv.getUint32(cm + 8 + i * 8);
    if (off + 4 > buf.byteLength) continue;
    const fmt = dv.getUint16(off);
    const s = fmt === 12 && ((pid === 3 && eid === 10) || pid === 0) ? 4 : fmt === 4 && pid === 3 && eid === 1 ? 3 : fmt === 4 && pid === 0 ? 2 : fmt === 12 ? 1 : -1;
    if (s > score) { score = s; sub = { off, fmt }; }
  }
  if (!sub) return null;
  const memo = new Map();
  const lookup = (cp) => {
    const { off, fmt } = sub;
    if (fmt === 12) {
      for (let i = 0, n = dv.getUint32(off + 12); i < n; i++) {
        const g = off + 16 + i * 12, a = dv.getUint32(g), b = dv.getUint32(g + 4);
        if (cp >= a && cp <= b) return dv.getUint32(g + 8) + cp - a;
      }
      return 0;
    }
    if (cp > 0xFFFF) return 0;
    const segs = dv.getUint16(off + 6) / 2, ends = off + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
    for (let i = 0; i < segs; i++) {
      if (dv.getUint16(ends + i * 2) < cp) continue;
      if (dv.getUint16(starts + i * 2) > cp) return 0;
      const ro = dv.getUint16(ranges + i * 2), delta = dv.getInt16(deltas + i * 2);
      if (!ro) return (cp + delta) & 0xFFFF;
      const g = dv.getUint16(ranges + i * 2 + ro + (cp - dv.getUint16(starts + i * 2)) * 2);
      return g ? (g + delta) & 0xFFFF : 0;
    }
    return 0;
  };
  const gid = (cp) => { let g = memo.get(cp); if (g === undefined) { g = lookup(cp); if (g >= numGlyphs) g = 0; memo.set(cp, g); } return g; };
  const adv = (g) => dv.getUint16(T.hmtx.off + Math.min(g, nHM - 1) * 4);

  const locaAt = (g) => (long ? dv.getUint32(T.loca.off + g * 4) : dv.getUint16(T.loca.off + g * 2) * 2);
  const glyph = (g) => { const a = locaAt(g), b = locaAt(g + 1); return b > a ? { a: T.glyf.off + a, b: T.glyf.off + b } : null; };
  const checksum = (u8) => { let s = 0; for (let i = 0; i < u8.length; i += 4) s = (s + (((u8[i] << 24) | (u8[i + 1] << 16) | ((u8[i + 2] || 0) << 8) | (u8[i + 3] || 0)) >>> 0)) >>> 0; return s; };

  const subset = (used) => {
    const want = new Set([0, ...used]), q = [...want];
    for (let i = 0; i < q.length; i++) { // pull in the parts of composite glyphs
      const g = glyph(q[i]);
      if (!g || g.b - g.a < 10 || dv.getInt16(g.a) >= 0) continue;
      let p = g.a + 10, fl;
      do {
        fl = dv.getUint16(p);
        const c = dv.getUint16(p + 2);
        if (!want.has(c)) { want.add(c); q.push(c); }
        p += 4 + (fl & 1 ? 4 : 2) + (fl & 8 ? 2 : fl & 0x40 ? 4 : fl & 0x80 ? 8 : 0);
      } while (fl & 0x20);
    }
    const chunks = [], loca = new DataView(new ArrayBuffer((numGlyphs + 1) * 4));
    let total = 0;
    for (let g = 0; g < numGlyphs; g++) {
      loca.setUint32(g * 4, total);
      const r = want.has(g) ? glyph(g) : null;
      if (r) { const len = (r.b - r.a + 3) & ~3; chunks.push([r, len]); total += len; }
    }
    loca.setUint32(numGlyphs * 4, total);
    const glyf = new Uint8Array(total);
    let at = 0;
    const src = new Uint8Array(buf);
    for (const [r, len] of chunks) { glyf.set(src.subarray(r.a, r.b), at); at += len; }
    const headCopy = src.slice(head, head + T.head.len);
    new DataView(headCopy.buffer).setUint32(8, 0); // checkSumAdjustment
    new DataView(headCopy.buffer).setInt16(50, 1); // long loca
    const tables = { head: headCopy, hhea: src.subarray(T.hhea.off, T.hhea.off + T.hhea.len), maxp: src.subarray(T.maxp.off, T.maxp.off + T.maxp.len), hmtx: src.subarray(T.hmtx.off, T.hmtx.off + T.hmtx.len), loca: new Uint8Array(loca.buffer), glyf };
    for (const t of ['cvt ', 'fpgm', 'prep']) if (T[t]) tables[t] = src.subarray(T[t].off, T[t].off + T[t].len);
    const tags = Object.keys(tables).sort(), n = tags.length;
    let size = 12 + n * 16;
    for (const t of tags) size += (tables[t].length + 3) & ~3;
    const out = new Uint8Array(size), o = new DataView(out.buffer);
    let sr = 1, es = 0;
    while (sr * 2 <= n) { sr *= 2; es++; }
    o.setUint32(0, 0x00010000); o.setUint16(4, n); o.setUint16(6, sr * 16); o.setUint16(8, es); o.setUint16(10, n * 16 - sr * 16);
    let pos = 12 + n * 16;
    tags.forEach((t, i) => {
      const d = tables[t], e = 12 + i * 16;
      for (let k = 0; k < 4; k++) out[e + k] = t.charCodeAt(k);
      o.setUint32(e + 4, checksum(d)); o.setUint32(e + 8, pos); o.setUint32(e + 12, d.length);
      out.set(d, pos); pos += (d.length + 3) & ~3;
    });
    return out;
  };

  const bb = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
  return { upm, numGlyphs, gid, adv, subset, bbox: bb, ascent: dv.getInt16(T.hhea.off + 4), descent: dv.getInt16(T.hhea.off + 6) };
}
