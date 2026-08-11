'use client';

import { useLanguage } from '@/lib/i18n';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { Student, CourseStat } from './types';

export function CourseOverview({ students, course }: {
  students: Student[];
  course: { id: string; title: string };
}) {
  const { t } = useLanguage();
  const ts = t.studentsPage;
  const courseStats = students
    .map((s) => s.courses.find((c) => c.courseId === course.id))
    .filter(Boolean) as CourseStat[];

  if (courseStats.length === 0) return null;

  const avgProgress = Math.round(courseStats.reduce((s, c) => s + c.progressPct, 0) / courseStats.length);
  const completed = courseStats.filter((c) => c.progressPct === 100).length;
  const totalApproved = courseStats.reduce((s, c) => s + c.modulesApproved, 0);
  const totalModules = courseStats.reduce((s, c) => s + c.modules.length, 0);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-heading font-bold text-base text-charcoal">{course.title}</h3>
        <span className="text-xs text-gray-400">{ts.studentsCount(courseStats.length)}</span>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: ts.statAvgProgress, value: `${avgProgress}%`, color: 'text-cta-from' },
          { label: ts.statCompleted, value: completed, color: 'text-emerald-600' },
          { label: ts.statModulesApproved, value: totalApproved, color: 'text-purple-600' },
          { label: ts.statTotalModules, value: totalModules, color: 'text-charcoal' },
        ].map((stat) => (
          <div key={stat.label} className="text-center p-2 bg-surface rounded-xl">
            <p className={`font-bold text-xl ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-tight">{stat.label}</p>
          </div>
        ))}
      </div>
      <ProgressBar value={avgProgress} label={ts.avgProgressLabel} showPercent />
    </div>
  );
}
