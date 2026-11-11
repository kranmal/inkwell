// Maps the editor DOM to per-block plain text and back to DOM Ranges,
// so proofing and find can work on strings without touching the document.
const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,div';

export function blocksOf(root, { skipCode = false } = {}) {
  const out = [];
  let cur = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
      if (n.classList.contains('page-break')) return NodeFilter.FILTER_REJECT;
      if (skipCode && (n.tagName === 'PRE' || n.tagName === 'CODE')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 1) {
      if (n.tagName === 'BR' && cur) cur.text += '\n';
      continue;
    }
    const el = n.parentElement.closest(BLOCK_SEL) || root;
    if (!cur || cur.el !== el) { cur = { el, text: '', segs: [] }; out.push(cur); }
    cur.segs.push({ node: n, start: cur.text.length });
    cur.text += n.data;
  }
  return out;
}

function locate(block, pos, preferEnd) {
  const segs = block.segs;
  let i = segs.length - 1;
  while (i > 0 && (preferEnd ? segs[i].start >= pos : segs[i].start > pos)) i--;
  const seg = segs[i];
  return [seg.node, Math.max(0, Math.min(seg.node.length, pos - seg.start))];
}

export function toRange(block, start, end) {
  const r = document.createRange();
  r.setStart(...locate(block, start, false));
  r.setEnd(...locate(block, end, true));
  return r;
}
