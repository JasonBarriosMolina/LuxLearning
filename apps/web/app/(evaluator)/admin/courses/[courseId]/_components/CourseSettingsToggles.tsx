'use client';

// ─── CourseSettingsToggles.tsx ────────────────────────────────────────────────
// Extracted from the admin course detail page.tsx (over the 500-line limit) —
// the 3 simple on/off course-level switches: Piloto automático de asistencia,
// Ritmo semanal estricto (Trello DmPpbrff 2026-09-01 01:48), and the async
// auto-eval toggle (same comment, "evaluador humano" option). All state stays
// in the parent, this is presentation + the toggle handlers only.

interface Props {
  piloto: boolean;
  savingPiloto: boolean;
  onTogglePiloto: () => void;
  weeklyPacing: boolean;
  savingWeeklyPacing: boolean;
  onToggleWeeklyPacing: () => void;
  showAutoevaluated: boolean;
  autoevaluated: boolean;
  savingAutoevaluated: boolean;
  onToggleAutoevaluated: () => void;
  hasEvaluator: boolean;
}

function ToggleRow({
  label, description, checked, disabled, onToggle, ariaLabel, children,
}: {
  label: string; description: string; checked: boolean; disabled: boolean;
  onToggle: () => void; ariaLabel: string; children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-blue-500' : 'bg-gray-300'} disabled:opacity-50`}
          aria-label={ariaLabel}
        >
          <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
        </button>
      </div>
      {children}
    </div>
  );
}

export function CourseSettingsToggles({
  piloto, savingPiloto, onTogglePiloto,
  weeklyPacing, savingWeeklyPacing, onToggleWeeklyPacing,
  showAutoevaluated, autoevaluated, savingAutoevaluated, onToggleAutoevaluated, hasEvaluator,
}: Props) {
  return (
    <>
      <ToggleRow
        label="Piloto automático de asistencia"
        description="Envía notificaciones y alertas de riesgo automáticamente"
        checked={piloto} disabled={savingPiloto} onToggle={onTogglePiloto}
        ariaLabel="Piloto automático"
      />

      <ToggleRow
        label="Ritmo semanal estricto"
        description="El módulo N solo se desbloquea en la semana N del curso (desde la fecha de inicio), además de aprobar la reflexión anterior. Desactivado: flujo libre (actual)."
        checked={weeklyPacing} disabled={savingWeeklyPacing} onToggle={onToggleWeeklyPacing}
        ariaLabel="Ritmo semanal estricto"
      />

      {showAutoevaluated && (
        <ToggleRow
          label={autoevaluated ? 'Lux Mentor evalúa automáticamente' : 'Evaluador humano'}
          description="Curso asincrónico — decide quién evalúa reflexiones y entregas."
          checked={autoevaluated} disabled={savingAutoevaluated} onToggle={onToggleAutoevaluated}
          ariaLabel="Evaluación automática por Lux Mentor"
        >
          {!autoevaluated && !hasEvaluator && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5">
              ⚠️ Debes asignar un evaluador humano a este curso — sin uno, nadie recibirá las reflexiones pendientes.
            </p>
          )}
        </ToggleRow>
      )}
    </>
  );
}
