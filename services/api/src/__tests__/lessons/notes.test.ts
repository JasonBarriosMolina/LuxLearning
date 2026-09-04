/**
 * Tests for /lessons/notes* (lux-lessons) — Trello DmPpbrff, 2026-09-04 (Mack):
 * server-persisted student notes, and "Consultar a Lux Mentor" summarizing a
 * lesson's highlighted passages into one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `bedrock` is instantiated once at notes.ts module scope (new BedrockRuntimeClient()),
// so every call shares this one mock — sharing the vi.fn() here (not a fresh one per
// `new BedrockRuntimeClient()` call) is what lets tests configure/assert on it.
// vi.hoisted() is the robust way to make a value available inside a hoisted vi.mock()
// factory (name-prefix heuristics didn't take effect in this vitest version).
const { mockBedrockSend } = vi.hoisted(() => ({ mockBedrockSend: vi.fn() }));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: function () { return { send: mockBedrockSend }; },
  InvokeModelCommand: function (x: any) { return x; },
}));

const ddbSendMock = vi.fn();
vi.mock('../../shared/db-core', () => ({
  ddb: { send: (...a: any[]) => ddbSendMock(...a) },
  TABLES: { PROGRESS: 'LessonProgress' },
}));

import { handleLessonNotes } from '../../lessons/notes';

function makeEvent(method: string, path: string, body?: any, query?: Record<string, string>) {
  return {
    headers: {},
    requestContext: { http: { method }, authorizer: { lambda: { userId: 'student-1', email: 's@test.com', role: 'STUDENT' } } },
    rawPath: path,
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : undefined,
  } as any;
}

async function bodyOf(res: any) {
  return JSON.parse(res.body);
}

describe('handleLessonNotes routing', () => {
  it('returns null for an unrelated route (falls through to the caller)', async () => {
    const res = await handleLessonNotes(makeEvent('GET', '/lessons/progress'), 'student-1', 'GET', '/lessons/progress');
    expect(res).toBeNull();
  });
});

describe('GET /lessons/notes', () => {
  beforeEach(() => ddbSendMock.mockReset());

  it('returns 400 when contextType or contextId is missing', async () => {
    const res = await handleLessonNotes(makeEvent('GET', '/lessons/notes', undefined, { contextType: 'lesson' }), 'student-1', 'GET', '/lessons/notes');
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an invalid contextType', async () => {
    const res = await handleLessonNotes(
      makeEvent('GET', '/lessons/notes', undefined, { contextType: 'course', contextId: 'l1' }),
      'student-1', 'GET', '/lessons/notes',
    );
    expect(res.statusCode).toBe(400);
  });

  it('lists notes for the given lesson, newest first', async () => {
    ddbSendMock.mockResolvedValue({
      Items: [
        { userId: 'student-1', sk: 'NOTE#lesson#l1#n1', noteId: 'n1', contextType: 'lesson', contextId: 'l1', text: 'Primera', tags: [], source: 'manual', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
        { userId: 'student-1', sk: 'NOTE#lesson#l1#n2', noteId: 'n2', contextType: 'lesson', contextId: 'l1', text: 'Segunda', tags: ['duda'], source: 'manual', createdAt: '2026-09-04T11:00:00.000Z', updatedAt: '2026-09-04T11:00:00.000Z' },
      ],
    });
    const res = await handleLessonNotes(
      makeEvent('GET', '/lessons/notes', undefined, { contextType: 'lesson', contextId: 'l1' }),
      'student-1', 'GET', '/lessons/notes',
    );
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.map((n: any) => n.noteId)).toEqual(['n2', 'n1']); // newest first
  });
});

describe('POST /lessons/notes — create/update', () => {
  beforeEach(() => ddbSendMock.mockReset());

  it('returns 400 when text is missing', async () => {
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes', { contextType: 'lesson', contextId: 'l1' }),
      'student-1', 'POST', '/lessons/notes',
    );
    expect(res.statusCode).toBe(400);
  });

  it('creates a new note with a generated noteId and default source=manual', async () => {
    ddbSendMock.mockResolvedValue({});
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes', { contextType: 'lesson', contextId: 'l1', text: 'Repasar esto', tags: ['importante'] }),
      'student-1', 'POST', '/lessons/notes',
    );
    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.text).toBe('Repasar esto');
    expect(body.data.tags).toEqual(['importante']);
    expect(body.data.source).toBe('manual');
    expect(body.data.noteId).toBeTruthy();
  });

  it('caps tags at 10 and each tag at 40 chars, and text at 2000 chars', async () => {
    ddbSendMock.mockResolvedValue({});
    const longText = 'x'.repeat(3000);
    const manyTags = Array.from({ length: 15 }, (_, i) => `tag-${i}`.repeat(3));
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes', { contextType: 'lesson', contextId: 'l1', text: longText, tags: manyTags }),
      'student-1', 'POST', '/lessons/notes',
    );
    const body = await bodyOf(res);
    expect(body.data.text.length).toBe(2000);
    expect(body.data.tags.length).toBe(10);
    expect(body.data.tags[0].length).toBeLessThanOrEqual(40);
  });
});

describe('POST /lessons/notes/delete', () => {
  beforeEach(() => ddbSendMock.mockReset());

  it('returns 400 when noteId is missing', async () => {
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes/delete', { contextType: 'lesson', contextId: 'l1' }),
      'student-1', 'POST', '/lessons/notes/delete',
    );
    expect(res.statusCode).toBe(400);
  });

  it('deletes the note', async () => {
    ddbSendMock.mockResolvedValue({});
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes/delete', { contextType: 'lesson', contextId: 'l1', noteId: 'n1' }),
      'student-1', 'POST', '/lessons/notes/delete',
    );
    expect(res.statusCode).toBe(200);
    expect(ddbSendMock).toHaveBeenCalled();
  });
});

describe('POST /lessons/notes/summarize-highlights', () => {
  beforeEach(() => { ddbSendMock.mockReset(); mockBedrockSend.mockReset(); });

  it('returns 400 when highlights is missing or empty', async () => {
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes/summarize-highlights', { contextId: 'l1', highlights: [] }),
      'student-1', 'POST', '/lessons/notes/summarize-highlights',
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when contextId is missing', async () => {
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes/summarize-highlights', { highlights: ['algo'] }),
      'student-1', 'POST', '/lessons/notes/summarize-highlights',
    );
    expect(res.statusCode).toBe(400);
  });

  it('summarizes highlights via Bedrock and saves the result as a note with source=highlight-summary', async () => {
    mockBedrockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({ content: [{ text: 'Resumen generado de los resaltados.' }] })),
    });
    ddbSendMock.mockResolvedValue({});

    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes/summarize-highlights', {
        contextId: 'l1', lessonTitle: 'La Música Barroca',
        highlights: ['El bajo continuo es la base armónica.', 'El stile rappresentativo nace con Monteverdi.'],
      }),
      'student-1', 'POST', '/lessons/notes/summarize-highlights',
    );

    expect(res.statusCode).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.text).toBe('Resumen generado de los resaltados.');
    expect(body.data.source).toBe('highlight-summary');
    expect(body.data.tags).toEqual(['resumen']);
    expect(body.data.contextType).toBe('lesson');
    expect(body.data.contextId).toBe('l1');

    const promptSent = mockBedrockSend.mock.calls[0]?.[0]?.body;
    const parsedPrompt = JSON.parse(promptSent).messages[0].content as string;
    expect(parsedPrompt).toContain('El bajo continuo es la base armónica.');
    expect(parsedPrompt).toContain('La Música Barroca');
  });

  it('returns a server error (and saves nothing) when Bedrock returns an empty summary', async () => {
    mockBedrockSend.mockResolvedValue({ body: new TextEncoder().encode(JSON.stringify({ content: [{ text: '   ' }] })) });
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes/summarize-highlights', { contextId: 'l1', highlights: ['algo'] }),
      'student-1', 'POST', '/lessons/notes/summarize-highlights',
    );
    expect(res.statusCode).toBe(500);
    expect(ddbSendMock).not.toHaveBeenCalled();
  });

  it('returns a server error (not a crash) when Bedrock itself fails', async () => {
    mockBedrockSend.mockRejectedValue(new Error('bedrock down'));
    const res = await handleLessonNotes(
      makeEvent('POST', '/lessons/notes/summarize-highlights', { contextId: 'l1', highlights: ['algo'] }),
      'student-1', 'POST', '/lessons/notes/summarize-highlights',
    );
    expect(res.statusCode).toBe(500);
  });
});
