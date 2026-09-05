import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NotesPanel } from './NotesPanel';

// Trello DmPpbrff, 2026-09-02/04 (Mack, scoped by Jason) — server-persisted notes,
// no PDF export ("el uso y consumo es importante, la idea es que el estudiante
// revisite la app"), "Consultar a Lux Mentor" summarizes highlighted passages.

vi.mock('lucide-react', () => ({
  Sparkles: () => null, Trash2: () => null, Search: () => null, Tag: () => null, Loader2: () => null,
  NotebookPen: () => null,
}));

const notesMock = vi.fn();
const saveNoteMock = vi.fn();
const deleteNoteMock = vi.fn();
const summarizeHighlightsMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    lessons: {
      notes: (...a: any[]) => notesMock(...a),
      saveNote: (...a: any[]) => saveNoteMock(...a),
      deleteNote: (...a: any[]) => deleteNoteMock(...a),
      summarizeHighlights: (...a: any[]) => summarizeHighlightsMock(...a),
    },
  },
}));

vi.mock('@/lib/i18n', () => ({
  useLanguage: () => ({
    lang: 'es',
    t: {
      notesPanel: {
        title: 'Mis notas',
        empty: 'Todavía no tenés notas en esta lección.',
        addPlaceholder: 'Escribí una nota...',
        add: 'Agregar nota',
        searchPlaceholder: 'Buscar en tus notas...',
        noResults: 'No hay notas que coincidan con tu búsqueda.',
        delete: 'Eliminar',
        tagsPlaceholder: 'Etiquetas (separadas por coma)',
        summarizeHighlights: 'Consultar a Lux Mentor',
        summarizing: 'Generando resumen...',
        // Deliberately NOT 'resumen' — the backend (services/api/src/lessons/notes.ts)
        // always writes the tag literally as Spanish 'resumen' regardless of UI
        // language, so this mock uses a distinct translated label to catch any code
        // that (re)introduces comparing the raw tag against this translated string.
        summaryTag: 'summary',
        noHighlightsYet: 'Resaltá texto en la lección primero para poder pedir un resumen.',
        summarizeError: 'No se pudo generar el resumen. Intenta de nuevo.',
      },
    },
  }),
}));

const baseProps = { contextType: 'lesson' as const, contextId: 'l1', lessonTitle: 'La Música Barroca' };

describe('NotesPanel', () => {
  beforeEach(() => {
    notesMock.mockReset();
    saveNoteMock.mockReset();
    deleteNoteMock.mockReset();
    summarizeHighlightsMock.mockReset();
  });

  it('loads and lists notes for the given context on mount', async () => {
    notesMock.mockResolvedValue({ data: [
      { noteId: 'n1', contextType: 'lesson', contextId: 'l1', text: 'Repasar bajo continuo', tags: ['importante'], source: 'manual', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
    ] });
    render(<NotesPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText('Repasar bajo continuo')).toBeInTheDocument());
    expect(notesMock).toHaveBeenCalledWith('lesson', 'l1');
  });

  it('shows the empty state when there are no notes', async () => {
    notesMock.mockResolvedValue({ data: [] });
    render(<NotesPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText(/Todavía no tenés notas/)).toBeInTheDocument());
  });

  it('adds a manual note and reloads the list', async () => {
    notesMock.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [
      { noteId: 'n2', contextType: 'lesson', contextId: 'l1', text: 'Nueva nota', tags: [], source: 'manual', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
    ] });
    saveNoteMock.mockResolvedValue({});
    render(<NotesPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText(/Todavía no tenés notas/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Escribí una nota...'), { target: { value: 'Nueva nota' } });
    fireEvent.click(screen.getByText('Agregar nota'));

    await waitFor(() => expect(saveNoteMock).toHaveBeenCalledWith({ contextType: 'lesson', contextId: 'l1', text: 'Nueva nota', tags: [] }));
    await waitFor(() => expect(screen.getByText('Nueva nota')).toBeInTheDocument());
  });

  it('disables "Consultar a Lux Mentor" when there are no highlights to summarize', async () => {
    notesMock.mockResolvedValue({ data: [] });
    render(<NotesPanel {...baseProps} highlightsForSummary={[]} />);
    await waitFor(() => expect(screen.getByText('Consultar a Lux Mentor')).toBeInTheDocument());
    expect(screen.getByText('Consultar a Lux Mentor').closest('button')).toBeDisabled();
  });

  it('calls summarizeHighlights with the passed highlights and lesson title when clicked', async () => {
    notesMock.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [
      { noteId: 'n3', contextType: 'lesson', contextId: 'l1', text: 'Resumen generado.', tags: ['resumen'], source: 'highlight-summary', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
    ] });
    summarizeHighlightsMock.mockResolvedValue({});
    render(<NotesPanel {...baseProps} highlightsForSummary={['El bajo continuo es la base armónica.']} />);
    const btn = await screen.findByText('Consultar a Lux Mentor');
    expect(btn.closest('button')).not.toBeDisabled();

    fireEvent.click(btn);
    await waitFor(() => expect(summarizeHighlightsMock).toHaveBeenCalledWith({
      contextId: 'l1', highlights: ['El bajo continuo es la base armónica.'], lessonTitle: 'La Música Barroca',
    }));
    await waitFor(() => expect(screen.getByText('Resumen generado.')).toBeInTheDocument());
  });

  it('deletes a note optimistically', async () => {
    notesMock.mockResolvedValue({ data: [
      { noteId: 'n1', contextType: 'lesson', contextId: 'l1', text: 'Borrar esta', tags: [], source: 'manual', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
    ] });
    deleteNoteMock.mockResolvedValue({});
    render(<NotesPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText('Borrar esta')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Eliminar'));
    await waitFor(() => expect(screen.queryByText('Borrar esta')).not.toBeInTheDocument());
    expect(deleteNoteMock).toHaveBeenCalledWith({ contextType: 'lesson', contextId: 'l1', noteId: 'n1' });
  });

  it('hides the internal "resumen" tag even when the translated summary label differs (backend always writes it in Spanish)', async () => {
    // Regression: filtering used to compare the raw tag to the *translated* summaryTag
    // label ('summary' here), so the literal 'resumen' tag from the backend slipped
    // through as a second, untranslated pill next to the purple "summary" badge.
    notesMock.mockResolvedValue({ data: [
      { noteId: 'n4', contextType: 'lesson', contextId: 'l1', text: 'Summary text.', tags: ['resumen'], source: 'highlight-summary', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' },
    ] });
    render(<NotesPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText('Summary text.')).toBeInTheDocument());
    expect(screen.getByText('summary')).toBeInTheDocument(); // the translated badge
    expect(screen.queryByText('resumen')).not.toBeInTheDocument(); // the raw internal tag, hidden
  });

  it('never renders a PDF-export control (explicitly rejected by Mack)', async () => {
    notesMock.mockResolvedValue({ data: [] });
    render(<NotesPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText('Mis notas')).toBeInTheDocument());
    expect(screen.queryByText(/pdf/i)).not.toBeInTheDocument();
  });
});
