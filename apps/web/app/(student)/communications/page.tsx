'use client';

import { Suspense } from 'react';
import { CommunicationsPanel } from '@/components/shared/CommunicationsPanel';
import { useAuth } from '@/lib/hooks/useAuth';

function StudentCommunicationsInner() {
  const { role, userId } = useAuth();
  return <CommunicationsPanel role={(role as any) ?? 'STUDENT'} currentUserId={userId ?? ''} />;
}

export default function StudentCommunicationsPage() {
  return (
    <Suspense>
      <StudentCommunicationsInner />
    </Suspense>
  );
}
