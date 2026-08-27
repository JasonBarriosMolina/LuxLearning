import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CoursePreviewPage from './page';

const mockBack = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ courseId: 'course-1' }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: () => null,
  PlayCircle: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Lightbulb: () => null,
  BookOpen: () => null,
  Pencil: () => null,
}));

vi.mock('@/components/shared/TextToSpeechButton', () => ({
  TextToSpeechButton: () => null,
}));

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      courses: {
        get: vi.fn().mockResolvedValue({ data: { id: 'course-1', title: 'Curso Test', modules: [] } }),
      },
    },
  },
}));

describe('CoursePreviewPage — botón Volver Atrás', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockPush.mockClear();
  });

  it('llama router.back() cuando hay historial previo (bug: antes forzaba a /evaluator/my-courses)', async () => {
    const originalLength = Object.getOwnPropertyDescriptor(window.history, 'length');
    Object.defineProperty(window.history, 'length', { value: 3, configurable: true });

    render(<CoursePreviewPage />);
    await waitFor(() => expect(screen.getByText('Curso Test')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Volver Atrás'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalledWith('/evaluator/my-courses');

    if (originalLength) Object.defineProperty(window.history, 'length', originalLength);
  });

  it('usa fallback a /evaluator/my-courses cuando no hay historial (entrada directa)', async () => {
    const originalLength = Object.getOwnPropertyDescriptor(window.history, 'length');
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true });

    render(<CoursePreviewPage />);
    await waitFor(() => expect(screen.getByText('Curso Test')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Volver Atrás'));

    expect(mockPush).toHaveBeenCalledWith('/evaluator/my-courses');
    expect(mockBack).not.toHaveBeenCalled();

    if (originalLength) Object.defineProperty(window.history, 'length', originalLength);
  });
});
