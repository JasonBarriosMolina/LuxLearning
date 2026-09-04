import { describe, it, expect, vi, beforeEach } from 'vitest';

const ddbSendMock = vi.fn();
vi.mock('../../shared/db-core', () => ({
  ddb: { send: (...a: any[]) => ddbSendMock(...a) },
  TABLES: { PROGRESS: 'LessonProgress' },
}));

import { listNotes, saveNote, deleteNote } from '../../shared/db-notes';

describe('db-notes', () => {
  beforeEach(() => ddbSendMock.mockReset());

  describe('saveNote', () => {
    it('creates a new note with a fresh noteId when none is given', async () => {
      ddbSendMock.mockResolvedValue({});
      const note = await saveNote('user-1', { contextType: 'lesson', contextId: 'l1', text: 'Hola' });
      expect(note.noteId).toBeTruthy();
      expect(note.contextType).toBe('lesson');
      expect(note.text).toBe('Hola');
      expect(note.source).toBe('manual');
      expect(note.createdAt).toBe(note.updatedAt); // brand new — same timestamp
      // Only one DDB call for a create (no pre-fetch needed without an existing noteId)
      expect(ddbSendMock).toHaveBeenCalledTimes(1);
    });

    it('preserves the original createdAt when updating an existing note (noteId given)', async () => {
      const originalCreatedAt = '2026-09-01T00:00:00.000Z';
      ddbSendMock
        .mockResolvedValueOnce({ Item: { createdAt: originalCreatedAt } }) // the pre-fetch GetCommand
        .mockResolvedValueOnce({}); // the PutCommand
      const note = await saveNote('user-1', { noteId: 'n1', contextType: 'lesson', contextId: 'l1', text: 'Editada' });
      expect(note.noteId).toBe('n1');
      expect(note.createdAt).toBe(originalCreatedAt);
      expect(note.updatedAt).not.toBe(originalCreatedAt);
      expect(ddbSendMock).toHaveBeenCalledTimes(2); // Get then Put
    });

    it('falls back to "now" as createdAt when updating a noteId that has no existing item (edge case, never actually missing)', async () => {
      ddbSendMock
        .mockResolvedValueOnce({}) // no Item found
        .mockResolvedValueOnce({});
      const note = await saveNote('user-1', { noteId: 'n404', contextType: 'lesson', contextId: 'l1', text: 'x' });
      expect(note.createdAt).toBe(note.updatedAt);
    });

    it('never leaks userId/sk in the returned note (internal DDB keys stripped)', async () => {
      ddbSendMock.mockResolvedValue({});
      const note = await saveNote('user-1', { contextType: 'class', contextId: 'c1', text: 'x' });
      expect((note as any).userId).toBeUndefined();
      expect((note as any).sk).toBeUndefined();
    });
  });

  describe('listNotes', () => {
    it('queries by the userId + contextType/contextId sk prefix', async () => {
      ddbSendMock.mockResolvedValue({ Items: [] });
      await listNotes('user-1', 'lesson', 'l1');
      const call = ddbSendMock.mock.calls[0][0];
      expect(call.input.ExpressionAttributeValues[':uid']).toBe('user-1');
      expect(call.input.ExpressionAttributeValues[':prefix']).toBe('NOTE#lesson#l1#');
    });

    it('returns notes sorted newest first', async () => {
      ddbSendMock.mockResolvedValue({
        Items: [
          { noteId: 'old', createdAt: '2026-09-01T00:00:00.000Z', contextType: 'lesson', contextId: 'l1', text: 'a', tags: [], source: 'manual', updatedAt: '' },
          { noteId: 'new', createdAt: '2026-09-03T00:00:00.000Z', contextType: 'lesson', contextId: 'l1', text: 'b', tags: [], source: 'manual', updatedAt: '' },
          { noteId: 'mid', createdAt: '2026-09-02T00:00:00.000Z', contextType: 'lesson', contextId: 'l1', text: 'c', tags: [], source: 'manual', updatedAt: '' },
        ],
      });
      const notes = await listNotes('user-1', 'lesson', 'l1');
      expect(notes.map((n) => n.noteId)).toEqual(['new', 'mid', 'old']);
    });

    it('defaults tags to [] and source to "manual" for legacy/incomplete items', async () => {
      ddbSendMock.mockResolvedValue({ Items: [{ noteId: 'n1', createdAt: '2026-09-01T00:00:00.000Z', contextType: 'lesson', contextId: 'l1', text: 'x', updatedAt: '' }] });
      const notes = await listNotes('user-1', 'lesson', 'l1');
      expect(notes[0].tags).toEqual([]);
      expect(notes[0].source).toBe('manual');
    });
  });

  describe('deleteNote', () => {
    it('deletes by the exact userId + sk key', async () => {
      ddbSendMock.mockResolvedValue({});
      await deleteNote('user-1', 'lesson', 'l1', 'n1');
      const call = ddbSendMock.mock.calls[0][0];
      expect(call.input.Key).toEqual({ userId: 'user-1', sk: 'NOTE#lesson#l1#n1' });
    });
  });
});
