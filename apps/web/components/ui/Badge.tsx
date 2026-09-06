import { cn } from '@/lib/utils';
import type { ReflectionStatus } from '@lux/types';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'pending' | 'locked' | 'default';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
  pending: 'badge-pending',
  locked: 'badge-locked',
  default: 'badge bg-gray-100 text-gray-600',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span className={cn(variantClasses[variant], className)}>
      {children}
    </span>
  );
}

export function ReflectionStatusBadge({ status }: { status: ReflectionStatus | null }) {
  if (!status) return null;

  const config: Record<ReflectionStatus, { variant: BadgeVariant; label: string }> = {
    // Trello DmPpbrff, 2026-09-06 (Mack): "no debe decir eso directamente [IA]; debe
    // decir como 'revisándose por Lux Mentor'." Matches the wording already used for
    // this same status elsewhere (t.moduleView.reflectionStatusPendingAi).
    PENDING_AI: { variant: 'info', label: 'Siendo evaluado por Lux Mentor' },
    PENDING_EVAL: { variant: 'pending', label: 'En revisión' },
    APPROVED: { variant: 'success', label: 'Aprobada' },
    REJECTED: { variant: 'error', label: 'Rechazada' },
  };

  const { variant, label } = config[status];
  return <Badge variant={variant}>{label}</Badge>;
}
