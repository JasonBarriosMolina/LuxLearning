'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Camera } from 'lucide-react';
import { api } from '@/lib/api';

type Session = { id: string; sessionDate: string; order: number };

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  courseId: string;
  nameMap: Record<string, string>;
  onRecorded: () => void;
}

type CameraState = 'idle' | 'requesting' | 'active' | 'denied' | 'error';

export function QrScannerModal({ open, onClose, sessions, courseId, nameMap, onRecorded }: Props) {
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [recording, setRecording] = useState(false);
  const scannerRef = useRef<any>(null);
  const lastScannedRef = useRef<string>('');

  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) setSelectedSessionId(sessions[sessions.length - 1]!.id);
  }, [sessions]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      stopScanner();
      setFeedback(null);
      setCameraState('idle');
      lastScannedRef.current = '';
    }
  }, [open]);

  // Start html5-qrcode AFTER React has mounted the scanner div (state = 'active')
  useEffect(() => {
    if (cameraState !== 'active') return;
    let cancelled = false;

    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;
      const el = document.getElementById('qr-scanner-region');
      if (!el) { setCameraState('error'); return; }

      const scanner = new Html5Qrcode('qr-scanner-region');
      scannerRef.current = scanner;

      scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText: string) => {
          if (decodedText !== lastScannedRef.current) {
            lastScannedRef.current = decodedText;
            handleQrScan(decodedText);
          }
        },
        () => { /* per-frame non-match — ignore */ }
      ).catch(() => {
        if (!cancelled) setCameraState('error');
      });
    })();

    return () => { cancelled = true; stopScanner(); };
  }, [cameraState]);

  function stopScanner() {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {}).finally(() => {
        scannerRef.current?.clear();
        scannerRef.current = null;
      });
    }
  }

  // Must be called from a click handler (user gesture) so the browser shows the permission popup
  async function activateCamera() {
    if (cameraState === 'requesting' || cameraState === 'active') return;
    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach((t) => t.stop()); // release; html5-qrcode will re-acquire
      setCameraState('active'); // triggers useEffect above after React re-renders
    } catch (err: any) {
      setCameraState(err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' ? 'denied' : 'error');
    }
  }

  async function handleQrScan(token: string) {
    if (!selectedSessionId || recording) return;
    setRecording(true);
    setFeedback(null);
    try {
      const res = await api.attendance.qrRecord({ token, sessionId: selectedSessionId, courseId }) as any;
      const d = res.data ?? res;
      const name = nameMap[d.userId] || d.userId;
      setFeedback({ type: 'success', message: `✅ ${name} registrado como Presente` });
      lastScannedRef.current = '';
      onRecorded();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Error al registrar' });
      setTimeout(() => { lastScannedRef.current = ''; }, 3000);
    } finally {
      setRecording(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-gray-900">Escanear QR del estudiante</h3>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Session selector */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Sesión a registrar</label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  Ses. {s.order} — {new Date(s.sessionDate).toLocaleDateString('es-CR')}
                </option>
              ))}
            </select>
          </div>

          {/* Camera region — always in DOM when active so html5-qrcode can attach */}
          <div className={`relative bg-gray-100 rounded-xl overflow-hidden ${cameraState === 'active' ? '' : 'hidden'}`} style={{ aspectRatio: '1' }}>
            <div id="qr-scanner-region" className="w-full h-full" />
            {recording && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-500" size={32} />
              </div>
            )}
          </div>

          {/* Idle: tap-to-start button */}
          {cameraState === 'idle' && (
            <button
              onClick={activateCamera}
              className="w-full flex flex-col items-center gap-3 py-10 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-300 transition-colors"
            >
              <Camera size={36} className="text-blue-400" />
              <span className="text-sm font-medium text-gray-600">Toca para activar la cámara</span>
              <span className="text-xs text-gray-400">El navegador solicitará permisos</span>
            </button>
          )}

          {cameraState === 'requesting' && (
            <div className="flex flex-col items-center gap-2 py-10 text-gray-500">
              <Loader2 size={32} className="animate-spin text-blue-400" />
              <p className="text-sm">Solicitando acceso a cámara…</p>
            </div>
          )}

          {cameraState === 'denied' && (
            <div className="flex flex-col items-center gap-3 py-8 text-red-500">
              <AlertCircle size={32} />
              <p className="text-sm font-medium text-center">Acceso a cámara denegado</p>
              <p className="text-xs text-center text-gray-500 max-w-[240px]">
                Ve a Ajustes del navegador → Permisos del sitio → Cámara y habilita el acceso para esta página.
              </p>
              <button onClick={() => setCameraState('idle')} className="text-xs text-blue-600 underline mt-1">Volver a intentar</button>
            </div>
          )}

          {cameraState === 'error' && (
            <div className="flex flex-col items-center gap-2 py-8 text-orange-500">
              <AlertCircle size={32} />
              <p className="text-sm text-center">No se pudo iniciar el escáner. Verifica que ninguna otra app esté usando la cámara.</p>
              <button onClick={() => setCameraState('idle')} className="text-xs text-blue-600 underline mt-1">Reintentar</button>
            </div>
          )}

          {/* Feedback */}
          {feedback && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
              feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {feedback.message}
            </div>
          )}

          {cameraState === 'active' && !recording && (
            <p className="text-xs text-center text-gray-400">
              Apunta la cámara al QR del estudiante. Se registra automáticamente.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
