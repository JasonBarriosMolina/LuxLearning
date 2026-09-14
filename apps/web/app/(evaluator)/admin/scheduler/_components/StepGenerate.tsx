'use client';

import { Loader2, AlertTriangle, Sparkles } from 'lucide-react';

interface Props {
  generating: boolean;
  error: string;
  onRetry: () => void;
}

export function StepGenerate({ generating, error, onRetry }: Props) {
  if (error) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 gap-3 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400" />
        <p className="text-sm text-red-600 max-w-sm">{error}</p>
        <button onClick={onRetry} className="text-sm text-cta-from hover:underline">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="card flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="relative">
        <Sparkles className="w-10 h-10 text-cta-from" />
        {generating && <Loader2 className="w-14 h-14 text-cta-from/30 animate-spin absolute -top-2 -left-2" />}
      </div>
      <div>
        <p className="font-heading font-semibold text-charcoal">Armando el rompecabezas…</p>
        <p className="text-xs text-gray-500 mt-1 max-w-sm">
          Procesando disponibilidad docente, tope de carga, requerimientos de estudiantes,
          regla de días por modalidad y protección del almuerzo sabatino.
        </p>
      </div>
    </div>
  );
}
