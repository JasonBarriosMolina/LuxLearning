'use client';

import { useState } from 'react';
import { Upload, X, XCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  onClose: () => void;
  onDone: () => void;
  courses: { id: string; title: string }[];
}

export function BulkImportModal({ onClose, onDone, courses }: Props) {
  const [csv, setCsv] = useState('');
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [role, setRole] = useState<'STUDENT' | 'EVALUATOR'>('STUDENT');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    created: number; skipped: number;
    errors: { email: string; reason: string }[]; total: number;
  } | null>(null);

  const rowCount = csv.trim()
    ? csv.split(/\r?\n/).filter((l) => l.trim() && !l.toLowerCase().startsWith('email')).length
    : 0;

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csv.trim()) return;
    setLoading(true);
    try {
      const res = await api.admin.users.bulkImport({ csv, courseIds: selectedCourses, role });
      setResult(res as any);
    } catch (err: any) {
      alert(err?.body?.error ?? 'Error al importar. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCourse = (id: string) =>
    setSelectedCourses((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
              <Upload className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-charcoal text-base">Importar estudiantes por CSV</h2>
              <p className="text-xs text-gray-400">Hasta 100 usuarios por importación</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {result ? (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-emerald-50 rounded-xl p-3">
                <p className="font-bold text-2xl text-emerald-600">{result.created}</p>
                <p className="text-xs text-emerald-700 mt-0.5">Creados</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3">
                <p className="font-bold text-2xl text-amber-600">{result.skipped}</p>
                <p className="text-xs text-amber-700 mt-0.5">Ya existían</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <p className="font-bold text-2xl text-red-600">{result.errors.length}</p>
                <p className="text-xs text-red-700 mt-0.5">Errores</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500">Errores:</p>
                {result.errors.map((err, i) => (
                  <div key={i} className="flex items-center gap-2 bg-red-50 rounded-lg px-3 py-2">
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span className="text-xs text-red-700 font-medium">{err.email}</span>
                    <span className="text-xs text-red-500">— {err.reason}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => { onDone(); onClose(); }} className="btn-primary w-full">Cerrar</button>
          </div>
        ) : (
          <form onSubmit={handleImport} className="p-6 space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600">CSV — una fila por usuario</label>
              <p className="text-xs text-gray-400">
                Formato: <code className="bg-surface px-1 rounded">email,nombre</code> (nombre opcional). Puedes pegar directo desde Excel.
              </p>
              <textarea
                className="w-full h-36 text-sm border border-border rounded-xl p-3 font-mono resize-none focus:outline-none focus:border-cta-from"
                placeholder={'juan@empresa.com,Juan García\nana@empresa.com,Ana López\npedro@empresa.com'}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                required
              />
              {rowCount > 0 && (
                <p className="text-xs text-gray-400">{rowCount} fila{rowCount !== 1 ? 's' : ''} detectada{rowCount !== 1 ? 's' : ''}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600">Rol</label>
              <div className="flex gap-2">
                {(['STUDENT', 'EVALUATOR'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-all ${role === r ? 'border-cta-from bg-blue-50 text-cta-from' : 'border-border text-gray-500 hover:border-gray-300'}`}
                  >
                    {r === 'STUDENT' ? 'Estudiante' : 'Evaluador'}
                  </button>
                ))}
              </div>
            </div>

            {courses.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600">Inscribir en cursos <span className="font-normal text-gray-400">(opcional)</span></label>
                <div className="max-h-36 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                  {courses.map((c) => (
                    <label key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCourses.includes(c.id)}
                        onChange={() => toggleCourse(c.id)}
                        className="w-3.5 h-3.5 accent-cta-from"
                      />
                      <span className="text-sm text-charcoal">{c.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
              <button
                type="submit"
                disabled={loading || !csv.trim()}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {loading ? 'Importando...' : `Importar${rowCount > 0 ? ` ${rowCount}` : ''}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
