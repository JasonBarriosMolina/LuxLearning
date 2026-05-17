'use client';

import { Suspense } from 'react';
import { CommunicationsPanel } from '@/components/shared/CommunicationsPanel';
import { useAuth } from '@/lib/hooks/useAuth';

function EvaluatorCommunicationsInner() {
  const { role, userId } = useAuth();
  return <CommunicationsPanel role={(role as any) ?? 'EVALUATOR'} currentUserId={userId ?? ''} />;
}

export default function EvaluatorCommunicationsPage() {
  return (
    <Suspense>
      <EvaluatorCommunicationsInner />
    </Suspense>
  );
}
