'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Bell, CheckCheck, Clock, CheckCircle, XCircle, BookOpen } from 'lucide-react';
import { PrismaLogo } from './PrismaLogo';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { PushBell } from '@/components/ui/PushBell';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

interface TopbarProps {
  title?: string;
  onMenuClick?: () => void;
}

type Notif = {
  notifId: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
  actionUrl?: string;
};

function NotifIcon({ type }: { type: string }) {
  if (type === 'REFLECTION_APPROVED') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (type === 'REFLECTION_REJECTED') return <XCircle className="w-4 h-4 text-red-400" />;
  if (type === 'MODULE_UNLOCKED') return <BookOpen className="w-4 h-4 text-cta-from" />;
  return <Clock className="w-4 h-4 text-gray-400" />;
}

export function Topbar({ title, onMenuClick }: TopbarProps) {
  const { role } = useAuth();
  const router = useRouter();
  const isEvaluator = role === 'EVALUATOR' || role === 'ADMIN';
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const unread = notifs.filter((n) => !n.read).length;

  // Load notifications
  useEffect(() => {
    api.notifications.list()
      .then((res: any) => setNotifs((res as any).data ?? res ?? []))
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markRead = async (notifId: string) => {
    setNotifs((prev) => prev.map((n) => n.notifId === notifId ? { ...n, read: true } : n));
    try { await api.notifications.markRead(notifId); } catch { /* non-fatal */ }
  };

  const markAllRead = async () => {
    const unreadIds = notifs.filter((n) => !n.read).map((n) => n.notifId);
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    await Promise.allSettled(unreadIds.map((id) => api.notifications.markRead(id)));
  };

  const handleOpen = () => {
    setOpen((v) => !v);
  };

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-[#1A1A2E] border-b border-border h-16 flex items-center px-4 lg:px-6 gap-4 shrink-0">
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg hover:bg-surface text-charcoal transition-colors"
        aria-label="Abrir menú"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile logo */}
      <div className="lg:hidden flex-1 flex items-center">
        <PrismaLogo size={24} showText textColor="#2C2C2C" />
      </div>

      {/* Desktop title */}
      {title && (
        <h1 className="hidden lg:block font-heading font-bold text-lg text-charcoal flex-1">
          {title}
        </h1>
      )}
      {!title && <div className="hidden lg:block flex-1" />}

      {/* Theme toggle */}
      <ThemeToggle />

      {/* Push bell — only evaluators/admins need real-time alerts in topbar */}
      {isEvaluator && <PushBell />}

      {/* Notification bell */}
      <div className="relative" ref={dropRef}>
        <button
          onClick={handleOpen}
          className="relative p-2 rounded-lg hover:bg-surface text-gray-500 hover:text-charcoal transition-colors"
          aria-label="Notificaciones"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-cta-from rounded-full text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-[#1A1A2E] border border-border rounded-2xl shadow-xl overflow-hidden z-50 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="font-heading font-bold text-sm text-charcoal">Notificaciones</p>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs text-cta-from font-semibold hover:opacity-70 transition-opacity"
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Marcar todas como leídas
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {notifs.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Sin notificaciones</p>
                </div>
              ) : (
                notifs.map((n) => (
                  <button
                    key={n.notifId}
                    onClick={() => {
                      markRead(n.notifId);
                      if (n.actionUrl) router.push(n.actionUrl);
                      setOpen(false);
                    }}
                    className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-surface transition-colors text-left ${!n.read ? 'bg-blue-50/40' : ''}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center shrink-0 mt-0.5">
                      <NotifIcon type={n.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-snug ${!n.read ? 'text-charcoal font-medium' : 'text-gray-600'}`}>
                        {n.message}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {new Date(n.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {!n.read && (
                      <div className="w-2 h-2 rounded-full bg-cta-from shrink-0 mt-1.5" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
