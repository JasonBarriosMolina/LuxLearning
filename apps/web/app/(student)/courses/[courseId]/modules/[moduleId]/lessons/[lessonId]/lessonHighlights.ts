// ── Highlight helpers, split out of page.tsx ──────────────────────────────────
// Next.js App Router only allows a fixed set of named exports from a page.tsx
// (default, metadata, generateStaticParams, ...) — anything else fails
// `tsc --noEmit` against the generated `.next/types/.../page.ts` check
// ("Property 'X' is incompatible with index signature"). stripMarkup and
// applyHighlightsToHtml need to be unit-testable on their own, so they live
// here instead and page.tsx imports them like any other helper.

export const COLORS: Record<string, { bg: string; label: string }> = {
  yellow: { bg: '#FEF08A', label: '🟡' },
  green:  { bg: '#BBF7D0', label: '🟢' },
  blue:   { bg: '#BFDBFE', label: '🔵' },
  pink:   { bg: '#FBCFE8', label: '🩷' },
};

export interface HighlightItem { id: string; text: string; color: string; createdAt: string; }

// "Puntos clave" are rendered as plain text (no dangerouslySetInnerHTML, no markdown
// parser) — Bedrock's output for this field isn't always clean plain text (Trello
// DmPpbrff, 2026-09-04 — Mack: "hay partes de código desplegado" in Puntos clave, e.g.
// "**1**Tras <em>L'Orfeo</em>..."), so raw markdown bold markers and HTML tags leaked
// through verbatim instead of being either rendered or omitted. Strips both classes of
// markup before display; doesn't touch the main lesson body, which already renders as
// real HTML deliberately.
export function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

// Body highlights (Trello DmPpbrff, 2026-09-04 — Mack: "el resaltador de texto no está
// funcionando en los textos de las lecciones, solo en los puntos clave"): selecting text
// in the body and saving a highlight worked — the body is just re-rendered from raw
// lesson.content via dangerouslySetInnerHTML every time, with no mechanism to inject the
// saved highlight back in, so it visually never appeared. This injects <mark> directly
// into the HTML.
//
// Rewritten (Trello DmPpbrff, 2026-09-05 — Mack: "no está funcionando ... el menú
// apareció pero no se guardó"): the original version split the HTML into tag vs
// text-node segments with a regex and searched for a highlight's exact text WITHIN
// one segment at a time. That silently failed for the single most common real-world
// selection: one that spans a tag boundary (e.g. selecting across a bold word or a
// link) — window.getSelection().toString() flattens that into one plain string with
// no tags, but the saved text then never exists as a contiguous run inside any ONE
// text-node segment, so the highlight saved to the backend just never rendered. Now
// walks the real (detached) DOM instead: builds the full plain text across every text
// node, finds matches in that combined string (same non-overlapping-match logic as
// applyHighlights above), then re-slices each individual text node against whichever
// match ranges land inside it. A match spanning multiple nodes becomes multiple
// adjacent <mark> fragments — HTML has no way to make one element visually contiguous
// across an inline tag boundary without either breaking that tag's nesting or
// duplicating it, so this is the same thing a browser's own native highlighting does.
export function applyHighlightsToHtml(html: string, highlights: HighlightItem[]): string {
  if (!highlights.length || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);
  if (textNodes.length === 0) return html;

  // Full plain text across every text node, plus where each node starts within it —
  // this is what lets a saved highlight's text be found even when it used to span
  // more than one of the original tag-split segments.
  let combined = '';
  const nodeStarts: number[] = [];
  for (const t of textNodes) {
    nodeStarts.push(combined.length);
    combined += t.data;
  }

  interface MatchRange { start: number; end: number; color: string; }
  const matches: MatchRange[] = [];
  for (const h of highlights) {
    if (!h.text) continue;
    let idx = 0;
    while (true) {
      const pos = combined.indexOf(h.text, idx);
      if (pos === -1) break;
      const end = pos + h.text.length;
      const overlaps = matches.some((m) => pos < m.end && end > m.start);
      if (!overlaps) matches.push({ start: pos, end, color: h.color });
      idx = pos + 1;
    }
  }
  if (matches.length === 0) return container.innerHTML;
  matches.sort((a, b) => a.start - b.start);

  // One forward pass, each text node replaced independently (no node ever needs to
  // look at another node's post-mutation state) — slice it against whichever match
  // ranges intersect its own [nodeStart, nodeEnd) span.
  textNodes.forEach((t, ni) => {
    const nodeStart = nodeStarts[ni]!;
    const nodeEnd = nodeStart + t.data.length;
    const relevant = matches.filter((m) => m.start < nodeEnd && m.end > nodeStart);
    if (relevant.length === 0) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const m of relevant) {
      const localStart = Math.max(0, m.start - nodeStart);
      const localEnd = Math.min(t.data.length, m.end - nodeStart);
      if (localStart > cursor) frag.appendChild(document.createTextNode(t.data.slice(cursor, localStart)));
      const mark = document.createElement('mark');
      // setAttribute, not mark.style.xxx = — the CSSOM property API normalizes
      // values (hex → rgb(), "0 2px" → "0px 2px") on both write and re-serialize;
      // a raw attribute string round-trips through innerHTML exactly as written.
      mark.setAttribute('style', `background-color:${COLORS[m.color]?.bg ?? '#FEF08A'};border-radius:3px;padding:0 2px;`);
      mark.textContent = t.data.slice(localStart, localEnd);
      frag.appendChild(mark);
      cursor = localEnd;
    }
    if (cursor < t.data.length) frag.appendChild(document.createTextNode(t.data.slice(cursor)));
    t.parentNode!.replaceChild(frag, t);
  });

  return container.innerHTML;
}
