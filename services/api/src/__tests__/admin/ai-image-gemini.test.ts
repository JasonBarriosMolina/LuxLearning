// Tests for ai-image-gemini.ts — Trello DmPpbrff, 2026-09-08 (Mack + Jason):
// Nano Banana Pro / Gemini 3 Pro Image evaluated as an alternate image provider.
// This module is a thin HTTP wrapper around Gemini's generateContent REST API —
// no live key has been provisioned yet, so these tests mock global.fetch and
// pin the documented request/response contract rather than hitting Google.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateImageWithGemini, isGeminiImageConfigured } from '../../admin/ai-image-gemini';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('isGeminiImageConfigured', () => {
  it('is false when GEMINI_API_KEY is not set', () => {
    delete process.env.GEMINI_API_KEY;
    expect(isGeminiImageConfigured()).toBe(false);
  });

  it('is true when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(isGeminiImageConfigured()).toBe(true);
  });
});

describe('generateImageWithGemini', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('returns null (safe no-op) when no API key is configured, without calling fetch', async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    const result = await generateImageWithGemini('a colorful scene');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the model in GEMINI_IMAGE_MODEL (default gemini-3-pro-image-preview) with the key as a query param', async () => {
    const base64 = Buffer.from('fake-png-bytes').toString('base64');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64 } }] } }] }),
    });
    global.fetch = fetchMock as any;
    await generateImageWithGemini('a colorful scene');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=test-key');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.contents[0].parts[0].text).toBe('a colorful scene');
  });

  it('uses GEMINI_IMAGE_MODEL override when set', async () => {
    process.env.GEMINI_IMAGE_MODEL = 'gemini-experimental-image';
    const base64 = Buffer.from('x').toString('base64');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: base64 } }] } }] }),
    });
    global.fetch = fetchMock as any;
    await generateImageWithGemini('prompt');
    expect(fetchMock.mock.calls[0][0]).toContain('gemini-experimental-image:generateContent');
  });

  it('returns the decoded image bytes from inlineData (camelCase)', async () => {
    const base64 = Buffer.from('real-image-bytes').toString('base64');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: base64 } }] } }] }),
    }) as any;
    const result = await generateImageWithGemini('prompt');
    expect(result).toEqual(Buffer.from('real-image-bytes'));
  });

  it('also accepts snake_case inline_data (protobuf-JSON wire variance)', async () => {
    const base64 = Buffer.from('snake-case-bytes').toString('base64');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inline_data: { data: base64 } }] } }] }),
    }) as any;
    const result = await generateImageWithGemini('prompt');
    expect(result).toEqual(Buffer.from('snake-case-bytes'));
  });

  it('throws when the HTTP response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => 'quota exceeded',
    }) as any;
    await expect(generateImageWithGemini('prompt')).rejects.toThrow(/429/);
  });

  it('throws when the response has no inline image data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'no image here' }] } }] }),
    }) as any;
    await expect(generateImageWithGemini('prompt')).rejects.toThrow(/no inline image data/);
  });
});
