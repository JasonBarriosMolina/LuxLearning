import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
