'use client';

import {
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  getCurrentUser,
  fetchAuthSession,
  resendSignUpCode,
} from 'aws-amplify/auth';
import type { UserRole } from '@lux/types';

export async function login(email: string, password: string) {
  const result = await signIn({ username: email, password });
  return result;
}

export async function register(email: string, password: string, name?: string) {
  const result = await signUp({
    username: email,
    password,
    options: {
      userAttributes: {
        email,
        ...(name ? { name } : {}),
      },
    },
  });
  return result;
}

export async function confirmRegistration(email: string, code: string) {
  return confirmSignUp({ username: email, confirmationCode: code });
}

export async function resendCode(email: string) {
  return resendSignUpCode({ username: email });
}

export async function logout() {
  await signOut();
}

export async function getSession() {
  try {
    const session = await fetchAuthSession();
    return session;
  } catch {
    return null;
  }
}

export async function getIdToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession({ forceRefresh: false });
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentAuthUser() {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

export async function getUserRole(): Promise<UserRole> {
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload;
    const groups = (payload?.['cognito:groups'] as string[] | undefined) ?? [];
    return groups.includes('EVALUATOR') ? 'EVALUATOR' : 'STUDENT';
  } catch {
    return 'STUDENT';
  }
}
