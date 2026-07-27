'use client';

import { Shield, ClipboardCheck, GraduationCap } from 'lucide-react';

export type UserRole = 'ADMIN' | 'EVALUATOR' | 'STUDENT';

interface Props {
  role: UserRole;
  labels?: Record<UserRole, string>;
}

export function RoleBadge({ role, labels }: Props) {
  const defaultLabels: Record<UserRole, string> = { ADMIN: 'Admin', EVALUATOR: 'Evaluador', STUDENT: 'Estudiante' };
  const l = labels ?? defaultLabels;
  const map: Record<UserRole, { label: string; className: string; icon: React.ReactNode }> = {
    ADMIN:     { label: l.ADMIN,     className: 'bg-purple-100 text-purple-700',   icon: <Shield className="w-3 h-3" /> },
    EVALUATOR: { label: l.EVALUATOR, className: 'bg-blue-100 text-blue-700',       icon: <ClipboardCheck className="w-3 h-3" /> },
    STUDENT:   { label: l.STUDENT,   className: 'bg-emerald-100 text-emerald-700', icon: <GraduationCap className="w-3 h-3" /> },
  };
  const { label, className, icon } = map[role];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {icon}{label}
    </span>
  );
}
