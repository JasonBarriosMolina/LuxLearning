'use client';

interface ReplaceModulesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onReplace: () => void;
  onAddOnly: () => void;
  onSkipModules: () => void;
  isEN: boolean;
}

export function ReplaceModulesDialog({
  isOpen, onClose, onReplace, onAddOnly, onSkipModules, isEN,
}: ReplaceModulesDialogProps) {
  if (!isOpen) return null;
  const s = (es: string, en: string) => isEN ? en : es;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <p className="font-heading font-bold text-charcoal text-lg">
          {s('¿Qué deseas hacer con los módulos existentes?', 'What do you want to do with existing modules?')}
        </p>
        <p className="text-sm text-gray-500">
          {s(
            'Este curso ya tiene módulos creados. Elige cómo manejar la planificación regenerada.',
            'This course already has modules. Choose how to handle the regenerated plan.',
          )}
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={onReplace}
            className="w-full px-4 py-3 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors text-left"
          >
            <span className="block font-bold">
              {s('Reemplazar módulos y lecciones', 'Replace modules and lessons')}
            </span>
            <span className="block text-xs text-red-100 mt-0.5">
              {s('Elimina todo lo existente y crea desde cero', 'Deletes everything and creates from scratch')}
            </span>
          </button>
          <button
            onClick={onAddOnly}
            className="w-full px-4 py-3 rounded-xl border-2 border-cta-from text-cta-from font-semibold text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left"
          >
            <span className="block font-bold">
              {s('Agregar solo módulos nuevos', 'Add only new modules')}
            </span>
            <span className="block text-xs text-gray-400 mt-0.5">
              {s('Conserva los existentes, agrega los del plan nuevo', 'Keeps existing ones, adds modules from the new plan')}
            </span>
          </button>
          <button
            onClick={onSkipModules}
            className="w-full px-4 py-3 rounded-xl border border-border text-gray-600 dark:text-gray-300 font-semibold text-sm hover:bg-surface transition-colors text-left"
          >
            <span className="block font-bold">
              {s('Solo guardar configuración', 'Save configuration only')}
            </span>
            <span className="block text-xs text-gray-400 mt-0.5">
              {s('Guarda fechas, evaluación y plan, sin tocar módulos', 'Saves dates, evaluation and plan, without touching modules')}
            </span>
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl text-gray-400 text-sm hover:text-gray-600 transition-colors"
          >
            {s('Cancelar', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
