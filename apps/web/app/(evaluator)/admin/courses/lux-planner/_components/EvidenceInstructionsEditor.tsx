'use client';

// ─── EvidenceInstructionsEditor.tsx ───────────────────────────────────────────
// Extracted from StepEvaluacion.tsx (over the 400-line component limit). Renders
// the EVIDENCE-type delivery-instructions editor: one shared box when count===1
// (unchanged), one box PER due-date instance when count > 1 — Trello DmPpbrff,
// 2026-09-01 14:30 (Mack): "si yo selecciono más de una, entonces... se creen
// cuadros de texto... para cada una de esas tareas."
import { Loader2, Sparkles } from 'lucide-react';
import { EvalItem } from './constants';

interface Props {
  item: EvalItem;
  evalName: string; // already language-picked (nameEN or name)
  s: (es: string, en: string) => string;
  genInstrId: string | null;
  onGenerate: (itemId: string, evalName: string, idx?: number, dueDateStr?: string, evalType?: EvalItem['type']) => void;
  updateItem: (id: string, patch: Partial<EvalItem>) => void;
  updateInstructionAt: (id: string, idx: number, val: string) => void;
}

export function EvidenceInstructionsEditor({ item, evalName, s, genInstrId, onGenerate, updateItem, updateInstructionAt }: Props) {
  if (item.count <= 1) {
    return (
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-400 hover:text-charcoal">{s('Instrucciones (opcional)', 'Instructions (optional)')}</summary>
        <div className="mt-2 space-y-1.5">
          <textarea value={item.instructions} onChange={(e) => updateItem(item.id, { instructions: e.target.value })} className="input-field w-full min-h-[60px] text-xs resize-y" />
          <button
            type="button"
            onClick={() => onGenerate(item.id, evalName, undefined, item.dueDates?.[0], item.type)}
            disabled={genInstrId === item.id}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 hover:text-purple-800 disabled:opacity-50 transition-colors"
          >
            {genInstrId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {s('Generar instrucción con Lux Planner', 'Generate instruction with Lux Planner')}
          </button>
        </div>
      </details>
    );
  }

  return (
    <details className="text-xs" open>
      <summary className="cursor-pointer text-gray-400 hover:text-charcoal">{s('Instrucciones por entrega', 'Instructions per deliverable')}</summary>
      <div className="mt-2 space-y-2.5">
        {Array.from({ length: item.count }).map((_, idx) => {
          const genKey = `${item.id}#${idx}`;
          return (
            <div key={idx} className="space-y-1">
              <p className="text-[10px] text-gray-400">{s(`Entrega ${idx + 1}`, `Deliverable ${idx + 1}`)}</p>
              <textarea
                value={item.instructionsByIndex?.[idx] ?? ''}
                onChange={(e) => updateInstructionAt(item.id, idx, e.target.value)}
                className="input-field w-full min-h-[50px] text-xs resize-y"
              />
              <button
                type="button"
                onClick={() => onGenerate(item.id, `${evalName} ${idx + 1}`, idx, item.dueDates?.[idx], item.type)}
                disabled={genInstrId === genKey}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 hover:text-purple-800 disabled:opacity-50 transition-colors"
              >
                {genInstrId === genKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {s('Generar instrucción con Lux Planner', 'Generate instruction with Lux Planner')}
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
