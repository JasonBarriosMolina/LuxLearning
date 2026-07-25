'use client';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export function ConfirmDelete({ open, onClose, onConfirm, loading, label }: {
  open: boolean; onClose: () => void; onConfirm: () => void; loading: boolean; label: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Eliminar ${label}`} size="sm">
      <p className="text-gray-600 text-sm mb-6">
        ¿Seguro que quieres eliminar este elemento? Esta acción no se puede deshacer.
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>Eliminar</Button>
      </div>
    </Modal>
  );
}
