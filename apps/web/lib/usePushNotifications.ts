'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from './api';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray.buffer as ArrayBuffer;
}

export type PushState = 'idle' | 'requesting' | 'subscribed' | 'denied' | 'unsupported';

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('idle');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setState('subscribed');
      })
    );
  }, []);

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setState('requesting');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return;
      }

      // Get VAPID public key from backend
      const keyRes = await api.push.vapidKey();
      const vapidKey: string = (keyRes as any)?.data?.publicKey ?? '';
      if (!vapidKey) throw new Error('No VAPID public key');

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const json = sub.toJSON();
      await api.push.subscribe({
        endpoint: json.endpoint!,
        keys: { p256dh: json.keys!['p256dh'], auth: json.keys!['auth'] },
      });

      setState('subscribed');
    } catch (err) {
      console.error('Push subscribe error:', err);
      setState('idle');
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.push.unsubscribe({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState('idle');
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
  }, []);

  return { state, subscribe, unsubscribe };
}
