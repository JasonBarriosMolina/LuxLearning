'use client';

import { useEffect, useState } from 'react';
import { Users, CheckCircle, Clock, XCircle, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { ReflectionStatusBadge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { formatDate } from '@/lib/utils';
import type { Reflection } from '@lux/types';

type StudentData = {
  userId: string;
  reflections: (Reflection & { moduleTitle?: string })[];
  approved: number;
  pending: number;
  rejected: number;
};

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.evaluator.reflections().then((res) => {
      const all: any[] = (res as any).data ?? [];

      // Group by userId
      const byUser: Record<string, StudentData> = {};
      all.forEach((r: any) => {
        if (!byUser[r.userId]) {
          byUser[r.userId] = { userId: r.userId, reflections: [], approved: 0, pending: 0, rejected: 0 };
        }
        byUser[r.userId].reflections.push(r);
        if (r.status === 'APPROVED') byUser[r.userId].approved++;
        if (r.status === 'PENDING_EVAL') byUser[r.userId].pending++;
        if (r.status === 'REJECTED') byUser[r.userId].rejected++;
      });

      setStudents(Object.values(byUser).sort((a, b) => b.pending - a.pending));
      setLoading(false);
    });
  }, []);

  const filtered = students.filter((s) =>
    search === '' || s.userId.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-heading font-bold text-2xl text-charcoal">Estudiantes</h1>
        <p className="text-gray-500 mt-1 text-sm">Vista general del progreso de los estudiantes</p>
      </div>

      <Input
        placeholder="Buscar estudiante..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        leftIcon={<Search className="w-4 h-4" />}
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="card h-28 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">Sin estudiantes</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((student) => (
            <div key={student.userId} className="card space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {student.userId[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-charcoal text-sm">{student.userId}</p>
                    <p className="text-xs text-gray-500">{student.reflections.length} reflexiones enviadas</p>
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <p className="font-bold text-emerald-600 text-lg">{student.approved}</p>
                    <p className="text-xs text-gray-400">Aprobadas</p>
                  </div>
                  <div>
                    <p className="font-bold text-amber-500 text-lg">{student.pending}</p>
                    <p className="text-xs text-gray-400">Pendientes</p>
                  </div>
                  <div>
                    <p className="font-bold text-red-500 text-lg">{student.rejected}</p>
                    <p className="text-xs text-gray-400">Rechazadas</p>
                  </div>
                </div>
              </div>

              {/* Latest reflections */}
              <div className="space-y-1.5">
                {student.reflections.slice(0, 3).map((r) => (
                  <div key={r.moduleId} className="flex items-center justify-between text-xs p-2.5 bg-surface rounded-lg">
                    <span className="text-gray-600 truncate flex-1">{r.moduleTitle ?? r.moduleId}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-gray-400">{formatDate(r.submittedAt)}</span>
                      <ReflectionStatusBadge status={r.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
