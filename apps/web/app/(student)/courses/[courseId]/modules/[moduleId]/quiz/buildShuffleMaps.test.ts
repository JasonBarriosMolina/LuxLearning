import { describe, it, expect } from 'vitest';
import { shuffle, buildShuffleMaps, buildQuestionOrder } from './shuffleUtils';

// ── shuffle ──────────────────────────────────────────────────────────────────
describe('shuffle', () => {
  it('returns an array with the same elements', () => {
    const arr = [0, 1, 2, 3];
    const result = shuffle(arr);
    expect(result).toHaveLength(arr.length);
    expect([...result].sort()).toEqual([0, 1, 2, 3]);
  });

  it('does not mutate the original array', () => {
    const arr = [0, 1, 2, 3];
    shuffle(arr);
    expect(arr).toEqual([0, 1, 2, 3]);
  });

  it('produces a different order across multiple runs (probabilistic)', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      orders.add(JSON.stringify(shuffle([0, 1, 2, 3])));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

// ── buildShuffleMaps ──────────────────────────────────────────────────────────
describe('buildShuffleMaps', () => {
  const questions = [
    { options: ['A', 'B', 'C', 'D'] },
    { options: ['X', 'Y', 'Z'] },
  ];

  it('returns one map per question', () => {
    const maps = buildShuffleMaps(questions);
    expect(maps).toHaveLength(2);
  });

  it('each map is a permutation of option indices', () => {
    const maps = buildShuffleMaps(questions);
    expect([...maps[0]].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect([...maps[1]].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('map length matches number of options', () => {
    const maps = buildShuffleMaps(questions);
    expect(maps[0]).toHaveLength(4);
    expect(maps[1]).toHaveLength(3);
  });

  it('maps[qIdx][visualPos] = originalOptionIdx can be used to read the right option', () => {
    const maps = buildShuffleMaps(questions);
    // Every visual position should map back to a valid option
    maps[0].forEach((originalIdx) => {
      expect(questions[0].options[originalIdx]).toBeDefined();
    });
  });
});

// ── buildQuestionOrder ────────────────────────────────────────────────────────
describe('buildQuestionOrder', () => {
  const questions = [
    { options: ['A', 'B'] },
    { options: ['C', 'D'] },
    { options: ['E', 'F'] },
    { options: ['G', 'H'] },
  ];

  it('returns an array of length equal to number of questions', () => {
    const order = buildQuestionOrder(questions);
    expect(order).toHaveLength(4);
  });

  it('is a permutation of [0, 1, ..., n-1]', () => {
    const order = buildQuestionOrder(questions);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('distributes order across multiple calls (probabilistic)', () => {
    const firstPositions = new Set<number>();
    for (let i = 0; i < 20; i++) {
      firstPositions.add(buildQuestionOrder(questions)[0]);
    }
    expect(firstPositions.size).toBeGreaterThan(1);
  });

  it('re-shuffling on retry produces a different order at least once in 10 runs', () => {
    const initial = buildQuestionOrder(questions);
    const orders = new Set<string>([JSON.stringify(initial)]);
    for (let i = 0; i < 10; i++) {
      orders.add(JSON.stringify(buildQuestionOrder(questions)));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

// ── answer stored at original index (integration-style test) ─────────────────
describe('answer mapping — answer stored at original question index', () => {
  it('visual position maps to original question index correctly', () => {
    // Simulate: questions[0,1,2], shuffledQuestions = [2,0,1]
    // Visual question 0 = original question 2
    // Visual question 1 = original question 0
    // Visual question 2 = original question 1
    const shuffledQuestions = [2, 0, 1];
    const answers: (number | null)[] = [null, null, null];

    // User answers visual question 0 → should store at index 2
    const visualQ = 0;
    const origQIdx = shuffledQuestions[visualQ];
    answers[origQIdx] = 0; // some option

    expect(answers[2]).toBe(0);
    expect(answers[0]).toBeNull();
    expect(answers[1]).toBeNull();
  });

  it('all visual questions answered fills answers at original indices', () => {
    const shuffledQuestions = [2, 0, 1];
    const answers: (number | null)[] = [null, null, null];

    answers[shuffledQuestions[0]] = 1;
    answers[shuffledQuestions[1]] = 0;
    answers[shuffledQuestions[2]] = 2;

    // All three original positions filled
    expect(answers.every((a) => a !== null)).toBe(true);
  });
});
