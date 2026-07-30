'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
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

export function QrScannerModal({ open, onClose, sessions, courseId, nameMap, onRecorded }: Props) {
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [recording, setRecording] = useState(false);
  const scannerRef = useRef<any>(null);
  const lastScannedRef = useRef<string>('');

  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) setSelectedSessionId(sessions[sessions.length - 1]!.id);
  }, [sessions]);

  useEffect(() => {
    if (!open) {
      stopScanner();
      setFeedback(null);
      setCameraError('');
      lastScannedRef.current = '';
      return;
    }
    startScanner();
    return () => { stopScanner(); };
  }, [open]);

  async function startScanner() {
    const { Html5Qrcode } = await import('html5-qrcode');
    const el = document.getElementById('qr-scanner-region');
    if (!el) return;
    const scanner = new Html5Qrcode('qr-scanner-region');
    scannerRef.current = scanner;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText: string) => {
        if (decodedText !== lastScannedRef.current) {
          lastScannedRef.current = decodedText;
          handleQrScan(decodedText);
        }
      },
      () => { /* per-frame error — ignore */ }
    ).catch((err: any) => {
      setCameraError('No se pudo acceder a la cámara. Verifica los permisos.');
      console.error('[QrScanner]', err);
    });
  }

  function stopScanner() {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {}).finally(() => {
        scannerRef.current?.clear();
        scannerRef.current = null;
      });
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

          {/* Camera feed */}
          {cameraError ? (
            <div className="flex flex-col items-center gap-2 py-6 text-red-500">
              <AlertCircle size={32} />
              <p className="text-sm text-center">{cameraError}</p>
            </div>
          ) : (
            <div className="relative bg-gray-100 rounded-xl overflow-hidden" style={{ aspectRatio: '1' }}>
              <div id="qr-scanner-region" className="w-full h-full" />
              {recording && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <Loader2 className="animate-spin text-blue-500" size={32} />
                </div>
              )}
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

          <p className="text-xs text-center text-gray-400">
            Apunta la cámara al QR del estudiante. Se registra automáticamente.
          </p>
        </div>
      </div>
    </div>
  );
}
