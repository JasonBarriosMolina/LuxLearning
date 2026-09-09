// ─── admin-dashboard.ts ───────────────────────────────────────────────────────
// Domain: /evaluator/dashboard, ADMIN-role-only additions (title + evaluator
// metrics panel). New file rather than growing evaluator.ts, already at its
// 500-line limit — Trello DmPpbrff, 2026-09-07 (Mack): "el dashboard...
// debería decir 'dashboard del administrador'... [con] métricas... de los
// evaluadores."
// ─────────────────────────────────────────────────────────────────────────────

export const adminDashboardEs = {
  adminDashboard: {
    title: 'Panel del Administrador',
    evaluatorMetricsTitle: 'Evaluadores',
    colEvaluator: 'Evaluador',
    colCourses: 'Cursos',
    colStudents: 'Estudiantes',
    colReviewed: 'Revisadas',
    colApprovalRate: '% Aprobación',
    colAvgTime: 'Tiempo prom.',
    noEvaluators: 'Todavía no hay evaluadores asignados a cursos.',
    hoursShort: (n: number) => `${n}h`,
    noData: '—',
  },
};

export const adminDashboardEn = {
  adminDashboard: {
    title: 'Administrator Dashboard',
    evaluatorMetricsTitle: 'Evaluators',
    colEvaluator: 'Evaluator',
    colCourses: 'Courses',
    colStudents: 'Students',
    colReviewed: 'Reviewed',
    colApprovalRate: 'Approval %',
    colAvgTime: 'Avg. time',
    noEvaluators: 'No evaluators assigned to courses yet.',
    hoursShort: (n: number) => `${n}h`,
    noData: '—',
  },
};
