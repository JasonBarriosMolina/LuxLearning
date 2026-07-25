// ─── translations.ts (assembly hub) ───────────────────────────────────────────
// Imports domain slices from sections/ and re-assembles the canonical
// `es` and `en` objects.  All consumers continue to import from this file —
// zero changes required in any component.
// ─────────────────────────────────────────────────────────────────────────────

export type Lang = 'es' | 'en';

import { navEs, navEn } from './sections/nav';
import { reflectionEs, reflectionEn } from './sections/reflection';
import { evaluatorEs, evaluatorEn } from './sections/evaluator';
import { adminEs, adminEn } from './sections/admin';
import { studentEs, studentEn } from './sections/student';
import { courseEs, courseEn } from './sections/course';

export const es = {
  ...navEs,
  ...reflectionEs,
  ...evaluatorEs,
  ...adminEs,
  ...studentEs,
  ...courseEs,
};

export const en = {
  ...navEn,
  ...reflectionEn,
  ...evaluatorEn,
  ...adminEn,
  ...studentEn,
  ...courseEn,
};

export type Translations = typeof es;
