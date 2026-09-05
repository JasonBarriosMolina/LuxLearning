import { describe, it, expect } from 'vitest';
import { defaultEvalItems, SELECTABLE_EVAL_TYPES, mapCourseToStep4Modules } from './constants';

// Trello DmPpbrff, 2026-09-03 (code-review finding on the 2026-09-02 21:48 QUIZ-hiding
// commit): defaultEvalItems() still generated 'Trabajo Cotidiano'/'Contenido Teórico'
// items with type QUIZ for several course types, but the Type: pill row in
// StepEvaluacion.tsx only renders SELECTABLE_EVAL_TYPES (QUIZ excluded) — so a brand
// new course showed a default item whose type pill row had nothing selected, and
// clicking any visible pill silently converted it away from QUIZ with no way back.
describe('defaultEvalItems', () => {
  const courseTypes: Array<Parameters<typeof defaultEvalItems>[0]> = [
    'TEORICO', 'TEORICO_PRACTICO', 'PROYECTOS', 'PROGRAMA_ESPECIAL', 'CURSO_CORTO', 'LIBRE',
  ];

  it.each(courseTypes)('never produces a QUIZ-type item for course type %s', (type) => {
    const items = defaultEvalItems(type);
    expect(items.every((item) => item.type !== 'QUIZ')).toBe(true);
  });

  it.each(courseTypes)('every non-locked default item type for %s is user-selectable in the Type: pill row', (type) => {
    // Locked items (ATTENDANCE) are a separate, pre-existing case: the Type: pill row
    // isn't gated on item.locked at all, so ATTENDANCE was never in this selectable
    // scope either — out of this fix's reported bug (which was specifically about
    // QUIZ becoming an orphaned, unselectable default), not asserted here.
    const items = defaultEvalItems(type).filter((item) => !item.locked);
    for (const item of items) {
      expect(SELECTABLE_EVAL_TYPES).toContain(item.type);
    }
  });

  it('returns an empty array for an unknown course type', () => {
    expect(defaultEvalItems('NOT_A_REAL_TYPE' as any)).toEqual([]);
  });
});

// Trello DmPpbrff, 2026-09-05 (Mack): "Editar con Lux Planner" reopened a course with
// the "Módulos — Quiz, Reflexión y Entrevista" section missing entirely because nothing
// restored step4.modules from a saved course (planModules).
describe('mapCourseToStep4Modules', () => {
  it('reconstructs modules with their saved quiz/reflex/interview weeks', () => {
    const course = {
      planModules: [
        { name: 'Módulo 1', nameEN: 'Module 1', description: 'desc', weeks: [1, 2], quizWeek: 2, reflexWeek: null, interviewWeek: null },
        { name: 'Módulo 2', weeks: [3], quizWeek: null, reflexWeek: 3, interviewWeek: 3 },
      ],
    };
    expect(mapCourseToStep4Modules(course)).toEqual([
      { name: 'Módulo 1', nameEN: 'Module 1', description: 'desc', descriptionEN: 'desc', weeks: [1, 2], quizWeek: 2, reflexWeek: null, interviewWeek: null },
      { name: 'Módulo 2', nameEN: 'Módulo 2', description: '', descriptionEN: '', weeks: [3], quizWeek: null, reflexWeek: 3, interviewWeek: 3 },
    ]);
  });

  it('returns an empty array when the course never had modules saved (older courses, pre-fix)', () => {
    expect(mapCourseToStep4Modules({})).toEqual([]);
    expect(mapCourseToStep4Modules({ planModules: null })).toEqual([]);
  });
});
