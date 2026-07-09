'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { getCurrentAuthUser, getUserRole, logout } from '../auth';
import { api } from '../api';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@lux/types';

interface AuthState {
  userId: string | null;
  email: string | null;
  name: string | null;
  role: UserRole | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    userId: null,
    email: null,
    name: null,
    role: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const refresh = useCallback(async () => {
    try {
      const user = await getCurrentAuthUser();
      if (user) {
        const [role, attrs] = await Promise.all([
          getUserRole(),
          fetchUserAttributes().catch(() => ({} as Record<string, string>)),
        ]);
        setState({
          userId: user.userId,
          email: user.signInDetails?.loginId ?? null,
          name: (attrs as any).name ?? null,
          role,
          isLoading: false,
          isAuthenticated: true,
        });
        // Sync current UI language preference to backend (fire-and-forget)
        const storedLang = typeof window !== 'undefined' ? (localStorage.getItem('lux-lang') ?? 'es') : 'es';
        api.user.setLang(storedLang).catch(() => {});
      } else {
        setState({ userId: null, email: null, name: null, role: null, isLoading: false, isAuthenticated: false });
      }
    } catch {
      setState({ userId: null, email: null, name: null, role: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    await logout();
    setState({ userId: null, email: null, name: null, role: null, isLoading: false, isAuthenticated: false });
    router.push('/login');
  }, [router]);

  return { ...state, refresh, signOut };
}
