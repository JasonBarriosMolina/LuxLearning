import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminEvaluatorMetrics } from './AdminEvaluatorMetrics';

// Trello DmPpbrff, 2026-09-07 (Mack): admin dashboard needs evaluator-level
// metrics, not just student info.
const reportsMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { admin: { reports: () => reportsMock() } } }));

describe('AdminEvaluatorMetrics', () => {
  it('shows the empty state when no evaluators have courses assigned', async () => {
    reportsMock.mockResolvedValue({ data: { evaluatorStats: [] } });
    render(<AdminEvaluatorMetrics />);
    await waitFor(() => expect(screen.getByText(/no hay evaluadores/i)).toBeTruthy());
  });

  it('renders one row per evaluator with courses/students/reviewed counts and computed approval %', async () => {
    reportsMock.mockResolvedValue({
      data: {
        evaluatorStats: [
          { evaluatorId: 'e1', name: 'Maria Lopez', coursesManaged: 2, studentsManaged: 15, totalReviewed: 10, approved: 8, rejected: 2, avgHoursToReview: 4.5 },
        ],
      },
    });
    render(<AdminEvaluatorMetrics />);
    await waitFor(() => expect(screen.getByText('Maria Lopez')).toBeTruthy());
    expect(screen.getByText('80%')).toBeTruthy(); // 8/10 approved
    expect(screen.getByText('4.5h')).toBeTruthy();
  });

  it('shows — for evaluators with zero reviews instead of dividing by zero (NaN%)', async () => {
    reportsMock.mockResolvedValue({
      data: {
        evaluatorStats: [
          { evaluatorId: 'e2', name: 'Carlos Ruiz', coursesManaged: 1, studentsManaged: 3, totalReviewed: 0, approved: 0, rejected: 0, avgHoursToReview: null },
        ],
      },
    });
    render(<AdminEvaluatorMetrics />);
    await waitFor(() => expect(screen.getByText('Carlos Ruiz')).toBeTruthy());
    expect(screen.queryByText('NaN%')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2); // approval % and avg time
  });

  it('treats a fetch failure the same as an empty list, not a crash', async () => {
    reportsMock.mockRejectedValue(new Error('network'));
    render(<AdminEvaluatorMetrics />);
    await waitFor(() => expect(screen.getByText(/no hay evaluadores/i)).toBeTruthy());
  });
});
