'use client';

import { useEffect } from 'react';
import { configureAmplify } from '@/lib/amplify-config';

// Configure Amplify once, on the client
let configured = false;

export function AmplifyProvider({ children }: { children: React.ReactNode }) {
  if (!configured) {
    configureAmplify();
    configured = true;
  }
  return <>{children}</>;
}
