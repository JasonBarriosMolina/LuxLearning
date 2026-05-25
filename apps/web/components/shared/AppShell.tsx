'use client';

import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { OnboardingWizard } from './OnboardingWizard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { Bell, X } from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

async function subscribeToPush() {
  try {
    const { data: vapidData } = await api.push.vapidKey() as any;
    const vapidKey = vapidData?.publicKey ?? (await api.push.vapidKey() as any)?.publicKey;
    if (!vapidKey) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey,
    });
    const json = sub.toJSON() as any;
    await api.push.subscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  } catch { /* ignore */ }
}

export function AppShell({ children, title }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const { role } = useAuth();
  const sessionIdRef = useRef(`sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const sessionStartRef = useRef(Date.now());

  // Push notification prompt for students on first visit
  useEffect(() => {
    if (role !== 'STUDENT') return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    const dismissed = localStorage.getItem('lux-push-dismissed');
    if (dismissed) return;
    // Show prompt after 2 seconds
    const t = setTimeout(() => setShowPushPrompt(true), 2000);
    return () => clearTimeout(t);
  }, [role]);

  const handlePushAccept = async () => {
    setShowPushPrompt(false);
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') await subscribeToPush();
    } catch { /* ignore */ }
  };

  const handlePushDismiss = () => {
    setShowPushPrompt(false);
    localStorage.setItem('lux-push-dismissed', '1');
  };

  // Heartbeat: update lastSeen every 2 minutes while app is open
  useEffect(() => {
    api.heartbeat();
    const interval = setInterval(() => api.heartbeat(), 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Session tracking for Mi Actividad (students only)
  useEffect(() => {
    if (role !== 'STUDENT') return;
    const sessionId = sessionIdRef.current;
    api.student.activity.start(sessionId);

    const heartbeat = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      api.student.activity.update(sessionId, elapsed);
    }, 2 * 60 * 1000); // every 2 min

    const onUnload = () => api.student.activity.end(sessionId);
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', onUnload);
      api.student.activity.end(sessionId);
    };
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen bg-surface dark:bg-[#0F0F1A] overflow-hidden">
      {role === 'STUDENT' && <OnboardingWizard />}

      {/* Push notification prompt */}
      {showPushPrompt && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-sm bg-white dark:bg-[#1A1A2E] border border-border rounded-2xl shadow-xl p-4 animate-fade-in">
          <button onClick={handlePushDismiss} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cta-from/10 flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-cta-from" />
            </div>
            <div className="flex-1">
              <p className="font-heading font-semibold text-charcoal text-sm">¿Activar notificaciones?</p>
              <p className="text-xs text-gray-500 mt-0.5">Recibe alertas de tareas, mensajes y novedades sin abrir la app.</p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handlePushAccept}
                  className="flex-1 py-1.5 rounded-lg bg-cta-gradient text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  Activar
                </button>
                <button
                  onClick={handlePushDismiss}
                  className="flex-1 py-1.5 rounded-lg border border-border text-gray-500 text-xs font-semibold hover:bg-surface transition-colors"
                >
                  Ahora no
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <Sidebar
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
