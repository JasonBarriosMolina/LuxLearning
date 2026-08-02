'use client';

import { useState } from 'react';
import { X, Loader2, ListTodo, Lock, Unlock } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  student: { userId: string; studentName?: string };
  onClose: () => void;
  onSuccess: () => void;
}

export function StudyPlanModal({ student, onClose, onSuccess }: Props) {
  const [generating, setGenerating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      await api.evaluator.studyPlan.generate(student.userId, {});
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (e: any) {
      setError(e?.body?.error ?? 'Error al generar el plan');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-purple-600" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Generar Plan de Estudio</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Se generará un plan semanal automático basado en el progreso actual de{' '}
          <strong>{student.studentName ?? 'este estudiante'}</strong>.
          El plan quedará <strong>bloqueado</strong> — el estudiante podrá verlo pero no editarlo sin solicitar cambios.
        </p>

        <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 rounded-lg px-3 py-2 mb-5">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          El estudiante recibirá una notificación y podrá solicitar cambios.
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
        )}

        {success ? (
          <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
            <Unlock className="w-4 h-4" /> Plan generado correctamente
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 dark:border-white/10 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10">
              Cancelar
            </button>
            <button onClick={generate} disabled={generating}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-[#7B2FBE] to-[#00B4D8] text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              {generating && <Loader2 className="w-4 h-4 animate-spin" />}
              Generar plan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
