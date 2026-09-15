import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeekCalendarGrid } from './WeekCalendarGrid';
import type { ScheduledSession } from './types';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "es importantísimo que exista un
// apoyo visual... que se vea visualmente como un calendario, pero de una
// única semana... con tags de colores por los evaluadores... y en un
// dropdown yo pueda ver los estudiantes matriculados."

const sessions: ScheduledSession[] = [
  { courseId: 'c1', evaluatorId: 'e1', dayOfWeek: 6, startTime: '08:00', endTime: '09:15', modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: ['s1', 's2'] },
  { courseId: 'c2', evaluatorId: 'e2', dayOfWeek: 2, startTime: '18:00', endTime: '18:55', modality: 'VIRTUAL', classType: 'INDIVIDUAL', studentIds: [] },
];
const courseTitles = { c1: 'Curso Sábado', c2: 'Curso Martes' };
const teacherNames = { e1: 'Profe Uno', e2: 'Profe Dos' };
const studentNames = { s1: 'Ana Pérez', s2: 'Beto Gómez' };

describe('WeekCalendarGrid', () => {
  it('renderiza un bloque por sesión con curso y profesor', () => {
    render(<WeekCalendarGrid sessions={sessions} courseTitles={courseTitles} teacherNames={teacherNames} studentNames={studentNames} />);
    expect(screen.getByText('Curso Sábado')).toBeTruthy();
    expect(screen.getByText('Curso Martes')).toBeTruthy();
    expect(screen.getByText('Profe Uno')).toBeTruthy();
    expect(screen.getByText('Profe Dos')).toBeTruthy();
  });

  it('al hacer click en un bloque muestra los estudiantes matriculados por nombre', () => {
    render(<WeekCalendarGrid sessions={sessions} courseTitles={courseTitles} teacherNames={teacherNames} studentNames={studentNames} />);
    fireEvent.click(screen.getByText('Curso Sábado'));
    expect(screen.getByText('Ana Pérez')).toBeTruthy();
    expect(screen.getByText('Beto Gómez')).toBeTruthy();
  });

  it('no renderiza nada cuando no hay sesiones', () => {
    const { container } = render(<WeekCalendarGrid sessions={[]} courseTitles={{}} teacherNames={{}} />);
    expect(container.firstChild).toBeNull();
  });

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "no puedo ver los minutos en
  // cómo se ve eso en el calendario semanal."
  it('muestra la hora de inicio y fin dentro del bloque', () => {
    render(<WeekCalendarGrid sessions={sessions} courseTitles={courseTitles} teacherNames={teacherNames} studentNames={studentNames} />);
    expect(screen.getByText('08:00–09:15')).toBeTruthy();
    expect(screen.getByText('18:00–18:55')).toBeTruthy();
  });

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15): "sería bueno que ocupe todo el
  // espacio de ese día" — una clase sola a las 8am no debe achicarse solo
  // porque a otra hora del mismo día hay 2 clases simultáneas.
  it('un bloque sin solape usa el 100% del ancho del día aunque otra hora del mismo día tenga choque', () => {
    const mixed: ScheduledSession[] = [
      { courseId: 'solo', evaluatorId: 'e1', dayOfWeek: 6, startTime: '08:00', endTime: '09:00', modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: [] },
      { courseId: 'a', evaluatorId: 'e2', dayOfWeek: 6, startTime: '10:00', endTime: '11:00', modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: [] },
      { courseId: 'b', evaluatorId: 'e3', dayOfWeek: 6, startTime: '10:00', endTime: '11:00', modality: 'PRESENCIAL', classType: 'GRUPAL', studentIds: [] },
    ];
    render(<WeekCalendarGrid sessions={mixed} courseTitles={{ solo: 'Solo', a: 'A', b: 'B' }} teacherNames={{ e1: 'X', e2: 'Y', e3: 'Z' }} />);
    const soloBlock = screen.getByText('Solo').closest('button') as HTMLButtonElement;
    expect(soloBlock.style.width).toBe('100%');
  });
});
