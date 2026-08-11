'use client';

import { AlertTriangle, CheckCircle, Clock, XCircle, Lock, BookOpen } from 'lucide-react';
import type { ModuleStat } from './types';

export function RiskBadge({ level }: { level: 'critical' | 'high' | 'medium' | 'low' }) {
  if (level === 'low') return null;
  const cfg = {
    critical: { label: 'Riesgo crítico', cls: 'bg-red-100 text-red-700 border-red-200' },
    high:     { label: 'En riesgo',      cls: 'bg-orange-100 text-orange-700 border-orange-200' },
    medium:   { label: 'Atención',       cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  }[level];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <AlertTriangle className="w-3 h-3" />{cfg.label}
    </span>
  );
}

export function PresenceBadge({ status }: { status?: string }) {
  if (status === 'online') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />En línea
    </span>
  );
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Activo
    </span>
  );
  if (status === 'never_active') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Sin actividad
    </span>
  );
  if (status === 'disabled') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />Desactivado
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />Inactivo
    </span>
  );
}

export function ModuleStatusIcon({ mod }: { mod: ModuleStat }) {
  if (mod.reflectionStatus === 'APPROVED') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (mod.reflectionStatus === 'PENDING_EVAL') return <Clock className="w-4 h-4 text-amber-500" />;
  if (mod.reflectionStatus === 'REJECTED') return <XCircle className="w-4 h-4 text-red-400" />;
  if (mod.completedLessons === 0) return <Lock className="w-4 h-4 text-gray-300" />;
  return <BookOpen className="w-4 h-4 text-cta-from" />;
}
