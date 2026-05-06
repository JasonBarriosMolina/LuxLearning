'use client';

import { Bell, BellOff, BellRing } from 'lucide-react';
import { usePushNotifications } from '@/lib/usePushNotifications';

export function PushBell() {
  const { state, subscribe, unsubscribe } = usePushNotifications();

  if (state === 'unsupported') return null;

  if (state === 'subscribed') {
    return (
      <button
        onClick={unsubscribe}
        title="Desactivar notificaciones push"
        className="p-2 rounded-xl text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors"
      >
        <BellRing className="w-5 h-5" />
      </button>
    );
  }

  if (state === 'denied') {
    return (
      <span
        title="Notificaciones bloqueadas. Ve a Configuración del navegador → Privacidad → Notificaciones y permite este sitio."
        className="p-2 rounded-xl text-red-400 cursor-help"
      >
        <BellOff className="w-5 h-5" />
      </span>
    );
  }

  return (
    <button
      onClick={subscribe}
      disabled={state === 'requesting'}
      title="Activar notificaciones push"
      className="p-2 rounded-xl text-gray-500 hover:text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-50"
    >
      <Bell className="w-5 h-5" />
    </button>
  );
}
