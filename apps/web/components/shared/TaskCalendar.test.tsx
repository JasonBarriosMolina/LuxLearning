import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCalendar } from './TaskCalendar';

// ── Mock react-big-calendar ────────────────────────────────────────────────
// The real calendar is a heavy UI component with canvas/grid logic. We mock it
// to expose the events list so we can test TaskCalendar's data/logic layer.
vi.mock('react-big-calendar', () => {
  const Views = { MONTH: 'month', WEEK: 'week', DAY: 'day', AGENDA: 'agenda' };
  const Calendar = ({ events, onSelectEvent }: { events: any[]; onSelectEvent: (e: any) => void }) => (
    <div data-testid="mock-calendar">
      {events.map((ev: any) => (
        <button
          key={ev.id}
          data-testid={`event-${ev.id}`}
          data-status={ev.resource.status}
          data-type={ev.resource.type}
          onClick={() => onSelectEvent(ev)}
        >
          {ev.title}
        </button>
      ))}
    </div>
  );
  const dateFnsLocalizer = () => ({});
  return { Calendar, Views, dateFnsLocalizer };
});

// Mock react-big-calendar CSS import
vi.mock('react-big-calendar/lib/css/react-big-calendar.css', () => ({}));

// ── Fixtures ───────────────────────────────────────────────────────────────
const baseTask = {
  taskId: 'task-1',
  title: 'Completar módulo 1',
  dueDate: '2026-06-01',
  status: 'PENDING' as const,
  type: 'complete_module',
};

const tasksAll = [
  { ...baseTask, taskId: 'task-1', title: 'Tarea pendiente', status: 'PENDING' as const },
  { ...baseTask, taskId: 'task-2', title: 'Tarea completada', status: 'COMPLETED' as const },
  { ...baseTask, taskId: 'task-3', title: 'Tarea vencida', status: 'OVERDUE' as const },
  { ...baseTask, taskId: 'task-4', title: 'Tarea enviada', status: 'SUBMITTED' as const },
];

// ── Tests ──────────────────────────────────────────────────────────────────
describe('TaskCalendar', () => {
  it('renders the calendar without tasks', () => {
    render(<TaskCalendar tasks={[]} />);
    expect(screen.getByTestId('mock-calendar')).toBeInTheDocument();
  });

  it('renders all provided tasks as calendar events', () => {
    render(<TaskCalendar tasks={tasksAll} />);
    expect(screen.getByTestId('event-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('event-task-2')).toBeInTheDocument();
    expect(screen.getByTestId('event-task-3')).toBeInTheDocument();
    expect(screen.getByTestId('event-task-4')).toBeInTheDocument();
  });

  it('event titles match task titles', () => {
    render(<TaskCalendar tasks={tasksAll} />);
    expect(screen.getByText('Tarea pendiente')).toBeInTheDocument();
    expect(screen.getByText('Tarea completada')).toBeInTheDocument();
    expect(screen.getByText('Tarea vencida')).toBeInTheDocument();
    expect(screen.getByText('Tarea enviada')).toBeInTheDocument();
  });

  it('passes status through to the event resource', () => {
    render(<TaskCalendar tasks={tasksAll} />);
    expect(screen.getByTestId('event-task-1').dataset.status).toBe('PENDING');
    expect(screen.getByTestId('event-task-2').dataset.status).toBe('COMPLETED');
    expect(screen.getByTestId('event-task-3').dataset.status).toBe('OVERDUE');
    expect(screen.getByTestId('event-task-4').dataset.status).toBe('SUBMITTED');
  });

  it('shows event detail popover on event click', () => {
    render(<TaskCalendar tasks={[baseTask]} />);
    fireEvent.click(screen.getByTestId('event-task-1'));
    // Title appears in both calendar button and popover h3 — use heading role
    expect(screen.getByRole('heading', { name: 'Completar módulo 1' })).toBeInTheDocument();
    // Popover shows due date
    expect(screen.getByText(/Vence:/)).toBeInTheDocument();
  });

  it('shows COMPLETED status badge in popover', () => {
    const completedTask = { ...baseTask, status: 'COMPLETED' as const };
    render(<TaskCalendar tasks={[completedTask]} />);
    fireEvent.click(screen.getByTestId('event-task-1'));
    expect(screen.getByText('Completada')).toBeInTheDocument();
  });

  it('shows OVERDUE status badge in popover', () => {
    const overdueTask = { ...baseTask, status: 'OVERDUE' as const };
    render(<TaskCalendar tasks={[overdueTask]} />);
    fireEvent.click(screen.getByTestId('event-task-1'));
    expect(screen.getByText('Vencida')).toBeInTheDocument();
  });

  it('shows courseTitle and moduleTitle in popover when present', () => {
    const task = { ...baseTask, courseTitle: 'JavaScript Avanzado', moduleTitle: 'Closures' };
    render(<TaskCalendar tasks={[task]} />);
    fireEvent.click(screen.getByTestId('event-task-1'));
    expect(screen.getByText(/JavaScript Avanzado/)).toBeInTheDocument();
    expect(screen.getByText(/Closures/)).toBeInTheDocument();
  });

  it('shows description in popover when present', () => {
    const task = { ...baseTask, description: 'Completa todas las lecciones del módulo.' };
    render(<TaskCalendar tasks={[task]} />);
    fireEvent.click(screen.getByTestId('event-task-1'));
    expect(screen.getByText('Completa todas las lecciones del módulo.')).toBeInTheDocument();
  });

  it('closes the popover when × button is clicked', () => {
    render(<TaskCalendar tasks={[baseTask]} />);
    fireEvent.click(screen.getByTestId('event-task-1'));
    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
    // The popover title should be gone (only visible in popover, not calendar events)
    // The calendar event still shows the title, so check the status badge instead
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument();
  });

  it('calls onEventClick callback when an event is selected', () => {
    const onEventClick = vi.fn();
    render(<TaskCalendar tasks={[baseTask]} onEventClick={onEventClick} />);
    fireEvent.click(screen.getByTestId('event-task-1'));
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1' }));
  });

  it('renders type legend entries', () => {
    render(<TaskCalendar tasks={[]} />);
    expect(screen.getByText('Completar módulo')).toBeInTheDocument();
    expect(screen.getByText('Tarea libre')).toBeInTheDocument();
  });

  it('renders with EVALUATOR role without errors', () => {
    render(<TaskCalendar tasks={tasksAll} role="EVALUATOR" />);
    expect(screen.getByTestId('mock-calendar')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^event-/)).toHaveLength(4);
  });
});
