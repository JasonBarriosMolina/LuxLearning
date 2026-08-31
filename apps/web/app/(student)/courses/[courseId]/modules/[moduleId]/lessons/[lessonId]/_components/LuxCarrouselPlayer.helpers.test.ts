import { describe, it, expect } from 'vitest';
import { findActiveSlideIndex, slideProgress, musicDuckGain, canScrub, type CarouselSlide } from './LuxCarrouselPlayer.helpers';

const slides: CarouselSlide[] = [
  { order: 1, onScreenText: { title: 'A', bullets: [] }, imageUrl: null, startMs: 0, endMs: 1000 },
  { order: 2, onScreenText: { title: 'B', bullets: [] }, imageUrl: null, startMs: 1000, endMs: 2500 },
  { order: 3, onScreenText: { title: 'C', bullets: [] }, imageUrl: null, startMs: 2500, endMs: 4000 },
];

describe('findActiveSlideIndex', () => {
  it('returns -1 for an empty slide list', () => {
    expect(findActiveSlideIndex([], 500)).toBe(-1);
  });

  it('finds the first slide at time 0', () => {
    expect(findActiveSlideIndex(slides, 0)).toBe(0);
  });

  it('finds the middle slide within its window', () => {
    expect(findActiveSlideIndex(slides, 1500)).toBe(1);
  });

  it('finds the last slide at its start boundary', () => {
    expect(findActiveSlideIndex(slides, 2500)).toBe(2);
  });

  it('clamps to the last slide once playback passes the final endMs', () => {
    expect(findActiveSlideIndex(slides, 5000)).toBe(2);
  });
});

describe('slideProgress', () => {
  it('returns 0 for an undefined slide', () => {
    expect(slideProgress(undefined, 500)).toBe(0);
  });

  it('returns 0 at the start of a slide', () => {
    expect(slideProgress(slides[1], 1000)).toBe(0);
  });

  it('returns 0.5 at the midpoint of a slide', () => {
    expect(slideProgress(slides[1], 1750)).toBe(0.5);
  });

  it('clamps to 1 past the end of a slide', () => {
    expect(slideProgress(slides[1], 9999)).toBe(1);
  });
});

describe('musicDuckGain', () => {
  it('returns the full rest gain when narration is not playing', () => {
    expect(musicDuckGain({ isNarrationPlaying: false, msIntoSlide: 0, duckedGain: 0.1, restGain: 0.6, fadeMs: 300 })).toBe(0.6);
  });

  it('returns the ducked gain once narration has been playing past the fade window', () => {
    expect(musicDuckGain({ isNarrationPlaying: true, msIntoSlide: 500, duckedGain: 0.1, restGain: 0.6, fadeMs: 300 })).toBe(0.1);
  });

  it('interpolates during the fade-down window right after narration starts', () => {
    const gain = musicDuckGain({ isNarrationPlaying: true, msIntoSlide: 150, duckedGain: 0.1, restGain: 0.6, fadeMs: 300 });
    expect(gain).toBeGreaterThan(0.1);
    expect(gain).toBeLessThan(0.6);
  });
});

describe('canScrub — first-view lock', () => {
  it('is locked before the carousel has ever been completed', () => {
    expect(canScrub(false)).toBe(false);
  });

  it('unlocks after the carousel has been completed once', () => {
    expect(canScrub(true)).toBe(true);
  });
});
