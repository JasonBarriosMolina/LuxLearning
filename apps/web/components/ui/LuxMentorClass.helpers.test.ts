import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, extractYouTubeId } from './LuxMentorClass.helpers';

describe('buildSystemPrompt — tone constraint', () => {
  // Trello DmPpbrff item 6 (2026-08-30 20:24): Lux Mentor's on-screen/spoken content
  // read like an AI chatbot (casual, emoji-friendly) — the system prompt must forbid that.
  it('forbids emojis and chatbot filler in Spanish', () => {
    const prompt = buildSystemPrompt(null, null, 'es', null);
    expect(prompt).toMatch(/sin emojis/i);
    expect(prompt).toMatch(/profesional/i);
  });

  it('forbids emojis and chatbot filler in English', () => {
    const prompt = buildSystemPrompt(null, null, 'en', null);
    expect(prompt).toMatch(/no emojis/i);
    expect(prompt).toMatch(/professional/i);
  });

  it('still includes the two-phase structure alongside the tone rule', () => {
    const prompt = buildSystemPrompt(null, null, 'es', null);
    expect(prompt).toContain('FASE 1');
    expect(prompt).toContain('FASE 2');
  });

  it('still embeds the lessonScript content when provided', () => {
    const prompt = buildSystemPrompt(null, null, 'es', 'Tema: Redes neuronales');
    expect(prompt).toContain('Redes neuronales');
  });

  it('appends the tone rule before an evaluator-provided custom vapiPrompt takes over the base', () => {
    const prompt = buildSystemPrompt('Enfócate en ejemplos musicales.', null, 'es', null);
    expect(prompt).toContain('Enfócate en ejemplos musicales.');
    expect(prompt).toMatch(/sin emojis/i);
  });
});

describe('extractYouTubeId', () => {
  it('extracts the id from a watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=abc123XYZ')).toBe('abc123XYZ');
  });

  it('extracts the id from a youtu.be short URL', () => {
    expect(extractYouTubeId('https://youtu.be/abc123XYZ')).toBe('abc123XYZ');
  });

  it('returns an empty string when no id is found', () => {
    expect(extractYouTubeId('https://example.com/video')).toBe('');
  });
});
