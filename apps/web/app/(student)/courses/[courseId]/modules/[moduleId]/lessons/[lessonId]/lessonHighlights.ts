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
// into the HTML string, splitting on tags first so a highlight's text is only ever
// matched inside real text nodes, never inside a tag name or attribute.
export function applyHighlightsToHtml(html: string, highlights: HighlightItem[]): string {
  if (!highlights.length) return html;
  const segments = html.split(/(<[^>]+>)/);
  return segments.map((seg) => {
    if (seg.startsWith('<')) return seg; // an actual tag — leave untouched
    let result = seg;
    for (const h of highlights) {
      if (!h.text) continue;
      const markOpen = `<mark style="background-color:${COLORS[h.color]?.bg ?? '#FEF08A'};border-radius:3px;padding:0 2px;">`;
      result = result.split(h.text).join(`${markOpen}${h.text}</mark>`);
    }
    return result;
  }).join('');
}
