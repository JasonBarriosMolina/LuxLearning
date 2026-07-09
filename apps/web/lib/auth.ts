'use client';

import {
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  confirmSignIn,
  getCurrentUser,
  fetchAuthSession,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  updateUserAttributes,
  updatePassword,
} from 'aws-amplify/auth';
import type { UserRole } from '@lux/types';

export async function login(email: string, password: string) {
  // If there's already an active session, sign out first to avoid Amplify's
  // "There is already a signed in user" error
  try {
    await signOut();
  } catch {
    // No active session — proceed normally
  }
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

export async function completeNewPassword(newPassword: string) {
  return confirmSignIn({ challengeResponse: newPassword });
}

export async function forgotPassword(email: string) {
  return resetPassword({ username: email });
}

export async function confirmForgotPassword(email: string, code: string, newPassword: string) {
  return confirmResetPassword({ username: email, confirmationCode: code, newPassword });
}

export async function updateName(name: string) {
  return updateUserAttributes({ userAttributes: { name } });
}

export async function changePassword(oldPassword: string, newPassword: string) {
  return updatePassword({ oldPassword, newPassword });
}

export async function getUserRole(): Promise<UserRole> {
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload;
    const groups = (payload?.['cognito:groups'] as string[] | undefined) ?? [];
    return groups.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : groups.includes('ADMIN') ? 'ADMIN' : groups.includes('EVALUATOR') ? 'EVALUATOR' : 'STUDENT';
  } catch {
    return 'STUDENT';
  }
}
