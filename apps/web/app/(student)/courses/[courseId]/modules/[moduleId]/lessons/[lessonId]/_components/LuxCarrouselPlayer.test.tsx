import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LuxCarrouselPlayer } from './LuxCarrouselPlayer';

// Trello DmPpbrff, 2026-09-02 22:12 (Mack): "si ya el carrusel se vio y lo vio el
// estudiante una primera vez, el botón de continuar debería aparecer
// automáticamente." Root cause: the parent page's `completed` state starts false
// and only flips true one render after mount (its own useEffect fires once lesson
// data arrives) — `useState(hasCompletedBefore)` only reads the prop once at
// mount, so it locked in ended=false and never noticed hasCompletedBefore
// becoming true a tick later.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('lucide-react', () => ({
  Lock: () => null, Download: () => null, Play: () => null, Pause: () => null,
  Maximize: () => null, Minimize: () => null, ChevronRight: () => null,
  Captions: () => null, FileText: () => null, ChevronDown: () => null, ChevronUp: () => null,
}));
vi.mock('@/lib/api', () => ({ api: { lessons: { carouselRecap: vi.fn() } } }));

const baseProps = {
  courseId: 'c1', moduleId: 'm1', lessonId: 'l1', audioUrl: 'https://example.com/a.mp3',
  slides: [], pdfRecapUrl: null, onCompleted: vi.fn(),
  nextLessonId: 'l2', nextLessonTitle: 'Siguiente lección',
};

describe('LuxCarrouselPlayer — auto-shows "Siguiente" when hasCompletedBefore becomes true late', () => {
  it('shows the "Siguiente" CTA immediately when hasCompletedBefore is true from the start', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore />);
    expect(screen.getByText(/Siguiente lección/)).toBeInTheDocument();
  });

  it('shows the "Siguiente" CTA after hasCompletedBefore flips from false to true on a later render (the real-world timing bug)', () => {
    const { rerender } = render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore={false} />);
    expect(screen.queryByText(/Siguiente lección/)).not.toBeInTheDocument();

    // Simulates the parent's `completed` state arriving one render after mount.
    rerender(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore={true} />);
    expect(screen.getByText(/Siguiente lección/)).toBeInTheDocument();
  });

  it('does not show the CTA on a genuine first view that has not ended', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore={false} />);
    expect(screen.queryByText(/Siguiente lección/)).not.toBeInTheDocument();
  });
});

// Trello DmPpbrff, 2026-09-04 (Mack): "No hay close captions en los carrouseles...
// Ni transcripción del texto post clase." Both reuse the same Polly speech marks
// already stored for slide timing — no new generation step.
const speechMarks = [
  { time: 0, value: 'Primera frase de la narración.' },
  { time: 2000, value: 'Segunda frase de la narración.' },
];

describe('LuxCarrouselPlayer — close captions toggle', () => {
  it('does not render a CC button when there are no speech marks', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore speechMarks={[]} />);
    expect(screen.queryByTitle('Mostrar subtítulos')).not.toBeInTheDocument();
  });

  it('renders a CC button when speech marks are available, off by default', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore speechMarks={speechMarks} />);
    const btn = screen.getByTitle('Mostrar subtítulos');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles aria-pressed and title when clicked', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore speechMarks={speechMarks} />);
    fireEvent.click(screen.getByTitle('Mostrar subtítulos'));
    expect(screen.getByTitle('Ocultar subtítulos')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('LuxCarrouselPlayer — post-class transcript', () => {
  it('does not render a transcript section when there are no speech marks', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore speechMarks={[]} />);
    expect(screen.queryByText('Transcripción de la clase')).not.toBeInTheDocument();
  });

  it('renders a collapsed transcript toggle once the carousel has ended', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore speechMarks={speechMarks} />);
    expect(screen.getByText('Transcripción de la clase')).toBeInTheDocument();
    expect(screen.queryByText(/Primera frase de la narración/)).not.toBeInTheDocument();
  });

  it('expands to show the full joined transcript text when clicked', () => {
    render(<LuxCarrouselPlayer {...baseProps} hasCompletedBefore speechMarks={speechMarks} />);
    fireEvent.click(screen.getByText('Transcripción de la clase'));
    expect(screen.getByText('Primera frase de la narración. Segunda frase de la narración.')).toBeInTheDocument();
  });
});
