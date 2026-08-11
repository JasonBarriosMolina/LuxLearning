'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { RoleBadge, UserRole } from './RoleBadge';
export type { UserRole };

export interface AppUser {
  username: string;
  email: string;
  name: string;
  role: UserRole;
  enabled: boolean;
  status: string;
  createdAt: string | null;
}

interface Props {
  user: AppUser;
  onChange: (role: UserRole) => void;
  labels?: Record<UserRole, string>;
}

export function RoleSelector({ user, onChange, labels }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const l = labels ?? { STUDENT: 'Estudiante', EVALUATOR: 'Evaluador', ADMIN: 'Admin' };

  const roles: { value: UserRole; label: string }[] = [
    { value: 'STUDENT',   label: l.STUDENT },
    { value: 'EVALUATOR', label: l.EVALUATOR },
    { value: 'ADMIN',     label: l.ADMIN },
  ];

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.right - 140, width: rect.width });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const dropdown = open ? (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 140, zIndex: 9999 }}
      className="bg-white border border-border rounded-xl shadow-xl overflow-hidden animate-fade-in"
    >
      {roles.map((r) => (
        <button
          key={r.value}
          onClick={() => { onChange(r.value); setOpen(false); }}
          className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium hover:bg-surface transition-colors text-left ${user.role === r.value ? 'bg-surface' : ''}`}
        >
          {user.role === r.value
            ? <Check className="w-3 h-3 text-cta-from shrink-0" />
            : <span className="w-3 shrink-0" />}
          <RoleBadge role={r.value} />
        </button>
      ))}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs font-medium text-gray-600 hover:border-gray-400 hover:bg-surface transition-all"
      >
        <RoleBadge role={user.role} />
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </>
  );
}
