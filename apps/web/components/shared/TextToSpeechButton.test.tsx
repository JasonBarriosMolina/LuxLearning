import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TextToSpeechButton } from './TextToSpeechButton';

// Trello DmPpbrff, 2026-08-31 19:54 — Mack: a lesson without a pre-generated Polly
// audioUrl fell back to the browser's free voice ("no son voces agradables"). Fix:
// lazily request real Polly narration in the background when a lessonId is given.
const audioMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { lessons: { audio: (...args: any[]) => audioMock(...args) } } }));
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'es' }) }));

describe('TextToSpeechButton — lazy Polly audio fetch', () => {
  beforeEach(() => {
    audioMock.mockReset();
    localStorage.clear();
    // jsdom has no real speechSynthesis — stub it so the WebSpeechPlayer fallback
    // actually renders its button, same as it would in a real browser.
    (window as any).speechSynthesis = { getVoices: () => [], onvoiceschanged: null, cancel: vi.fn() };
  });

  it('fetches audio when lessonId is given and audioUrl is missing', async () => {
    audioMock.mockResolvedValue({ data: { audioUrl: 'https://s3.example.com/lesson-1-mia.mp3' } });
    render(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />);
    await waitFor(() => expect(audioMock).toHaveBeenCalledWith('lesson-1'));
  });

  it('does NOT fetch when audioUrl already exists', () => {
    render(<TextToSpeechButton text="<p>Contenido</p>" audioUrl="https://s3.example.com/existing.mp3" lessonId="lesson-1" />);
    expect(audioMock).not.toHaveBeenCalled();
  });

  it('does NOT fetch when no lessonId is given (e.g. quiz questions — no Lesson row to cache on)', () => {
    render(<TextToSpeechButton text="Pregunta de quiz" />);
    expect(audioMock).not.toHaveBeenCalled();
  });

  it('never throws when the fetch fails — stays on the browser-voice fallback silently', async () => {
    audioMock.mockRejectedValue(new Error('network down'));
    expect(() => render(<TextToSpeechButton text="<p>Contenido</p>" lessonId="lesson-1" />)).not.toThrow();
    await waitFor(() => expect(audioMock).toHaveBeenCalled());
    // Component should still render its Listen button, not crash
    expect(screen.getByText(/Escuchar/i)).toBeTruthy();
  });
});
