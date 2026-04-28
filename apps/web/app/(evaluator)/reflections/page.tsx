'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Search, ArrowRight, Filter } from 'lucide-react';
import { api } from '@/lib/api';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { formatDate } from '@/lib/utils';
import type { Reflection, ReflectionStatus } from '@lux/types';

type EnrichedReflection = Reflection & { moduleTitle?: string; courseTitle?: string };

const STATUS_FILTERS: Array<{ label: string; value: ReflectionStatus | 'ALL' }> = [
  { label: 'Todas', value: 'ALL' },
  { label: 'Pendientes', value: 'PENDING_EVAL' },
  { label: 'Aprobadas', value: 'APPROVED' },
  { label: 'Rechazadas', value: 'REJECTED' },
];

export default function EvaluatorReflectionsPage() {
  const [reflections, setReflections] = useState<EnrichedReflection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReflectionStatus | 'ALL'>('ALL');

  useEffect(() => {
    api.evaluator.reflections().then((res) => {
      setReflections((res as any).data ?? []);
      setLoading(false);
    });
  }, []);

  const filtered = reflections.filter((r) => {
    const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const matchesSearch = search === '' ||
      r.userId.toLowerCase().includes(search.toLowerCase()) ||
      (r.moduleTitle?.toLowerCase().includes(search.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">Reflexiones</h1>
        <p className="text-gray-500 mt-1 text-sm">Revisa y evalúa las reflexiones de los estudiantes</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Buscar por estudiante o módulo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                statusFilter === f.value
                  ? 'bg-cta-gradient text-white'
                  : 'bg-white border border-border text-gray-600 hover:border-cta-from'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((n) => <div key={n} className="card h-20 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">Sin reflexiones</p>
          <p className="text-gray-500 text-sm mt-1">Prueba ajustando los filtros.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Link
              key={`${r.userId}-${r.moduleId}`}
              href={`/evaluator/reflections/${encodeURIComponent(r.userId)}?moduleId=${r.moduleId}`}
              className="card-hover flex items-center gap-4 p-4"
            >
              <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center shrink-0 text-sm font-bold text-gray-400">
                {r.userId[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-medium text-charcoal text-sm">
                    {r.moduleTitle ?? 'Módulo'}
                  </p>
                  <ReflectionStatusBadge status={r.status} />
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {r.userId} • {r.wordCount} palabras • {formatDate(r.submittedAt)}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
