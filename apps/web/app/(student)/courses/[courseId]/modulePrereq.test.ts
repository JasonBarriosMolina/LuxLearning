import { describe, it, expect } from 'vitest';
import { getModulePrereq } from './modulePrereq';

describe('getModulePrereq — dashboard evaluation-plan gate logic', () => {
  it('blocks on lessons when lessons are incomplete', () => {
    const modules = [{ id: 'm1', lessons: [{ completed: true }, { completed: false }] }];
    const events = [{ moduleId: 'm1', type: 'QUIZ' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.blockingStep).toBe('lessons');
    expect(result.quizReady).toBe(false);
  });

  it('blocks on class when lessons are done but the planned class is not', () => {
    const modules = [{ id: 'm1', lessons: [{ completed: true }], classCompleted: false }];
    const events = [{ moduleId: 'm1', type: 'CLASS' }, { moduleId: 'm1', type: 'QUIZ' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.blockingStep).toBe('class');
    expect(result.quizReady).toBe(false);
  });

  it('is quiz-ready once lessons + class are done, even if quiz not yet passed', () => {
    const modules = [{ id: 'm1', lessons: [{ completed: true }], classCompleted: true, quizPassed: false }];
    const events = [{ moduleId: 'm1', type: 'CLASS' }, { moduleId: 'm1', type: 'QUIZ' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.blockingStep).toBe('quiz');
    expect(result.quizReady).toBe(true);
  });

  it('skips the class gate entirely when no class was planned for the module', () => {
    const modules = [{ id: 'm1', lessons: [{ completed: true }] }];
    const events = [{ moduleId: 'm1', type: 'QUIZ' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.blockingStep).toBe('quiz');
    expect(result.quizReady).toBe(true);
  });

  it('is interview-ready once reflection is approved, when a reflection was planned', () => {
    const modules = [{ id: 'm1', lessons: [{ completed: true }], reflectionStatus: 'APPROVED' }];
    const events = [{ moduleId: 'm1', type: 'REFLECTION' }, { moduleId: 'm1', type: 'INTERVIEW' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.interviewReady).toBe(true);
  });

  it('is not interview-ready while the planned reflection is still pending', () => {
    const modules = [{ id: 'm1', lessons: [{ completed: true }], reflectionStatus: 'PENDING_EVAL' }];
    const events = [{ moduleId: 'm1', type: 'REFLECTION' }, { moduleId: 'm1', type: 'INTERVIEW' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.interviewReady).toBe(false);
  });

  it('falls back to quizReady for interview readiness when no reflection was planned', () => {
    const modules = [{ id: 'm1', lessons: [{ completed: true }], classCompleted: true, quizPassed: true }];
    const events = [{ moduleId: 'm1', type: 'CLASS' }, { moduleId: 'm1', type: 'QUIZ' }, { moduleId: 'm1', type: 'INTERVIEW' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.blockingStep).toBeNull();
    expect(result.interviewReady).toBe(true);
  });

  it('blocks with lessons as the default when the module is not found', () => {
    const result = getModulePrereq('missing', [], []);
    expect(result.blockingStep).toBe('lessons');
    expect(result.quizReady).toBe(false);
    expect(result.interviewReady).toBe(false);
  });

  it('treats a module with zero lessons as not done (allLessonsDone requires length > 0)', () => {
    const modules = [{ id: 'm1', lessons: [] }];
    const events = [{ moduleId: 'm1', type: 'QUIZ' }];
    const result = getModulePrereq('m1', modules, events);
    expect(result.blockingStep).toBe('lessons');
  });
});
