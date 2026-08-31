import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../admin/ai-image-helpers', () => ({
  generateLessonInfographic: vi.fn(),
}));

import { attachLessonVisuals, type DraftLessonRow } from '../../admin/ai-wizard-lesson-visuals';
import { generateLessonInfographic } from '../../admin/ai-image-helpers';

function makeLesson(words: number, overrides: Partial<DraftLessonRow> = {}): DraftLessonRow {
  return {
    title: 'Lección',
    content: `<p>${Array.from({ length: words }, (_, i) => `w${i}`).join(' ')}</p>`,
    points: [],
    tip: '',
    imageUrl: null,
    duration: '9 min', // deliberately wrong — must be overwritten
    ...overrides,
  };
}

describe('attachLessonVisuals — ONE infographic per module, not per lesson (Trello DmPpbrff, 2026-08-31 19:53 reversal)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets imageUrl on the FIRST lesson only — the rest stay null', async () => {
    vi.mocked(generateLessonInfographic).mockResolvedValue('https://s3.example.com/infographic.svg');
    const lessons = [makeLesson(200, { title: 'L1' }), makeLesson(200, { title: 'L2' }), makeLesson(200, { title: 'L3' })];
    await attachLessonVisuals(lessons, 'Módulo X');
    expect(lessons[0]!.imageUrl).toBe('https://s3.example.com/infographic.svg');
    expect(lessons[1]!.imageUrl).toBeNull();
    expect(lessons[2]!.imageUrl).toBeNull();
    expect(generateLessonInfographic).toHaveBeenCalledTimes(1);
    expect(generateLessonInfographic).toHaveBeenCalledWith('Módulo X', 'Módulo X', 'L1, L2, L3');
  });

  it('leaves imageUrl null (never throws) when infographic generation fails — never blocks the batch', async () => {
    vi.mocked(generateLessonInfographic).mockRejectedValue(new Error('Bedrock down'));
    const lessons = [makeLesson(200)];
    await expect(attachLessonVisuals(lessons, 'Módulo X')).resolves.toBeUndefined();
    expect(lessons[0]!.imageUrl).toBeNull();
  });

  it('overwrites duration with an honest word-count-derived estimate for every lesson (Trello DmPpbrff, 2026-08-31 15:19)', async () => {
    vi.mocked(generateLessonInfographic).mockResolvedValue(null);
    const lessons = [makeLesson(79, { duration: '5 min' }), makeLesson(1000, { duration: '9 min' })];
    await attachLessonVisuals(lessons, 'Módulo X');
    expect(lessons[0]!.duration).toBe('1 min'); // 79 words, not the fictional "5 min"
    expect(lessons[1]!.duration).toBe('5 min'); // 1000 words / 200 wpm
  });
});
