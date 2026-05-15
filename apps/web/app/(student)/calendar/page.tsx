'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { TaskCalendar } from '@/components/shared/TaskCalendar';

interface Task {
  taskId: string;
  title: string;
  dueDate: string;
  status: 'PENDING' | 'COMPLETED' | 'OVERDUE';
  type: string;
  courseId?: string;
  courseTitle?: string;
  moduleTitle?: string;
  description?: string;
}

export default function CalendarPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState('');

  useEffect(() => {
    api.tasks.list()
      .then((res: any) => {
        setTasks((res as any).data ?? []);
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);

  // Unique courses for filter
  const courses = Array.from(
    new Map(
      tasks
        .filter((t) => t.courseId && t.courseTitle)
        .map((t) => [t.courseId, t.courseTitle!])
    ).entries()
  );

  const filtered = selectedCourse
    ? tasks.filter((t) => t.courseId === selectedCourse)
    : tasks;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-cta-from" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-6 h-6 text-cta-from" />
          <div>
            <h1 className="font-heading font-bold text-2xl text-charcoal">Calendario</h1>
            <p className="text-sm text-gray-400">Todas tus tareas en vista de calendario</p>
          </div>
        </div>

        {courses.length > 1 && (
          <select
            value={selectedCourse}
            onChange={(e) => setSelectedCourse(e.target.value)}
            className="input-field text-sm py-2 max-w-[220px]"
          >
            <option value="">Todos los cursos</option>
            {courses.map(([id, title]) => (
              <option key={id} value={id}>{title}</option>
            ))}
          </select>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="card text-center py-16">
          <CalendarDays className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="font-heading font-bold text-charcoal">Sin tareas programadas</p>
          <p className="text-sm text-gray-400 mt-1">Cuando tu evaluador te asigne tareas aparecerán aquí.</p>
        </div>
      ) : (
        <div className="card">
          <TaskCalendar tasks={filtered} role="STUDENT" />
        </div>
      )}
    </div>
  );
}
