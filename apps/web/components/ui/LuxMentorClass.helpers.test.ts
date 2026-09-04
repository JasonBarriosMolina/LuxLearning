import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt, extractYouTubeId, computeSilenceAction, findActiveCaptionIndex,
  qaSecondsRemaining, formatCountdown,
} from './LuxMentorClass.helpers';

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

  // Restructure (2026-08-31): Vapi now handles Q&A only — the exposition monologue
  // moved to a pre-call Polly narration (LuxMentorClass.tsx 'narrating' phase).
  it('describes a Q&A-only session, not a monologue', () => {
    const prompt = buildSystemPrompt(null, null, 'es', null);
    expect(prompt).toMatch(/Q&A/);
    expect(prompt).not.toContain('FASE 1');
    expect(prompt).not.toContain('FASE 2');
  });

  it('embeds lessonScript as reference material, explicitly not to be re-narrated', () => {
    const prompt = buildSystemPrompt(null, null, 'es', 'Tema: Redes neuronales');
    expect(prompt).toContain('Redes neuronales');
    expect(prompt).toMatch(/NO lo vuelvas a leer/i);
  });

  it('appends the tone rule before an evaluator-provided custom vapiPrompt takes over the base', () => {
    const prompt = buildSystemPrompt('Enfócate en ejemplos musicales.', null, 'es', null);
    expect(prompt).toContain('Enfócate en ejemplos musicales.');
    expect(prompt).toMatch(/sin emojis/i);
  });

  // Trello q1yXHIob, 2026-08-29 (Mack): "no digas líneas de código en la interacción,
  // como por ejemplo 'end call' ... Eso jamás puede ocurrir" — a real observed bug.
  it('forbids saying technical/control phrases like "end call" out loud, in Spanish', () => {
    const prompt = buildSystemPrompt(null, null, 'es', null);
    expect(prompt).toMatch(/end call/i);
    expect(prompt).toMatch(/nunca digas/i);
  });

  it('forbids saying technical/control phrases like "end call" out loud, in English', () => {
    const prompt = buildSystemPrompt(null, null, 'en', null);
    expect(prompt).toMatch(/end call/i);
    expect(prompt).toMatch(/never say/i);
  });
});

describe('qaSecondsRemaining / formatCountdown — visible Q&A countdown', () => {
  it('counts down toward zero as elapsed time approaches the target', () => {
    expect(qaSecondsRemaining(0, 300)).toBe(300);
    expect(qaSecondsRemaining(180, 300)).toBe(120);
    expect(qaSecondsRemaining(299, 300)).toBe(1);
  });

  it('never goes negative past the target', () => {
    expect(qaSecondsRemaining(400, 300)).toBe(0);
  });

  it('formats seconds as m:ss', () => {
    expect(formatCountdown(120)).toBe('2:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('computeSilenceAction — item 7 silence-timeout', () => {
  const base = { checkinThreshold: 12, endThreshold: 10 };

  it('does nothing during the monologue phase (not in Q&A yet)', () => {
    const action = computeSilenceAction({ ...base, inQA: false, silenceSeconds: 999, checkinSent: false, secondsSinceCheckin: 0 });
    expect(action).toBe('none');
  });

  it('does nothing before the check-in threshold is reached', () => {
    const action = computeSilenceAction({ ...base, inQA: true, silenceSeconds: 5, checkinSent: false, secondsSinceCheckin: 0 });
    expect(action).toBe('none');
  });

  it('triggers a check-in once silence reaches the threshold', () => {
    const action = computeSilenceAction({ ...base, inQA: true, silenceSeconds: 12, checkinSent: false, secondsSinceCheckin: 0 });
    expect(action).toBe('checkin');
  });

  it('does not end the call right after the check-in is sent', () => {
    const action = computeSilenceAction({ ...base, inQA: true, silenceSeconds: 12, checkinSent: true, secondsSinceCheckin: 2 });
    expect(action).toBe('none');
  });

  it('ends the call once the post-check-in grace period elapses with no reply', () => {
    const action = computeSilenceAction({ ...base, inQA: true, silenceSeconds: 22, checkinSent: true, secondsSinceCheckin: 10 });
    expect(action).toBe('end');
  });

  it('never re-triggers checkin once already sent, even if silenceSeconds keeps climbing', () => {
    const action = computeSilenceAction({ ...base, inQA: true, silenceSeconds: 40, checkinSent: true, secondsSinceCheckin: 3 });
    expect(action).toBe('none');
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

describe('findActiveCaptionIndex — exposition redesign live captions (DmPpbrff 2026-09-01 01:10)', () => {
  const marks = [
    { time: 0, value: 'Primera oración.' },
    { time: 2000, value: 'Segunda oración.' },
    { time: 5000, value: 'Tercera oración.' },
  ];

  it('returns -1 for an empty marks list', () => {
    expect(findActiveCaptionIndex([], 3000)).toBe(-1);
  });

  it('returns the first sentence at/just after playback start', () => {
    expect(findActiveCaptionIndex(marks, 0)).toBe(0);
    expect(findActiveCaptionIndex(marks, 1999)).toBe(0);
  });

  it('advances to the next sentence exactly at its start time', () => {
    expect(findActiveCaptionIndex(marks, 2000)).toBe(1);
    expect(findActiveCaptionIndex(marks, 4999)).toBe(1);
  });

  it('stays on the last sentence for the remainder of playback', () => {
    expect(findActiveCaptionIndex(marks, 5000)).toBe(2);
    expect(findActiveCaptionIndex(marks, 999999)).toBe(2);
  });
});
