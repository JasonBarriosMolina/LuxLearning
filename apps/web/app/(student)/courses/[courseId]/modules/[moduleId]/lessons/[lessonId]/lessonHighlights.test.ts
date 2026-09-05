import { describe, it, expect } from 'vitest';
import { stripMarkup, applyHighlightsToHtml } from './lessonHighlights';

// Trello DmPpbrff, 2026-09-04 (Mack) — two bugs in the same "Puntos clave"/highlight area.

describe('stripMarkup', () => {
  it('strips markdown bold markers, keeping the inner text', () => {
    expect(stripMarkup('**1**Tras esto...')).toBe('1Tras esto...');
  });

  it('strips HTML tags, keeping the inner text', () => {
    expect(stripMarkup("Tras <em>L'Orfeo</em>, la ópera se expande")).toBe("Tras L'Orfeo, la ópera se expande");
  });

  it('strips a mix of markdown and HTML in the same string (the reported case)', () => {
    expect(stripMarkup("**1**Tras <em>L'Orfeo</em>, la ópera se expande")).toBe("1Tras L'Orfeo, la ópera se expande");
  });

  it('leaves ordinary plain text untouched', () => {
    expect(stripMarkup('Un punto clave normal sin marcado.')).toBe('Un punto clave normal sin marcado.');
  });

  it('strips markdown headings', () => {
    expect(stripMarkup('### Un título')).toBe('Un título');
  });
});

describe('applyHighlightsToHtml', () => {
  it('returns the HTML unchanged when there are no highlights', () => {
    expect(applyHighlightsToHtml('<p>Contenido</p>', [])).toBe('<p>Contenido</p>');
  });

  it('wraps a highlighted text node in <mark>, leaving tags untouched', () => {
    const html = '<p>Hola mundo</p>';
    const highlights = [{ id: 'h1', text: 'mundo', color: 'yellow', createdAt: '' }];
    const result = applyHighlightsToHtml(html, highlights);
    expect(result).toBe('<p>Hola <mark style="background-color:#FEF08A;border-radius:3px;padding:0 2px;">mundo</mark></p>');
  });

  it('never matches inside a tag name or attribute, only real text nodes', () => {
    // "p" appears inside the tag itself — must not be touched there.
    const html = '<p class="prose">texto</p>';
    const highlights = [{ id: 'h1', text: 'p', color: 'yellow', createdAt: '' }];
    const result = applyHighlightsToHtml(html, highlights);
    expect(result).toBe('<p class="prose">texto</p>'); // "p" doesn't appear as its own text node here
  });

  it('applies multiple highlights, including different colors', () => {
    const html = '<p>uno dos tres</p>';
    const highlights = [
      { id: 'h1', text: 'uno', color: 'yellow', createdAt: '' },
      { id: 'h2', text: 'tres', color: 'green', createdAt: '' },
    ];
    const result = applyHighlightsToHtml(html, highlights);
    expect(result).toContain('background-color:#FEF08A');
    expect(result).toContain('background-color:#BBF7D0');
    expect(result).toContain('>uno</mark>');
    expect(result).toContain('>tres</mark>');
  });

  // Trello DmPpbrff, 2026-09-05 (Mack): "La opción de 'resaltar' texto no está
  // funcionando en las lecciones" — repro'd: the toolbar appears and the save call
  // succeeds, but nothing visibly highlights. Root cause: a real text selection made
  // in the browser very commonly spans a tag boundary (bold word, link, etc — lesson
  // content is rich HTML) — window.getSelection().toString() flattens that into one
  // plain string with no tags, but this function only ever searches for a match
  // WITHIN one already-tag-split text-node segment at a time, so a highlight whose
  // text used to live across two segments can never be found here.
  it('matches text that spans a tag boundary (the real reported bug — text selected across an <em>)', () => {
    // window.getSelection().toString() flattens tags away — a selection starting
    // mid-<em> and ending after it comes back as plain "Orfeo, la ópera", never
    // literally containing "</em>". The OLD implementation searched for that exact
    // string within one already-tag-split segment at a time and could never find it,
    // since it only ever existed split across two separate segments — the highlight
    // saved to the backend fine but silently never rendered.
    const html = "<p>Tras <em>L'Orfeo</em>, la ópera se expande</p>";
    const highlights = [{ id: 'h1', text: 'Orfeo, la', color: 'yellow', createdAt: '' }];
    const result = applyHighlightsToHtml(html, highlights);
    // Can't be one contiguous <mark> without breaking the </em> boundary — two
    // adjacent fragments is the correct, only-valid-HTML outcome.
    expect(result).toContain('<mark style="background-color:#FEF08A;border-radius:3px;padding:0 2px;">Orfeo</mark>');
    expect(result).toContain('<mark style="background-color:#FEF08A;border-radius:3px;padding:0 2px;">, la</mark>');
    expect(result).toContain('</em>'); // the tag itself must survive intact
  });

  it('still matches correctly when the selection happens to land fully inside one tag', () => {
    const html = "<p>Tras <em>L'Orfeo</em>, la ópera se expande</p>";
    const highlights = [{ id: 'h1', text: 'Orfeo', color: 'yellow', createdAt: '' }];
    const result = applyHighlightsToHtml(html, highlights);
    expect(result).toContain('<mark');
    expect(result).toContain('>Orfeo</mark>');
  });
});
