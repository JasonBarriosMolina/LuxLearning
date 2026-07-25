'use client';

import { Plus, X } from 'lucide-react';

export function OptionsList({ options, correctIndex, onOptionsChange, onCorrectChange, questionId }: {
  options: string[]; correctIndex: number;
  onOptionsChange: (opts: string[]) => void;
  onCorrectChange: (i: number) => void;
  questionId: string; // unique name for radio group
}) {
  const update = (i: number, val: string) => {
    const next = [...options]; next[i] = val; onOptionsChange(next);
  };
  const add = () => onOptionsChange([...options, '']);
  const remove = (i: number) => {
    if (options.length <= 2) return;
    const next = options.filter((_, idx) => idx !== i);
    onOptionsChange(next);
    // Adjust correctIndex if needed
    if (correctIndex >= next.length) onCorrectChange(next.length - 1);
    else if (correctIndex > i) onCorrectChange(correctIndex - 1);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-charcoal">
        Opciones <span className="text-gray-400 font-normal">(selecciona la correcta)</span>
      </label>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="radio"
            name={questionId}
            checked={correctIndex === i}
            onChange={() => onCorrectChange(i)}
            className="accent-cta-from shrink-0"
          />
          <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{String.fromCharCode(65 + i)}.</span>
          <input
            value={opt}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Opción ${String.fromCharCode(65 + i)}`}
            className="input-field flex-1 text-sm py-2"
            required
          />
          {options.length > 2 && (
            <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs font-semibold text-cta-from hover:opacity-80 transition-opacity mt-1"
      >
        <Plus className="w-3.5 h-3.5" /> Agregar opción
      </button>
      <p className="text-xs text-gray-400">El radio marcado es la respuesta correcta. Mínimo 2 opciones.</p>
    </div>
  );
}
