// Must match the CHECK constraints in services/api/platform-db/*.sql.

export type StatusDef = { value: string; label: string; tone: string };

export const LEAD_STATUSES: StatusDef[] = [
  { value: 'NEW', label: 'Nuevo', tone: 'bg-[#E8F2FC] text-[#17527E] ring-[#B9D7F2]' },
  { value: 'CONTACTED', label: 'Contactado', tone: 'bg-[#E6F6FA] text-[#126E86] ring-[#A9DDEA]' },
  { value: 'DEMO_SCHEDULED', label: 'Demo agendada', tone: 'bg-[#EEF0FD] text-[#3B4CB8] ring-[#C7CDF5]' },
  { value: 'WON', label: 'Cliente', tone: 'bg-[#E8F6EE] text-[#1B7A47] ring-[#B5E2C7]' },
  { value: 'LOST', label: 'Descartado', tone: 'bg-[#F1F3F5] text-[#5B6672] ring-[#D9DEE3]' },
];

export const TEACHER_STATUSES: StatusDef[] = [
  { value: 'NEW', label: 'Nueva', tone: 'bg-[#E8F2FC] text-[#17527E] ring-[#B9D7F2]' },
  { value: 'REVIEWING', label: 'En revisión', tone: 'bg-[#E6F6FA] text-[#126E86] ring-[#A9DDEA]' },
  { value: 'INTERVIEW', label: 'Entrevista', tone: 'bg-[#EEF0FD] text-[#3B4CB8] ring-[#C7CDF5]' },
  { value: 'ONBOARDING', label: 'Onboarding', tone: 'bg-[#FFF6DF] text-[#8A6212] ring-[#F1DA9C]' },
  { value: 'ACTIVE', label: 'Activo', tone: 'bg-[#E8F6EE] text-[#1B7A47] ring-[#B5E2C7]' },
  { value: 'REJECTED', label: 'Descartado', tone: 'bg-[#F1F3F5] text-[#5B6672] ring-[#D9DEE3]' },
];

export function findStatus(list: StatusDef[], value: string): StatusDef {
  return list.find((s) => s.value === value) ?? { value, label: value, tone: 'bg-[#F1F3F5] text-[#5B6672] ring-[#D9DEE3]' };
}

const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
