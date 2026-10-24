'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';

/** Sends signed-in visitors to their dashboard without blocking the landing for everyone else. */
export function AuthRedirect() {
  const { isAuthenticated, isLoading, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(role === 'EVALUATOR' || role === 'ADMIN' || role === 'SUPER_ADMIN' ? '/evaluator/dashboard' : '/dashboard');
    }
  }, [isLoading, isAuthenticated, role, router]);

  return null;
}
