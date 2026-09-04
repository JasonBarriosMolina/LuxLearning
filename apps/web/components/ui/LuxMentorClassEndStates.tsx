'use client';

import { CheckCircle, Volume2, AlertCircle, WifiOff } from 'lucide-react';

// Extracted from LuxMentorClass.tsx (code review, 2026-09-04) to keep that file
// under the 400-line page-component limit — the 'closing'/'ended'/'error' phases'
// renders. Grouped in one file since each is small and self-contained (no shared
// state between them beyond what's already passed in as props).

interface ClosingProps {
  closingAudioUrl: string;
  audioRef: React.RefObject<HTMLAudioElement>;
  onEnded: () => void;
  s: (es: string, en: string) => string;
}

export function LuxMentorClassClosing({ closingAudioUrl, audioRef, onEnded, s }: ClosingProps) {
  return (
    <div className="border border-border rounded-xl p-6 text-center space-y-4">
      <audio
        ref={audioRef}
        src={closingAudioUrl}
        autoPlay
        onEnded={onEnded}
        // Found in code review (2026-09-01): same stuck-forever risk as the narration
        // audio above — a failed closing clip must still let the student finish.
        onError={onEnded}
      />
      <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto">
        <Volume2 className="w-7 h-7 text-blue-600" />
      </div>
      <div>
        <p className="font-semibold text-charcoal">{s('Cerrando la clase…', 'Wrapping up the class…')}</p>
        <p className="text-sm text-gray-500 mt-1">{s('Lux Mentor está resumiendo lo visto en el módulo.', 'Lux Mentor is recapping what the module covered.')}</p>
      </div>
    </div>
  );
}

interface EndedProps {
  onContinue: () => void;
  s: (es: string, en: string) => string;
}

export function LuxMentorClassEnded({ onContinue, s }: EndedProps) {
  return (
    <div className="border border-border rounded-xl p-6 text-center space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto">
        <CheckCircle className="w-7 h-7 text-emerald-600" />
      </div>
      <div>
        <p className="font-semibold text-charcoal">{s('¡Clase completada!', 'Class completed!')}</p>
        <p className="text-sm text-gray-500 mt-1">{s('Tu evaluador revisará tu sesión pronto.', 'Your evaluator will review your session soon.')}</p>
      </div>
      <button onClick={onContinue} className="btn-primary inline-flex items-center gap-2 mx-auto">
        {s('Continuar', 'Continue')}
      </button>
    </div>
  );
}

interface ErrorProps {
  error: string;
  voidedOnly: boolean;
  onClose: () => void;
  s: (es: string, en: string) => string;
}

export function LuxMentorClassError({ error, voidedOnly, onClose, s }: ErrorProps) {
  return (
    <div className="border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-charcoal">{s('Error en la clase', 'Class error')}</p>
          <p className="text-xs text-gray-500 mt-0.5">{error}</p>
        </div>
        <button onClick={onClose} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          {s('Cerrar', 'Close')}
        </button>
      </div>
      {voidedOnly && (
        <div className="flex items-start gap-2 bg-amber-50 rounded-lg p-3">
          <WifiOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">{s('Detectamos un fallo de red anterior. Puedes reintentar.', 'We detected a previous network failure. You can retry.')}</p>
        </div>
      )}
    </div>
  );
}
