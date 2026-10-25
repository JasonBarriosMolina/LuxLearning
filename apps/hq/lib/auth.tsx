'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';

// HQ uses its own Cognito pool (lux-hq-staff-<env>), never the tenant pool.
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_HQ_COGNITO_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_HQ_COGNITO_CLIENT_ID!,
      loginWith: { email: true },
    },
  },
});

export type StaffGroup = 'OWNER' | 'MARKETING' | 'DEV' | 'DATA';
export type Staff = { email: string; name: string | null; groups: StaffGroup[] };

type AuthState = {
  staff: Staff | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** The ID token carries email and cognito:groups; the API Gateway JWT authorizer expects it too. */
export async function getIdToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      const payload = session.tokens?.idToken?.payload;
      if (!payload) {
        setStaff(null);
        return;
      }
      const groups = (payload['cognito:groups'] as string[] | undefined) ?? [];
      setStaff({
        email: String(payload.email ?? ''),
        name: payload.name ? String(payload.name) : null,
        groups: groups as StaffGroup[],
      });
    } catch {
      setStaff(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await amplifySignOut().catch(() => {});
    setStaff(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ staff, loading, refresh, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function canSeePipelines(staff: Staff | null): boolean {
  return !!staff && staff.groups.some((g) => g === 'OWNER' || g === 'MARKETING');
}
