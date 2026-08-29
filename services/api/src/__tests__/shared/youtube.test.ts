/**
 * Tests for shared/youtube.ts — YouTube ID extraction + availability check.
 * Trello Nk0XDBvJ comment 6a926aaa: recommended/saved videos turning out unavailable,
 * and the admin's own "verify videos" button reporting false negatives because a full
 * URL pasted into the "YouTube ID" field was never normalized before checking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractYoutubeId, isYoutubeVideoAvailable } from '../../shared/youtube';

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
