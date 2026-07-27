'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface Evaluator {
  sub: string;
  email: string;
  name: string;
  username: string;
}

interface AssignEvaluatorModalProps {
  evalModal: { courseId: string; courseName: string } | null;
  evaluators: Evaluator[];
  selectedEval: string;
  setSelectedEval: React.Dispatch<React.SetStateAction<string>>;
  evalLoading: boolean;
  evalSaving: boolean;
  evalError: string;
  onClose: () => void;
  onAssign: () => void;
  t: any;
}

export function AssignEvaluatorModal({
  evalModal,
  evaluators,
  selectedEval,
  setSelectedEval,
  evalLoading,
  evalSaving,
  evalError,
  onClose,
  onAssign,
  t,
}: AssignEvaluatorModalProps) {
  return (
    <Modal
      open={!!evalModal}
      onClose={onClose}
      title={t.admin.assignEvalModalTitle(evalModal?.courseName ?? '')}
      size="sm"
    >
      <div className="space-y-4">
        {evalLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : evaluators.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">{t.admin.assignEvalNoEvals}</p>
        ) : (
          <div className="space-y-1">
            <label className="text-sm font-medium text-charcoal">{t.admin.assignEvalLabel}</label>
            <select
              value={selectedEval}
              onChange={(e) => setSelectedEval(e.target.value)}
              className="input-field w-full"
            >
              <option value="">{t.admin.assignEvalPlaceholder}</option>
              {evaluators.map((ev) => (
                <option key={ev.username} value={ev.username}>
                  {ev.name} ({ev.email})
                </option>
              ))}
            </select>
          </div>
        )}
        {evalError && <p className="text-xs text-red-500">{evalError}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {t.admin.deleteUserCancelBtn}
          </Button>
          <Button loading={evalSaving} disabled={!selectedEval} onClick={onAssign}>
            {t.admin.assignEvalBtn}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
