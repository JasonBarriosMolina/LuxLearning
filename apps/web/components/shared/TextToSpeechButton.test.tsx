import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TextToSpeechButton } from './TextToSpeechButton';

// Trello DmPpbrff, 2026-08-31 19:54 — Mack: a lesson without a pre-generated Polly
// audioUrl fell back to the browser's free voice ("no son voces agradables"). Fix:
// lazily request real Polly narration in the background when a lessonId is given.
const audioMock = vi.fn();
// questionAudio (Trello DmPpbrff, 2026-09-03 — Mack: quiz/exam questions still used
// the browser voice) mirrors lessons.audio but caches on the Question row instead.
const questionAudioMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { lessons: { audio: (...args: any[]) => audioMock(...args) }, quiz: { questionAudio: (...args: any[]) => questionAudioMock(...args) } } }));
let mockLang = 'es';
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: mockLang }) }));

describe('TextToSpeechButton — lazy Polly audio fetch', () => {
  beforeEach(() => {
    audioMock.mockReset();
    localStorage.clear();
    mockLang = 'es';
    // jsdom has no real speechSynthesis — stub it so the WebSpeechPlayer fallback
    // actually renders its button, same as it would in a real browser.
    (window as any).speechSynthesis = { getVoices: () => [], onvoiceschanged: null, cancel: vi.fn() };
  });

  it('fetches audio when lessonId is given and audioUrl is missing', async () => {
    audioMock.mockResolvedValue({ data: { audioUrl: 'https://s3.example.com/lesson-1-mia.mp3' } });
    render(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />);
    await waitFor(() => expect(audioMock).toHaveBeenCalledWith('lesson-1', undefined, 'es'));
  });

  it('does NOT fetch when audioUrl already exists', () => {
    render(<TextToSpeechButton text="<p>Contenido</p>" audioUrl="https://s3.example.com/existing.mp3" lessonId="lesson-1" />);
    expect(audioMock).not.toHaveBeenCalled();
  });

  it('does NOT fetch when neither lessonId nor questionId is given', () => {
    render(<TextToSpeechButton text="Texto sin id" />);
    expect(audioMock).not.toHaveBeenCalled();
    expect(questionAudioMock).not.toHaveBeenCalled();
  });

  it('fetches via questionAudio (not lessons.audio) when questionId is given instead of lessonId', async () => {
    questionAudioMock.mockResolvedValue({ data: { audioUrl: 'https://s3.example.com/question-1-mia.mp3' } });
    render(<TextToSpeechButton text="¿Cuánto es 2+2?" questionId="q1" />);
    await waitFor(() => expect(questionAudioMock).toHaveBeenCalledWith('q1'));
    expect(audioMock).not.toHaveBeenCalled();
  });

  it('never throws when the fetch fails — stays on the browser-voice fallback silently', async () => {
    audioMock.mockRejectedValue(new Error('network down'));
    expect(() => render(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />)).not.toThrow();
    await waitFor(() => expect(audioMock).toHaveBeenCalled());
    // Component should still render its Listen button, not crash
    expect(screen.getByText(/Escuchar/i)).toBeTruthy();
  });

  // Trello DmPpbrff, 2026-09-04 — Mack: switching the platform language mid-lesson kept
  // narrating in the old language — the fetch effect never re-fired on a lang change.
  it('re-fetches with the new lang when the platform language changes mid-mount', async () => {
    audioMock.mockResolvedValue({ data: { audioUrl: 'https://s3.example.com/lesson-1-es.mp3' } });
    const { rerender } = render(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />);
    await waitFor(() => expect(audioMock).toHaveBeenCalledWith('lesson-1', undefined, 'es'));

    audioMock.mockClear();
    audioMock.mockResolvedValue({ data: { audioUrl: 'https://s3.example.com/lesson-1-en.mp3' } });
    mockLang = 'en';
    rerender(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />);

    await waitFor(() => expect(audioMock).toHaveBeenCalledWith('lesson-1', undefined, 'en'));
  });
});

describe('TextToSpeechButton — voice model selector only (Trello DmPpbrff, 2026-09-01 14:40)', () => {
  beforeEach(() => {
    audioMock.mockReset();
    localStorage.clear();
    mockLang = 'es';
    (window as any).speechSynthesis = { getVoices: () => [], onvoiceschanged: null, cancel: vi.fn() };
  });

  it('never renders the removed "voz preferida"/"voz del curso" source picker', async () => {
    audioMock.mockResolvedValue({ data: { audioUrl: 'https://s3.example.com/lesson-1-mia.mp3' } });
    render(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />);
    await waitFor(() => expect(audioMock).toHaveBeenCalled());
    expect(screen.queryByText(/Mi voz preferida/i)).toBeNull();
    expect(screen.queryByText(/Voz del curso/i)).toBeNull();
  });

  it('fetches a fresh male-voice clip on demand when the student switches the voice model', async () => {
    audioMock.mockImplementation(async (_lessonId: string, gender?: string) =>
      gender === 'male'
        ? { data: { audioUrl: 'https://s3.example.com/lesson-1-sergio.mp3' } }
        : { data: { audioUrl: 'https://s3.example.com/lesson-1-mia.mp3' } }
    );
    render(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />);
    await waitFor(() => expect(audioMock).toHaveBeenCalledWith('lesson-1', undefined, 'es'));

    const select = screen.getByTitle(/Perfil de voz/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'male' } });

    await waitFor(() => expect(audioMock).toHaveBeenCalledWith('lesson-1', 'male', 'es'));
  });
});
