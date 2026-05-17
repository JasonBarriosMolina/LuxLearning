'use client';

import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { OnboardingWizard } from './OnboardingWizard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { role } = useAuth();
  const sessionIdRef = useRef(`sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const sessionStartRef = useRef(Date.now());

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
