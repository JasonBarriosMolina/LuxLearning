import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CoursePreviewPage from './page';

// jsdom doesn't implement scrollIntoView — the page calls it (via setTimeout) whenever
// a lesson/quiz/class/reflection nav item is clicked.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

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
  HelpCircle: () => null,
  MessageSquare: () => null,
  Mic: () => null,
  GraduationCap: () => null,
  CheckCircle2: () => null,
}));

vi.mock('@/components/shared/TextToSpeechButton', () => ({
  TextToSpeechButton: () => null,
}));

const courseWithExtras = {
  id: 'course-1', title: 'Curso Test',
  modules: [{
    id: 'm1', order: 1, title: 'Módulo 1', duration: '20 min',
    lessons: [],
    questions: [{ id: 'q1', text: '¿Cuál es la capital?', options: ['A', 'B', 'C'], correctIndex: 1 }],
  }],
  evaluationEvents: [
    { moduleId: 'm1', type: 'CLASS', name: 'Clase', lessonScript: 'Guión de la clase.', vapiPrompt: 'Prompt Q&A.', closingScript: 'Cierre.' },
    { moduleId: 'm1', type: 'REFLECTION', name: 'Reflexión', instructions: 'Escribe sobre tu experiencia.' },
  ],
};
const getMock = vi.fn().mockResolvedValue({ data: { id: 'course-1', title: 'Curso Test', modules: [] } });
vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      courses: {
        get: (...args: any[]) => getMock(...args),
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

describe('CoursePreviewPage — quiz/reflection/class preview (2026-09-01, Mack: needs to see ALL module content to catch errors)', () => {
  beforeEach(() => getMock.mockResolvedValue({ data: courseWithExtras }));

  it('shows a Quiz nav item and previews its questions/options when clicked', async () => {
    render(<CoursePreviewPage />);
    const quizBtn = await screen.findByRole('button', { name: /Quiz/ });
    fireEvent.click(quizBtn);
    await waitFor(() => expect(screen.getByText(/capital/)).toBeInTheDocument());
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('shows a Clase con Lux Mentor nav item and previews its script/prompt when clicked', async () => {
    render(<CoursePreviewPage />);
    await waitFor(() => expect(screen.getByText('Clase con Lux Mentor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clase con Lux Mentor'));
    await waitFor(() => expect(screen.getByText('Guión de la clase.')).toBeInTheDocument());
    expect(screen.getByText('Prompt Q&A.')).toBeInTheDocument();
    expect(screen.getByText('Cierre.')).toBeInTheDocument();
  });

  it('shows a Reflexión nav item and previews its instructions when clicked', async () => {
    render(<CoursePreviewPage />);
    await waitFor(() => expect(screen.getByText('Reflexión')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Reflexión'));
    await waitFor(() => expect(screen.getByText('Escribe sobre tu experiencia.')).toBeInTheDocument());
  });
});
