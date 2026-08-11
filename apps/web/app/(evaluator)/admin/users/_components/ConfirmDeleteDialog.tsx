'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface Strings {
  title: string;
  subtitle: string;
  msg: (email: string) => string;
  confirmBtn: string;
  cancelBtn: string;
}

interface Props {
  email: string;
  onConfirm: () => void;
  onCancel: () => void;
  strings?: Strings;
}

export function ConfirmDeleteDialog({ email, onConfirm, onCancel, strings }: Props) {
  const s = strings ?? {
    title: 'Eliminar usuario',
    subtitle: 'Esta acción no se puede deshacer',
    msg: (e: string) => `¿Estás seguro de que deseas eliminar a ${e}? El usuario perderá acceso inmediatamente.`,
    confirmBtn: 'Eliminar',
    cancelBtn: 'Cancelar',
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-charcoal text-sm">{s.title}</h3>
            <p className="text-xs text-gray-400">{s.subtitle}</p>
          </div>
        </div>
        <p
          className="text-sm text-gray-600"
          dangerouslySetInnerHTML={{ __html: s.msg(email).replace(email, `<strong class="text-charcoal">${email}</strong>`) }}
        />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel} className="flex-1" size="sm">{s.cancelBtn}</Button>
          <Button variant="danger" onClick={onConfirm} className="flex-1" size="sm">{s.confirmBtn}</Button>
        </div>
      </div>
    </div>
  );
}
