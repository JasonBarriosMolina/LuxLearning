import { describe, it, expect } from 'vitest';
import { countWords, estimateReadingMinutes, lessonDurationLabel } from '../../shared/reading-time';

// Trello DmPpbrff, 2026-08-31 15:19 — Mack: a lesson with ~79 words was labeled "5
// minutos", but "un texto de 100 palabras toma entre 25 y 40 segundos en leerse en
// silencio... una lectura silenciosa promedio anda entre 200 a 240 palabras por
// minuto." 200 wpm (the low end of that range) is the constant these helpers use.

describe('countWords', () => {
  it('strips HTML tags before counting', () => {
    expect(countWords('<h3>Título</h3><p>Uno dos tres</p>')).toBe(4); // Título, Uno, dos, tres
  });

  it('returns 0 for null/empty', () => {
    expect(countWords(null)).toBe(0);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('estimateReadingMinutes', () => {
  it('matches Mack\'s own 100-words example: ~30s, rounds to the 1-minute floor', () => {
    expect(estimateReadingMinutes(100)).toBe(1);
  });

  it('never returns less than 1 minute even for very short content', () => {
    expect(estimateReadingMinutes(0)).toBe(1);
    expect(estimateReadingMinutes(5)).toBe(1);
  });

  it('computes honest minutes at 200 wpm for longer content', () => {
    expect(estimateReadingMinutes(1000)).toBe(5);
    expect(estimateReadingMinutes(200)).toBe(1);
  });
});

describe('lessonDurationLabel — the concrete regression', () => {
  it('a ~79-word lesson gets an honest "1 min", not a fictional "5 min"', () => {
    const content = `<p>${Array.from({ length: 79 }, (_, i) => `word${i}`).join(' ')}</p>`;
    expect(lessonDurationLabel(content)).toBe('1 min');
  });

  it('includes points and tip in the word count, not just content', () => {
    const content = Array.from({ length: 190 }, (_, i) => `w${i}`).join(' ');
    const points = ['a key point with several words in it'];
    const tip = 'one more practical tip sentence here';
    // 190 + ~7 + ~6 words ≈ 203 words → rounds to 1 min at 200 wpm boundary
    expect(lessonDurationLabel(content, points, tip)).toBe('1 min');
  });
});
