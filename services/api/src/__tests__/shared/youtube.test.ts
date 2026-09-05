/**
 * Tests for shared/youtube.ts — YouTube ID extraction + availability check.
 * Trello Nk0XDBvJ comment 6a926aaa: recommended/saved videos turning out unavailable,
 * and the admin's own "verify videos" button reporting false negatives because a full
 * URL pasted into the "YouTube ID" field was never normalized before checking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractYoutubeId, isYoutubeVideoAvailable, searchYoutubeVideo, escapeHtml, extractSuggestedVideoLinks } from '../../shared/youtube';

describe('extractYoutubeId', () => {
  it('passes through a bare 11-char ID unchanged', () => {
    expect(extractYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the ID from a full watch?v= URL — the exact mistake admins make despite the "ID" label', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the ID from a youtu.be short link', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the ID from an embed URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the ID from a Shorts URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for empty/garbage input instead of storing junk', () => {
    expect(extractYoutubeId('')).toBeNull();
    expect(extractYoutubeId(null)).toBeNull();
    expect(extractYoutubeId(undefined)).toBeNull();
    expect(extractYoutubeId('not a youtube link at all')).toBeNull();
  });
});

describe('isYoutubeVideoAvailable', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('returns true when oEmbed responds ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
    expect(await isYoutubeVideoAvailable('dQw4w9WgXcQ')).toBe(true);
  });

  it('returns false when oEmbed responds non-ok (removed/private video)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;
    expect(await isYoutubeVideoAvailable('dQw4w9WgXcQ')).toBe(false);
  });

  it('returns false (not throws) on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    expect(await isYoutubeVideoAvailable('dQw4w9WgXcQ')).toBe(false);
  });
});

// Trello Nk0XDBvJ, 2026-09-02 21:43 (Mack): "no necesitamos palabras claves puestas en
// la búsqueda de YouTube... necesitamos el enlace de un video en específico."
describe('searchYoutubeVideo', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('returns null immediately (no fetch call) when no API key is available', async () => {
    global.fetch = vi.fn() as any;
    expect(await searchYoutubeVideo('historia de la música barroca', undefined)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null for an empty/blank query even with a key', async () => {
    global.fetch = vi.fn() as any;
    expect(await searchYoutubeVideo('   ', 'fake-key')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns the first result videoId/title/channelTitle on a successful search', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: { videoId: 'abc123XYZ_9' }, snippet: { title: 'Música Barroca 101', channelTitle: 'Jaime Altozano' } }] }),
    }) as any;
    const result = await searchYoutubeVideo('música barroca', 'fake-key');
    expect(result).toEqual({ videoId: 'abc123XYZ_9', title: 'Música Barroca 101', channelTitle: 'Jaime Altozano' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('key=fake-key'), expect.anything());
  });

  it('returns null when the API responds with no items', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }) as any;
    expect(await searchYoutubeVideo('algo muy raro', 'fake-key')).toBeNull();
  });

  it('returns null (not throws) when the API responds non-ok (quota exceeded, bad key, etc.)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;
    expect(await searchYoutubeVideo('cualquier cosa', 'fake-key')).toBeNull();
  });

  it('returns null (not throws) on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    expect(await searchYoutubeVideo('cualquier cosa', 'fake-key')).toBeNull();
  });
});

// Trello DmPpbrff, 2026-09-05 (Mack): "Validar videos" only checked lesson.youtubeId —
// module-level video suggestions (ai-wizard-worker.ts' "🎥 Videos Sugeridos" section) live
// as <a href> links inside a lesson's own content HTML instead, and never got validated.
describe('extractSuggestedVideoLinks', () => {
  it('finds a real YouTube link embedded in the "Videos Sugeridos" section', () => {
    const html = '<section class="lesson-resources"><h3>🎥 Videos Sugeridos</h3><ul><li><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer">Historia de la Música Barroca</a></li></ul></section>';
    expect(extractSuggestedVideoLinks(html)).toEqual([{ videoId: 'dQw4w9WgXcQ', label: 'Historia de la Música Barroca' }]);
  });

  it('finds multiple links across multiple <li> entries', () => {
    const html = '<ul><li><a href="https://youtu.be/aaaaaaaaaaa">A</a></li><li><a href="https://www.youtube.com/watch?v=bbbbbbbbbbb">B</a></li></ul>';
    expect(extractSuggestedVideoLinks(html)).toEqual([
      { videoId: 'aaaaaaaaaaa', label: 'A' },
      { videoId: 'bbbbbbbbbbb', label: 'B' },
    ]);
  });

  it('skips the keyword-search fallback link (no real video id, not a "broken video")', () => {
    const html = '<a href="https://youtube.com/results?search_query=historia%20barroca">historia barroca</a>';
    expect(extractSuggestedVideoLinks(html)).toEqual([]);
  });

  it('ignores non-YouTube anchors entirely', () => {
    const html = '<a href="https://example.com/some-article">An article</a>';
    expect(extractSuggestedVideoLinks(html)).toEqual([]);
  });

  it('returns empty for null/undefined/empty content', () => {
    expect(extractSuggestedVideoLinks(null)).toEqual([]);
    expect(extractSuggestedVideoLinks(undefined)).toEqual([]);
    expect(extractSuggestedVideoLinks('')).toEqual([]);
  });

  it('returns empty when the lesson content has no <a> tags at all', () => {
    expect(extractSuggestedVideoLinks('<p>Solo texto, sin enlaces.</p>')).toEqual([]);
  });
});

// Code-review finding, 2026-09-03: a YouTube video title is untrusted third-party text
// (from Google's API) interpolated into lesson HTML rendered via
// dangerouslySetInnerHTML — without escaping, a malicious/weird title is stored XSS.
describe('escapeHtml', () => {
  it('escapes the 5 characters that matter for HTML injection', () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)>`)).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`"quoted" & 'apostrophe'`)).toBe('&quot;quoted&quot; &amp; &#39;apostrophe&#39;');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Historia de la Música Barroca - Jaime Altozano')).toBe('Historia de la Música Barroca - Jaime Altozano');
  });
});
