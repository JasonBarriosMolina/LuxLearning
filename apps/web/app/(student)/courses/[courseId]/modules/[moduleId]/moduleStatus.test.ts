import { describe, it, expect } from 'vitest';
import { computeModuleStatus } from './moduleStatus';

const base = {
  reflectionStatus: null as string | null,
  blockingStep: null as 'lessons' | 'class' | 'quiz' | null,
  hasReflectionPlanned: false,
  hasInterviewPlanned: false,
  interviewDone: true,
};

// Trello DmPpbrff, 2026-09-06 (Mack): "si todavía hay pendiente una entrevista, no
// debería poder continuar al siguiente módulo... veo el botón de continuar, pero no
// me deja porque algo está en revisión."
describe('computeModuleStatus — interview gate (2026-09-06 fix)', () => {
  it('is NOT completed when an interview is planned but not yet completed, even with reflection approved', () => {
    const result = computeModuleStatus({
      ...base, reflectionStatus: 'APPROVED', hasInterviewPlanned: true, interviewDone: false,
    });
    expect(result).toEqual({ labelKey: 'statusPendingInterview', variant: 'warning' });
  });

  it('is completed when the planned interview is done and reflection is approved', () => {
    const result = computeModuleStatus({
      ...base, reflectionStatus: 'APPROVED', hasInterviewPlanned: true, interviewDone: true,
    });
    expect(result).toEqual({ labelKey: 'statusCompleted', variant: 'success' });
  });

  it('is completed on reflection-approved alone when no interview was ever planned', () => {
    const result = computeModuleStatus({ ...base, reflectionStatus: 'APPROVED', hasInterviewPlanned: false });
    expect(result).toEqual({ labelKey: 'statusCompleted', variant: 'success' });
  });
});

describe('computeModuleStatus — reflection states', () => {
  it('shows "en revisión" while a human evaluator is reviewing', () => {
    expect(computeModuleStatus({ ...base, reflectionStatus: 'PENDING_EVAL' }))
      .toEqual({ labelKey: 'statusInReview', variant: 'pending' });
  });

  it('shows "pendiente IA" while the AI check is running', () => {
    expect(computeModuleStatus({ ...base, reflectionStatus: 'PENDING_AI' }))
      .toEqual({ labelKey: 'reflectionStatusPendingAi', variant: 'info' });
  });

  it('shows "rechazada" when the reflection was rejected', () => {
    expect(computeModuleStatus({ ...base, reflectionStatus: 'REJECTED' }))
      .toEqual({ labelKey: 'reflectionStatusRejected', variant: 'error' });
  });
});

describe('computeModuleStatus — blocking step before reflection', () => {
  it.each([
    ['lessons', 'statusPendingLessons'],
    ['class', 'statusPendingClass'],
    ['quiz', 'statusPendingQuiz'],
  ] as const)('blockingStep=%s → %s, variant "default"', (blockingStep, labelKey) => {
    expect(computeModuleStatus({ ...base, blockingStep }))
      .toEqual({ labelKey, variant: 'default' });
  });

  it('shows "pendiente reflexión" once every earlier step clears and a reflection is planned', () => {
    expect(computeModuleStatus({ ...base, hasReflectionPlanned: true }))
      .toEqual({ labelKey: 'statusPendingReflection', variant: 'warning' });
  });

  it('falls through to completed when nothing is planned at all (no reflection, no interview, no blocking step)', () => {
    expect(computeModuleStatus({ ...base }))
      .toEqual({ labelKey: 'statusCompleted', variant: 'success' });
  });
});
