'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { api } from '@/lib/api';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Heartbeat: update lastSeen every 2 minutes while app is open
  useEffect(() => {
    api.heartbeat();
    const interval = setInterval(() => api.heartbeat(), 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen bg-surface dark:bg-[#0F0F1A] overflow-hidden">
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
