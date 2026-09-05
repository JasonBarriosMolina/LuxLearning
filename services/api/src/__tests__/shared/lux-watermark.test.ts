import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeWatermarkPlacement, WATERMARK_OPACITY } from '../../shared/lux-watermark';

// Trello DmPpbrff, 2026-09-05 (Mack): "recuerda que este tipo de imágenes ... tienen
// que tener la marca de agua de Lux Learning siempre, en la parte inferior derecha,
// con una transparencia alrededor de 40, utilizando el Lux Learning Icon Full Color."

describe('computeWatermarkPlacement', () => {
  it('sizes the watermark proportionally to the base image width', () => {
    const p = computeWatermarkPlacement(1000, 1000);
    expect(p.size).toBe(140); // 14% of 1000
  });

  it('places it in the bottom-right corner with a margin', () => {
    const p = computeWatermarkPlacement(1000, 1000);
    expect(p.left).toBe(1000 - 140 - 30); // margin = 3% of 1000
    expect(p.top).toBe(1000 - 140 - 30);
  });

  it('scales correctly for a smaller image (e.g. 512px)', () => {
    const p = computeWatermarkPlacement(512, 512);
    expect(p.size).toBe(Math.round(512 * 0.14));
    expect(p.left).toBeGreaterThan(0);
    expect(p.top).toBeGreaterThan(0);
  });

  it('handles a non-square image using each dimension independently', () => {
    const p = computeWatermarkPlacement(1200, 800);
    expect(p.size).toBe(Math.round(1200 * 0.14)); // sized off width only
    expect(p.top).toBe(800 - p.size - Math.round(1200 * 0.03));
  });

  it('never places the watermark off the left/top edge for a tiny image', () => {
    const p = computeWatermarkPlacement(10, 10);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });

  it('opacity is fixed at 40% per Mack\'s spec', () => {
    expect(WATERMARK_OPACITY).toBe(0.4);
  });
});

// applyLuxWatermark itself is a thin sharp/native-binding wrapper around the pure
// placement math above — mocked here just to confirm the compositing call shape
// (icon resized to the computed placement, alpha-faded, then composited onto the
// base image), not to re-test sharp itself.
describe('applyLuxWatermark', () => {
  beforeEach(() => vi.resetModules());

  it('composites a resized, faded icon onto the base image and returns a jpeg buffer', async () => {
    const toBufferMock = vi.fn().mockResolvedValue(Buffer.from('fake-output'));
    const chain: any = {
      metadata: vi.fn().mockResolvedValue({ width: 1000, height: 1000 }),
      resize: vi.fn().mockReturnThis(),
      composite: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: toBufferMock,
    };
    const sharpMock = vi.fn(() => chain);

    vi.doMock('sharp', () => ({ default: sharpMock }));
    const { applyLuxWatermark } = await import('../../shared/lux-watermark');

    const result = await applyLuxWatermark(Buffer.from('fake-input'));
    expect(result).toEqual(Buffer.from('fake-output'));
    expect(chain.composite).toHaveBeenCalled();
    expect(chain.jpeg).toHaveBeenCalled();
  });

  it('propagates a rejection instead of silently returning the original buffer (caller decides the fallback)', async () => {
    vi.doMock('sharp', () => ({ default: vi.fn(() => { throw new Error('native binding missing'); }) }));
    const { applyLuxWatermark } = await import('../../shared/lux-watermark');
    await expect(applyLuxWatermark(Buffer.from('x'))).rejects.toThrow('native binding missing');
  });
});
