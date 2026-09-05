import { describe, it, expect } from 'vitest';
import { buildContentDisposition } from '../../shared/response';

// Trello DmPpbrff, 2026-09-05 (Mack): "No puedo descargar el documento editable" — root
// cause was a raw Content-Disposition header built from an accented course title/teacher
// name, which Node's http client rejects outright (TypeError [ERR_INVALID_CHAR]).
describe('buildContentDisposition', () => {
  it('does not throw for an ASCII-only filename and returns a plain header', () => {
    const header = buildContentDisposition('Plan.docx');
    expect(header).toContain('filename="Plan.docx"');
  });

  it('never leaves a raw non-ASCII byte in the ascii filename= part (the actual crash cause)', () => {
    const header = buildContentDisposition('Plan de Estudios - Música Barroca - Peña.docx');
    const asciiPart = header.match(/filename="([^"]*)"/)?.[1] ?? '';
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7E]*$/.test(asciiPart)).toBe(true);
  });

  it('strips accents to their plain-letter equivalent in the ascii fallback', () => {
    const header = buildContentDisposition('Música Barroca.docx');
    expect(header).toContain('filename="Musica Barroca.docx"');
  });

  it('preserves the real accented name in the RFC 5987 filename* part, percent-encoded', () => {
    const header = buildContentDisposition('Música Barroca.docx');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('Música Barroca.docx')}`);
  });

  it('falls back to a generic name (keeping the extension) when no letters/digits survive stripping', () => {
    const header = buildContentDisposition('日本語.docx'); // no ASCII/Latin letters at all
    expect(header).toContain('filename="documento.docx"');
  });

  it('strips embedded double quotes from the ascii fallback so they cannot break the header value', () => {
    const header = buildContentDisposition('Plan "final".docx');
    expect(header).toContain('filename="Plan final.docx"');
  });

  it('defaults to "attachment" but accepts "inline"', () => {
    expect(buildContentDisposition('a.docx')).toMatch(/^attachment;/);
    expect(buildContentDisposition('a.docx', 'inline')).toMatch(/^inline;/);
  });
});
