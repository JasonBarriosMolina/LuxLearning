'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCurrentAuthUser, getUserRole, logout } from '../auth';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@lux/types';

interface AuthState {
  userId: string | null;
  email: string | null;
  role: UserRole | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    userId: null,
    email: null,
    role: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const refresh = useCallback(async () => {
    try {
      const user = await getCurrentAuthUser();
      if (user) {
        const role = await getUserRole();
        setState({
          userId: user.userId,
          email: user.signInDetails?.loginId ?? null,
          role,
          isLoading: false,
          isAuthenticated: true,
        });
      } else {
        setState({ userId: null, email: null, role: null, isLoading: false, isAuthenticated: false });
      }
    } catch {
      setState({ userId: null, email: null, role: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    await logout();
    setState({ userId: null, email: null, role: null, isLoading: false, isAuthenticated: false });
    router.push('/login');
  }, [router]);

  return { ...state, refresh, signOut };
}
