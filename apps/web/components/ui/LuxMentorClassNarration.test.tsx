import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LuxMentorClassNarration } from './LuxMentorClassNarration';

// Trello DmPpbrff, 2026-09-01 01:10 (Mack) — exposition redesign: styled content +
// live captions synced to lessonSpeechMarks.
//
// Notes redesign (Trello DmPpbrff, 2026-09-05 — Mack: "la interfaz de las clases de
// las notas de LuxMentor sea como las del pop-up"): the old localStorage-only
// textarea is gone — this now renders the same floating NotesPanel popup used on
// the text-lesson page (contextType='class'), so its own tests just verify the
// toggle button wires the right context through; NotesPanel's own behavior is
// covered by its own test file.

// jsdom's HTMLMediaElement has no real scrollIntoView implementation.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('lucide-react', () => ({
  Volume2: () => null, NotebookPen: () => null, X: () => null,
  Sparkles: () => null, Trash2: () => null, Search: () => null, Tag: () => null, Loader2: () => null,
}));
const notesMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { lessons: { notes: (...a: any[]) => notesMock(...a), saveNote: vi.fn(), deleteNote: vi.fn(), summarizeHighlights: vi.fn() } },
}));
vi.mock('@/lib/i18n', () => ({
  useLanguage: () => ({
    lang: 'es',
    t: { notesPanel: {
      title: 'Mis notas', empty: 'Sin notas.', addPlaceholder: 'Escribí...', add: 'Agregar',
      searchPlaceholder: 'Buscar...', noResults: 'Sin resultados.', delete: 'Eliminar',
      tagsPlaceholder: 'Etiquetas', summarizeHighlights: 'Consultar a Lux Mentor',
      summarizing: 'Generando...', summaryTag: 'resumen', noHighlightsYet: 'Resaltá texto primero.',
      summarizeError: 'Error.',
    } },
  }),
}));

const marks = [
  { time: 0, value: 'Primera oración.' },
  { time: 2000, value: 'Segunda oración.' },
];
const baseProps = { moduleId: 'm1', onEnded: vi.fn(), onError: vi.fn() };

describe('LuxMentorClassNarration', () => {
  it('renders each speech mark as a caption line', () => {
    render(
      <LuxMentorClassNarration
        {...baseProps}
        lessonScript="Tema completo del guion."
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={marks}
        lang="es"
      />,
    );
    expect(screen.getByText('Primera oración.')).toBeInTheDocument();
    expect(screen.getByText('Segunda oración.')).toBeInTheDocument();
  });

  it('falls back to the plain lessonScript when there are no speech marks (legacy class)', () => {
    render(
      <LuxMentorClassNarration
        {...baseProps}
        lessonScript="Guion legado sin marks."
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        lang="es"
      />,
    );
    expect(screen.getByText('Guion legado sin marks.')).toBeInTheDocument();
  });

  it('calls onError when the narration audio fails to load (never strands the student)', () => {
    const onError = vi.fn();
    const { container } = render(
      <LuxMentorClassNarration
        {...baseProps}
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/broken.mp3"
        lessonSpeechMarks={null}
        lang="es"
        onError={onError}
      />,
    );
    fireEvent.error(container.querySelector('audio')!);
    expect(onError).toHaveBeenCalled();
  });

  it('renders a floating notes button, closed by default', () => {
    render(
      <LuxMentorClassNarration
        {...baseProps}
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        lang="es"
      />,
    );
    expect(screen.getByTitle('Mis notas')).toBeInTheDocument();
    expect(screen.queryByText('Consultar a Lux Mentor')).not.toBeInTheDocument();
  });

  it('opens the NotesPanel scoped to contextType="class" + this moduleId when clicked', async () => {
    notesMock.mockResolvedValue({ data: [] });
    render(
      <LuxMentorClassNarration
        {...baseProps}
        moduleId="m-xyz"
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        lang="es"
      />,
    );
    fireEvent.click(screen.getByTitle('Mis notas'));
    await waitFor(() => expect(notesMock).toHaveBeenCalledWith('class', 'm-xyz'));
    expect(screen.getByText('Consultar a Lux Mentor')).toBeInTheDocument();
  });

  it('shows the English button title when lang="en"', () => {
    render(
      <LuxMentorClassNarration
        {...baseProps}
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        lang="en"
      />,
    );
    expect(screen.getByTitle('My notes')).toBeInTheDocument();
  });
});
