import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LuxMentorClassNarration } from './LuxMentorClassNarration';

// Trello DmPpbrff, 2026-09-01 01:10 (Mack) — exposition redesign: styled content +
// live captions synced to lessonSpeechMarks + a persisted notes textarea.

// jsdom's HTMLMediaElement has no real scrollIntoView implementation.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const marks = [
  { time: 0, value: 'Primera oración.' },
  { time: 2000, value: 'Segunda oración.' },
];

describe('LuxMentorClassNarration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders each speech mark as a caption line', () => {
    render(
      <LuxMentorClassNarration
        lessonScript="Tema completo del guion."
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={marks}
        notesStorageKey="notes-key-1"
        lang="es"
        onEnded={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByText('Primera oración.')).toBeInTheDocument();
    expect(screen.getByText('Segunda oración.')).toBeInTheDocument();
  });

  it('falls back to the plain lessonScript when there are no speech marks (legacy class)', () => {
    render(
      <LuxMentorClassNarration
        lessonScript="Guion legado sin marks."
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        notesStorageKey="notes-key-2"
        lang="es"
        onEnded={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByText('Guion legado sin marks.')).toBeInTheDocument();
  });

  it('calls onError when the narration audio fails to load (never strands the student)', () => {
    const onError = vi.fn();
    const { container } = render(
      <LuxMentorClassNarration
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/broken.mp3"
        lessonSpeechMarks={null}
        notesStorageKey="notes-key-3"
        lang="es"
        onEnded={vi.fn()}
        onError={onError}
      />,
    );
    fireEvent.error(container.querySelector('audio')!);
    expect(onError).toHaveBeenCalled();
  });

  it('persists notes to localStorage under the given key as the student types', () => {
    render(
      <LuxMentorClassNarration
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        notesStorageKey="notes-key-4"
        lang="es"
        onEnded={vi.fn()}
        onError={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(/Escribe aquí/);
    fireEvent.change(textarea, { target: { value: 'Nota importante' } });
    expect(localStorage.getItem('notes-key-4')).toBe('Nota importante');
  });

  it('restores previously saved notes for the same key on mount', () => {
    localStorage.setItem('notes-key-5', 'Nota guardada antes');
    render(
      <LuxMentorClassNarration
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        notesStorageKey="notes-key-5"
        lang="es"
        onEnded={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Nota guardada antes')).toBeInTheDocument();
  });

  it('renders the English label when lang="en"', () => {
    render(
      <LuxMentorClassNarration
        lessonScript={null}
        lessonAudioUrl="https://s3.example.com/class.mp3"
        lessonSpeechMarks={null}
        notesStorageKey="notes-key-6"
        lang="en"
        onEnded={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByText('My notes about the class')).toBeInTheDocument();
  });
});
