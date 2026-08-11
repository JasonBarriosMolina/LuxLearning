'use client';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface DeleteCourseModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
  t: any;
}

export function DeleteCourseModal({ open, onClose, onConfirm, deleting, t }: DeleteCourseModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.admin.deleteCourseModalTitle}
      size="sm"
    >
      <p className="text-gray-600 text-sm mb-6">
        {t.admin.deleteCourseModalMsg}
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t.admin.deleteUserCancelBtn}
        </Button>
        <Button
          variant="danger"
          loading={deleting}
          onClick={onConfirm}
        >
          {t.admin.deleteUserConfirmBtn}
        </Button>
      </div>
    </Modal>
  );
}
