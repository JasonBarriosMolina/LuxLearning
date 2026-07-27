'use client';

import { Wand2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface ChoiceModalProps {
  open: boolean;
  onClose: () => void;
  onWizard: () => void;
  onManual: () => void;
  onTopic: () => void;
  onUrl: () => void;
  t: any;
}

export function ChoiceModal({ open, onClose, onWizard, onManual, onTopic, onUrl, t }: ChoiceModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={t.admin.choiceModalTitle} size="md">
      <div className="space-y-3 pb-2">
        {/* Wizard completo */}
        <button
          type="button"
          onClick={onWizard}
          className="w-full text-left p-4 rounded-xl border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center shrink-0">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-charcoal text-sm">Wizard de Planeamiento Completo</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Calendario, tipo de evaluación, Copilot IA y generación del plan de estudios oficial (Word)
              </p>
            </div>
          </div>
        </button>

        <div className="grid grid-cols-2 gap-3">
          {/* Manual */}
          <button
            type="button"
            onClick={onManual}
            className="text-left p-4 rounded-xl border-2 border-border hover:border-cta-from hover:bg-blue-50 transition-colors"
          >
            <div className="text-2xl mb-2">📝</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choiceManualTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.admin.choiceManualDesc}</p>
          </button>

          {/* AI — topic */}
          <button
            type="button"
            onClick={onTopic}
            className="text-left p-4 rounded-xl border-2 border-border hover:border-purple-400 hover:bg-purple-50 transition-colors"
          >
            <div className="text-2xl mb-2">💡</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choiceTopicTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.admin.choiceTopicDesc}</p>
          </button>

          {/* AI — URL */}
          <button
            type="button"
            onClick={onUrl}
            className="text-left p-4 rounded-xl border-2 border-border hover:border-purple-400 hover:bg-purple-50 transition-colors"
          >
            <div className="text-2xl mb-2">🌐</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choiceUrlTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.admin.choiceUrlDesc}</p>
          </button>

          {/* PDF — disabled */}
          <div className="text-left p-4 rounded-xl border-2 border-dashed border-gray-200 opacity-50 cursor-not-allowed">
            <div className="text-2xl mb-2">📄</div>
            <p className="font-semibold text-charcoal text-sm">{t.admin.choicePdfTitle}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t.admin.choicePdfDesc}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
