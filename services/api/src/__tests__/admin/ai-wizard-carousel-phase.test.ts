import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../admin/carousel', () => ({ draftCarouselScript: vi.fn() }));
vi.mock('../../admin/carousel-worker', () => ({ generateCarouselAssets: vi.fn() }));

import { generateModuleCarousel } from '../../admin/ai-wizard-carousel-phase';
import { draftCarouselScript } from '../../admin/carousel';
import { generateCarouselAssets } from '../../admin/carousel-worker';
import { makePrisma } from '../helpers/ctx';

describe('generateModuleCarousel — idempotency guard (Trello DmPpbrff, 2026-08-31 19:49)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips generation when the module already has a carousel lesson — regression: carousels were generating up to 3x per module on repeated course-regeneration runs', async () => {
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }) },
      lesson: { count: vi.fn().mockImplementation(async ({ where }: any) => (where?.type === 'carousel' ? 1 : 8)) },
    });

    const created = await generateModuleCarousel(prisma, 'c1', 'm1', 'ES');

    expect(created).toBe(false);
    expect(draftCarouselScript).not.toHaveBeenCalled();
    expect(generateCarouselAssets).not.toHaveBeenCalled();
  });

  it('proceeds normally when no carousel exists yet', async () => {
    const prisma = makePrisma({
      module: { findUnique: vi.fn().mockResolvedValue({ title: 'Mod', description: 'Desc' }) },
      lesson: { count: vi.fn().mockImplementation(async ({ where }: any) => (where?.type === 'carousel' ? 0 : 8)) },
    });
    vi.mocked(draftCarouselScript).mockResolvedValue({ slides: [{}], topic: 'Mod' } as any);
    vi.mocked(generateCarouselAssets).mockResolvedValue({ lessonId: 'l1' });

    const created = await generateModuleCarousel(prisma, 'c1', 'm1', 'ES');

    expect(created).toBe(true);
    expect(draftCarouselScript).toHaveBeenCalledTimes(1);
    expect(generateCarouselAssets).toHaveBeenCalledWith(prisma, 'm1', expect.any(Array), 'ES', 8);
  });
});
