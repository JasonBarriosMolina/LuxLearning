import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, computeInterviewAutoEnd } from './VoiceInterview.helpers';

describe('buildSystemPrompt — no fictional function calls', () => {
  // Trello GTYQ3v1M (2026-08-29 01:25): the model was told to invoke an "endCall
  // function" that was never registered with Vapi, so it narrated the (fake) call
  // out loud instead ("end call()"). The prompt must never instruct that again.
  it('does not instruct the model to call an endCall function (Spanish)', () => {
    const prompt = buildSystemPrompt(null, null, 'es');
    expect(prompt).not.toMatch(/función\s*endCall/i);
    expect(prompt).not.toMatch(/\bendCall\b/);
  });

  it('does not instruct the model to call an endCall function (English)', () => {
    const prompt = buildSystemPrompt(null, null, 'en');
    expect(prompt).not.toMatch(/endCall function/i);
    expect(prompt).not.toMatch(/\bendCall\b/);
  });

  it('still tells the model to ask exactly 3 questions and then stop', () => {
    const prompt = buildSystemPrompt(null, null, 'es');
    expect(prompt).toMatch(/3 preguntas/);
    expect(prompt).toMatch(/deja de hablar/i);
  });

  it('embeds an evaluator-provided custom prompt', () => {
    const prompt = buildSystemPrompt('Enfócate en ejemplos de marketing.', null, 'es');
    expect(prompt).toContain('Enfócate en ejemplos de marketing.');
  });
});

describe('computeInterviewAutoEnd — item 7-equivalent auto-end for interviews', () => {
  it('does not end before the 3rd answer is given', () => {
    expect(computeInterviewAutoEnd({
      userAnswerCount: 2, requiredAnswers: 3, secondsSinceRequiredReached: 0, graceSeconds: 15,
    })).toBe(false);
  });

  it('does not end immediately after the 3rd answer — gives the closing line time to play', () => {
    expect(computeInterviewAutoEnd({
      userAnswerCount: 3, requiredAnswers: 3, secondsSinceRequiredReached: 2, graceSeconds: 15,
    })).toBe(false);
  });

  it('ends once the grace period has elapsed after the 3rd answer', () => {
    expect(computeInterviewAutoEnd({
      userAnswerCount: 3, requiredAnswers: 3, secondsSinceRequiredReached: 15, graceSeconds: 15,
    })).toBe(true);
  });

  it('still ends even if the student keeps talking past the 3rd answer', () => {
    expect(computeInterviewAutoEnd({
      userAnswerCount: 5, requiredAnswers: 3, secondsSinceRequiredReached: 20, graceSeconds: 15,
    })).toBe(true);
  });
});
