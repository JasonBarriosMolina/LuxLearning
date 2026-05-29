import { describe, it, expect } from 'vitest';
import { computeGate } from './lessonProgressGate';

describe('computeGate — lesson progress gate logic', () => {
  // ── Null / no lesson ────────────────────────────────────────────────────────
  it('passes when lesson is null (no data yet)', () => {
    expect(computeGate(null, false, false, false)).toBe(true);
  });

  it('passes when lesson is undefined', () => {
    expect(computeGate(undefined, false, false, false)).toBe(true);
  });

  // ── Video-only (has youtubeId, no content) ──────────────────────────────────
  it('fails when video-only lesson and video not yet visited', () => {
    const lesson = { youtubeId: 'abc123', content: null };
    expect(computeGate(lesson, false, false, false)).toBe(false);
  });

  it('passes when video-only lesson and video visited', () => {
    const lesson = { youtubeId: 'abc123', content: null };
    expect(computeGate(lesson, true, false, false)).toBe(true);
  });

  // ── Text-only (no youtubeId, has content) ───────────────────────────────────
  it('passes immediately for text-only lesson (text always visible, no gate needed)', () => {
    const lesson = { youtubeId: null, content: '<p>Contenido</p>' };
    expect(computeGate(lesson, false, false, false)).toBe(true);
  });

  it('passes for text-only lesson regardless of visited flags', () => {
    const lesson = { youtubeId: null, content: '<p>Contenido</p>' };
    expect(computeGate(lesson, true, true, false)).toBe(true);
  });

  // ── Both tabs (has youtubeId AND content) ───────────────────────────────────
  it('fails when both tabs exist and neither visited', () => {
    const lesson = { youtubeId: 'abc123', content: '<p>Texto</p>' };
    expect(computeGate(lesson, false, false, false)).toBe(false);
  });

  it('fails when both tabs exist and only video visited', () => {
    const lesson = { youtubeId: 'abc123', content: '<p>Texto</p>' };
    expect(computeGate(lesson, true, false, false)).toBe(false);
  });

  it('fails when both tabs exist and only text visited', () => {
    const lesson = { youtubeId: 'abc123', content: '<p>Texto</p>' };
    expect(computeGate(lesson, false, true, false)).toBe(false);
  });

  it('passes when both tabs exist and both visited', () => {
    const lesson = { youtubeId: 'abc123', content: '<p>Texto</p>' };
    expect(computeGate(lesson, true, true, false)).toBe(true);
  });

  // ── Video error (videoError=true) ───────────────────────────────────────────
  it('passes when lesson has video+text but videoError=true (video unavailable)', () => {
    // When video errors, both videoRequired and textRequired become false
    const lesson = { youtubeId: 'abc123', content: '<p>Texto</p>' };
    expect(computeGate(lesson, false, false, true)).toBe(true);
  });

  it('passes for video-only lesson when videoError=true (no content to gate)', () => {
    const lesson = { youtubeId: 'abc123', content: null };
    expect(computeGate(lesson, false, false, true)).toBe(true);
  });

  // ── Lesson with no content at all ───────────────────────────────────────────
  it('passes for lesson with neither youtubeId nor content', () => {
    const lesson = { youtubeId: null, content: null };
    expect(computeGate(lesson, false, false, false)).toBe(true);
  });
});
