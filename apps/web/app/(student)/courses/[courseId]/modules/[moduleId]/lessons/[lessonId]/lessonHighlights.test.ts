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
});
