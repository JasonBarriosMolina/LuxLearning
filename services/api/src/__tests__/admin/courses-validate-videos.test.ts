/**
 * Tests for GET /admin/courses/:courseId/validate-videos in admin/courses.ts.
 * Trello DmPpbrff, 2026-09-05 (Mack): the button only ever checked lesson.youtubeId —
 * module-level "Videos Sugeridos" links baked into lesson.content were never validated.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeAdminCtx, makePrisma, makeEvent } from '../helpers/ctx';
import { handleCourses } from '../../admin/courses';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function course(modules: any[]) {
  return { id: 'course-1', modules };
}

describe('GET /admin/courses/:courseId/validate-videos', () => {
  it('validates both a lesson.youtubeId and a suggestion link embedded in another lesson\'s content', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
    const prisma = makePrisma({
      course: {
        findUnique: vi.fn().mockResolvedValue(course([
          {
            id: 'mod-1',
            lessons: [
              { id: 'l1', title: 'Lección 1', youtubeId: 'dQw4w9WgXcQ', content: '<p>hi</p>', order: 1, moduleId: 'mod-1' },
              {
                id: 'l2', title: 'Lección 2', youtubeId: '', order: 2, moduleId: 'mod-1',
                content: '<h3>🎥 Videos Sugeridos</h3><ul><li><a href="https://www.youtube.com/watch?v=aaaaaaaaaaa">Video sugerido</a></li></ul>',
              },
            ],
          },
        ])),
      },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/courses/course-1/validate-videos'),
      method: 'GET', path: '/admin/courses/course-1/validate-videos', prisma,
    });

    const res = await handleCourses(ctx as any);
    const data = JSON.parse(res.body).data;

    expect(data.total).toBe(2);
    expect(data.broken).toBe(0);
    const lessonEntry = data.videos.find((v: any) => v.source === 'lesson');
    const suggestionEntry = data.videos.find((v: any) => v.source === 'suggestion');
    expect(lessonEntry).toMatchObject({ lessonId: 'l1', youtubeId: 'dQw4w9WgXcQ', ok: true });
    expect(suggestionEntry).toMatchObject({ lessonId: 'l2', youtubeId: 'aaaaaaaaaaa', title: 'Video sugerido', ok: true });
  });

  it('reports a broken suggestion link without flagging the search-fallback link as broken', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;
    const prisma = makePrisma({
      course: {
        findUnique: vi.fn().mockResolvedValue(course([
          {
            id: 'mod-1',
            lessons: [
              {
                id: 'l1', title: 'Lección 1', youtubeId: '', order: 1, moduleId: 'mod-1',
                content: '<ul>'
                  + '<li><a href="https://youtu.be/bbbbbbbbbbb">Video roto</a></li>'
                  + '<li><a href="https://youtube.com/results?search_query=fallback">Búsqueda</a></li>'
                  + '</ul>',
              },
            ],
          },
        ])),
      },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/courses/course-1/validate-videos'),
      method: 'GET', path: '/admin/courses/course-1/validate-videos', prisma,
    });

    const res = await handleCourses(ctx as any);
    const data = JSON.parse(res.body).data;

    // Only the real video link is checked — the keyword-search fallback has no video id
    // to validate and must not show up as a "broken" entry.
    expect(data.total).toBe(1);
    expect(data.broken).toBe(1);
    expect(data.videos[0]).toMatchObject({ youtubeId: 'bbbbbbbbbbb', source: 'suggestion', ok: false });
  });

  it('returns an empty, non-broken result for a course with no videos anywhere', async () => {
    const prisma = makePrisma({
      course: {
        findUnique: vi.fn().mockResolvedValue(course([
          { id: 'mod-1', lessons: [{ id: 'l1', title: 'Lección 1', youtubeId: '', content: '<p>solo texto</p>', order: 1, moduleId: 'mod-1' }] },
        ])),
      },
    });
    const ctx = makeAdminCtx({
      event: makeEvent('ADMIN', 'GET', '/admin/courses/course-1/validate-videos'),
      method: 'GET', path: '/admin/courses/course-1/validate-videos', prisma,
    });

    const res = await handleCourses(ctx as any);
    const data = JSON.parse(res.body).data;
    expect(data).toEqual({ videos: [], broken: 0, total: 0 });
  });
});
