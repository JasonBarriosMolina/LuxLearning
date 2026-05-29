/** Fisher-Yates shuffle — returns a new array */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Build shuffled mappings: shuffledMaps[qIdx][shuffledPos] = originalOptionIdx */
export function buildShuffleMaps(questions: any[]): number[][] {
  return questions.map((q) => {
    const indices = q.options.map((_: any, i: number) => i);
    return shuffle(indices);
  });
}

/** Build a shuffled order for question indices: returns permutation of [0..n-1] */
export function buildQuestionOrder(questions: any[]): number[] {
  return shuffle(questions.map((_: any, i: number) => i));
}
