'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Users, Clock, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type { Reflection } from '@lux/types';

type EnrichedReflection = Reflection & { moduleTitle?: string; courseTitle?: string };

export default function EvaluatorDashboardPage() {
  const { email } = useAuth();
  const [reflections, setReflections] = useState<EnrichedReflection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.evaluator.reflections().then((res) => {
      setReflections((res as any).data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const firstName = email?.split('@')[0] ?? 'Evaluador';
  const pending = reflections.filter((r) => r.status === 'PENDING_EVAL');
  const recent = reflections.slice(0, 5);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
      {/* Welcome */}
      <div>
        <h1 className="font-heading font-bold text-2xl lg:text-3xl text-charcoal">
          Panel del Evaluador
        </h1>
        <p className="text-gray-500 mt-1">Hola, {firstName}. Aquí están las reflexiones pendientes de revisión.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Pendientes de revisión',
            value: pending.length,
            icon: <Clock className="w-5 h-5 text-amber-500" />,
            bg: 'bg-amber-50',
            urgent: pending.length > 0,
          },
          {
            label: 'Total recibidas',
            value: reflections.length,
            icon: <ClipboardList className="w-5 h-5 text-cta-from" />,
            bg: 'bg-blue-50',
          },
          {
            label: 'Aprobadas',
            value: reflections.filter((r) => r.status === 'APPROVED').length,
            icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
            bg: 'bg-emerald-50',
          },
          {
            label: 'Rechazadas',
            value: reflections.filter((r) => r.status === 'REJECTED').length,
            icon: <XCircle className="w-5 h-5 text-red-500" />,
            bg: 'bg-red-50',
          },
        ].map((stat) => (
          <div key={stat.label} className={`card ${stat.urgent ? 'border-2 border-amber-400' : ''}`}>
            <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
              {stat.icon}
            </div>
            <p className="font-heading font-bold text-2xl text-charcoal">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Pending reflections */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold text-xl text-charcoal">Reflexiones pendientes</h2>
          <Link href="/evaluator/reflections" className="text-sm text-cta-from font-semibold flex items-center gap-1 hover:opacity-80">
            Ver todas <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <div key={n} className="card h-20 animate-pulse" />)}
          </div>
        ) : pending.length === 0 ? (
          <div className="card text-center py-12">
            <CheckCircle className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
            <p className="font-heading font-bold text-charcoal">Sin reflexiones pendientes</p>
            <p className="text-gray-500 text-sm mt-1">Todas las reflexiones han sido revisadas.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <Link
                key={`${r.userId}-${r.moduleId}`}
                href={`/evaluator/reflections/${encodeURIComponent(r.userId)}?moduleId=${r.moduleId}`}
                className="card-hover flex items-center gap-4 p-4"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-charcoal text-sm truncate">
                      {r.moduleTitle ?? r.moduleId}
                    </p>
                    <ReflectionStatusBadge status={r.status} />
                  </div>
                  <p className="text-xs text-gray-500">
                    {r.userId} • {r.wordCount} palabras • {formatDate(r.submittedAt)}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
