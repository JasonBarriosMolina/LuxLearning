'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shared/AppShell';
import { useAuth } from '@/lib/hooks/useAuth';

export default function EvaluatorLayout({ children }: { children: React.ReactNode }) {
  const { role, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
    if (!isLoading && isAuthenticated && role === 'STUDENT') router.replace('/dashboard');
    if (!isLoading && isAuthenticated && role !== 'EVALUATOR' && role !== 'ADMIN' && role !== 'SUPER_ADMIN' && role !== 'STUDENT') router.replace('/login');
  }, [isLoading, isAuthenticated, role, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cta-from border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
