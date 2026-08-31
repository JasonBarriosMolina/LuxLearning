import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../admin/ai-image-helpers', () => ({
  generateLessonImage: vi.fn(),
}));

import { attachLessonVisuals, type DraftLessonRow } from '../../admin/ai-wizard-lesson-visuals';
import { generateLessonImage } from '../../admin/ai-image-helpers';

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

describe('attachLessonVisuals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets imageUrl from generateLessonImage for every lesson', async () => {
    vi.mocked(generateLessonImage).mockResolvedValue('https://s3.example.com/img.jpg');
    const lessons = [makeLesson(200), makeLesson(200)];
    await attachLessonVisuals(lessons, 'Módulo X');
    expect(lessons[0]!.imageUrl).toBe('https://s3.example.com/img.jpg');
    expect(lessons[1]!.imageUrl).toBe('https://s3.example.com/img.jpg');
    expect(generateLessonImage).toHaveBeenCalledTimes(2);
    expect(generateLessonImage).toHaveBeenCalledWith('Lección', 'Módulo X', 0, { lessonContent: lessons[0]!.content });
  });

  it('leaves imageUrl null (never throws) when image generation fails — never blocks the batch', async () => {
    vi.mocked(generateLessonImage).mockRejectedValue(new Error('Stability down'));
    const lessons = [makeLesson(200)];
    await expect(attachLessonVisuals(lessons, 'Módulo X')).resolves.toBeUndefined();
    expect(lessons[0]!.imageUrl).toBeNull();
  });

  it('overwrites duration with an honest word-count-derived estimate, ignoring whatever was there before (Trello DmPpbrff, 2026-08-31 15:19)', async () => {
    vi.mocked(generateLessonImage).mockResolvedValue(null);
    const lessons = [makeLesson(79, { duration: '5 min' }), makeLesson(1000, { duration: '9 min' })];
    await attachLessonVisuals(lessons, 'Módulo X');
    expect(lessons[0]!.duration).toBe('1 min'); // 79 words, not the fictional "5 min"
    expect(lessons[1]!.duration).toBe('5 min'); // 1000 words / 200 wpm
  });
});
