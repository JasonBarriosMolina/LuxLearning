'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { ConfirmDelete } from './ConfirmDelete';
import { QuestionFields } from './QuestionFields';
import type { QuestionForm } from './types';

export function QuestionRow({ question, onRefresh }: { question: any; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<QuestionForm>({
    text: question.text, options: [...question.options],
    correctIndex: question.correctIndex, order: question.order,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try { await api.admin.questions.update(question.id, form); setEditing(false); onRefresh(); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.admin.questions.delete(question.id); onRefresh(); }
    finally { setDeleting(false); setConfirmDel(false); }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-3 p-3 bg-surface rounded-xl border border-border">
        <span className="text-xs font-bold text-gray-400 mt-0.5 w-5 shrink-0">{question.order}.</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-charcoal mb-1">{question.text}</p>
          <div className="space-y-0.5">
            {question.options.map((opt: string, i: number) => (
              <span key={i} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${i === question.correctIndex ? 'bg-emerald-100 text-emerald-700 font-semibold' : 'text-gray-500'}`}>
                <span className="font-bold">{String.fromCharCode(65 + i)}.</span> {opt}
                {i === question.correctIndex && <span className="ml-1 text-emerald-600">✓</span>}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">{question.options.length} opciones • Selección única</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-charcoal hover:bg-white transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => setConfirmDel(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <ConfirmDelete open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDelete} loading={deleting} label="pregunta" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-4 bg-white rounded-xl border-2 border-cta-from space-y-4">
      <QuestionFields form={form} setForm={setForm} uid={`edit-${question.id}`} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
        <Button type="submit" size="sm" loading={saving}>Guardar</Button>
      </div>
    </form>
  );
}
