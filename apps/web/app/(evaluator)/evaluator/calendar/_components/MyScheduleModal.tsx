'use client';

import { useEffect, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';

interface ScheduleClass {
  courseId: string; courseTitle: string; startTime: string; endTime: string;
  academicPeriod: string; modality: string; classType: string; studentCount: number;
}
interface ScheduleItem { dayOfWeek: number; dayLabel: string; blockStart: string; blockEnd: string; classes: ScheduleClass[] }

// Trello *LUX SCHEDULER* (Mack, 2026-09-15): "como evaluador, debe existir...
// un botón de 'Ver mi horario'... deben verse incluidas las clases y cursos
// ya asignados. Si el curso aún no se ha creado, debería verse el espacio
// como 'bloqueado'... 'Pendiente de asignar curso a esta franja horaria'."
export function MyScheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [hasAvailability, setHasAvailability] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.evaluator.calendar.mySchedule()
      .then((res: any) => { setItems(res?.data?.items ?? []); setHasAvailability(res?.data?.hasAvailability ?? false); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Mi horario semanal">
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…</div>
      ) : !hasAvailability ? (
        <p className="text-sm text-gray-400 italic py-6 text-center">
          No has declarado disponibilidad todavía — configúrala en tu perfil para que Lux Scheduler pueda asignarte clases.
        </p>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {items.map((item, i) => (
            <div key={i} className="p-3 bg-surface rounded-xl">
              <p className="text-xs font-semibold text-gray-500 mb-1.5">{item.dayLabel} · {item.blockStart}–{item.blockEnd}</p>
              {item.classes.length > 0 ? (
                <div className="space-y-1.5">
                  {item.classes.map((c, j) => (
                    <div key={j} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 text-sm">
                      <div>
                        <p className="font-medium text-charcoal">{c.courseTitle}</p>
                        <p className="text-xs text-gray-400">{c.startTime}–{c.endTime} · {c.modality === 'PRESENCIAL' ? 'Presencial' : 'Virtual'} · {c.studentCount} estudiante{c.studentCount !== 1 ? 's' : ''} · {c.academicPeriod}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-2.5 py-2 text-xs text-gray-500">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  Pendiente de asignar curso a esta franja horaria — se completa desde Lux Planner o "Nuevo Curso".
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
