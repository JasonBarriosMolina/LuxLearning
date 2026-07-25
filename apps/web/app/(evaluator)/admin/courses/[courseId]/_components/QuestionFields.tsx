'use client';

import { Input } from '@/components/ui/Input';
import { OptionsList } from './OptionsList';
import type { QuestionForm } from './types';

export function QuestionFields({ form, setForm, uid }: { form: QuestionForm; setForm: (f: QuestionForm) => void; uid: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium text-charcoal">Pregunta</label>
        <textarea
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          placeholder="¿Cuál de las siguientes afirmaciones es correcta?"
          className="input-field resize-none min-h-[80px]"
          required
        />
      </div>
      <OptionsList
        options={form.options}
        correctIndex={form.correctIndex}
        onOptionsChange={(opts) => setForm({ ...form, options: opts })}
        onCorrectChange={(i) => setForm({ ...form, correctIndex: i })}
        questionId={uid}
      />
      <Input label="Orden" type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} required />
    </div>
  );
}
