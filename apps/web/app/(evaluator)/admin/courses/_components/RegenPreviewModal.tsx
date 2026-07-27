'use client';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface RegenPreviewModalProps {
  regenPreview: { courseId: string; title: string; modules: any[] } | null;
  onClose: () => void;
  onConfirm: (modules: any[]) => void;
  t: any;
}

export function RegenPreviewModal({ regenPreview, onClose, onConfirm, t }: RegenPreviewModalProps) {
  return (
    <Modal
      open={!!regenPreview}
      onClose={onClose}
      title={t.admin.regenModalTitle}
      size="md"
    >
      {regenPreview && (
        <>
          <p className="text-sm text-gray-600 mb-3">
            {t.admin.regenModalDesc(regenPreview.title)}
          </p>
          <ol className="space-y-1 mb-5 max-h-48 overflow-y-auto text-sm">
            {regenPreview.modules.map((m: any) => (
              <li key={m.order} className="flex gap-2 text-gray-700">
                <span className="font-semibold text-indigo-600 shrink-0">{m.order}.</span>
                <span>{m.title}</span>
              </li>
            ))}
          </ol>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t.admin.deleteUserCancelBtn}
            </Button>
            <Button
              onClick={() => {
                onClose();
                onConfirm(regenPreview.modules);
              }}
            >
              {t.admin.regenConfirmBtn}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
