'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Detects when a new service worker takes control (= new deploy is live)
 * and shows a toast prompting the user to refresh.
 *
 * Flow:
 *  1. New deploy → Vercel serves new sw.js hash
 *  2. Browser detects changed SW, installs it
 *  3. SW calls skipWaiting() → activates immediately
 *  4. controllerchange fires here → show toast
 *  5. User taps "Actualizar" OR auto-reloads after 8 s
 */
export function PwaUpdatePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Track whether a controller already existed at mount time.
    // controllerchange on first install (no previous controller) = not an update.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;

    const onControllerChange = () => {
      if (!hadController) return;   // first install, not an update
      if (reloading) return;
      setShow(true);
      // Auto-reload after 8 s if the user ignores the toast
      setTimeout(() => {
        if (!reloading) { reloading = true; window.location.reload(); }
      }, 8000);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm">
      <div className="bg-charcoal text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 animate-fade-in">
        <RefreshCw className="w-5 h-5 shrink-0 text-cta-from animate-spin" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Nueva versión disponible</p>
          <p className="text-xs text-gray-400 mt-0.5">La app se actualizará en unos segundos…</p>
        </div>
        <button
          onClick={() => { window.location.reload(); }}
          className="shrink-0 bg-cta-gradient text-white text-xs font-semibold px-3 py-1.5 rounded-xl hover:opacity-90 transition-opacity"
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}
