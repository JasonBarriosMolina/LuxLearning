'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Certificate } from '@lux/types';

function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function CertificatePage() {
  const { certId } = useParams<{ certId: string }>();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.certificates.get(certId).then((res: any) => {
      if (res?.data) {
        setCert(res.data);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    }).catch(() => { setNotFound(true); setLoading(false); });
  }, [certId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (notFound || !cert) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-400">Certificado no encontrado</p>
          <p className="text-gray-400 mt-2 text-sm">El ID puede ser incorrecto o el certificado no existe.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-6 print:p-0 print:bg-white">

      {/* Print button — hidden when printing */}
      <div className="mb-6 flex gap-3 print:hidden flex-wrap justify-center">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-sm shadow-lg"
          style={{ background: 'linear-gradient(135deg, #00B4D8, #7B2FBE)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Imprimir / Guardar como PDF
        </button>
        <a
          href={api.certificates.pdfUrl(certId)}
          download={`certificado-${certId}.pdf`}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-gray-700 text-sm bg-white shadow border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Descargar PDF
        </a>
        <a
          href="/"
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-gray-600 text-sm bg-white shadow border border-gray-200"
        >
          Ir a Lux Learning
        </a>
      </div>

      {/* Certificate */}
      <div
        className="bg-white w-full max-w-3xl shadow-2xl print:shadow-none"
        style={{
          borderRadius: '16px',
          overflow: 'hidden',
          fontFamily: "'Georgia', serif",
          printColorAdjust: 'exact',
          WebkitPrintColorAdjust: 'exact',
        }}
      >
        {/* Header gradient */}
        <div
          className="h-3 w-full"
          style={{ background: 'linear-gradient(135deg, #00B4D8, #7B2FBE)' }}
        />

        <div className="px-16 py-12 text-center">
          {/* Logo / brand */}
          <p
            className="text-sm font-bold tracking-[0.3em] uppercase mb-8"
            style={{ color: '#00B4D8', fontFamily: 'Montserrat, sans-serif' }}
          >
            Lux Learning
          </p>

          <p
            className="text-base tracking-widest uppercase text-gray-400 mb-2"
            style={{ fontFamily: 'Montserrat, sans-serif', letterSpacing: '0.25em' }}
          >
            Certificado de Finalización
          </p>

          {/* Decorative line */}
          <div className="flex items-center justify-center gap-4 my-4">
            <div className="h-px w-24" style={{ background: 'linear-gradient(to right, transparent, #00B4D8)' }} />
            <div className="w-2 h-2 rounded-full" style={{ background: '#7B2FBE' }} />
            <div className="h-px w-24" style={{ background: 'linear-gradient(to left, transparent, #7B2FBE)' }} />
          </div>

          <p className="text-gray-500 text-sm mt-6 mb-2">Se certifica que</p>

          {/* Student name */}
          <h1
            className="text-4xl font-bold mt-1 mb-6"
            style={{
              background: 'linear-gradient(135deg, #00B4D8, #7B2FBE)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            {cert.studentName}
          </h1>

          <p className="text-gray-500 text-sm mb-2">ha completado satisfactoriamente el curso</p>

          {/* Course name */}
          <h2
            className="text-2xl font-bold text-gray-800 mb-8 px-8"
            style={{ fontFamily: 'Montserrat, sans-serif' }}
          >
            {cert.courseTitle}
          </h2>

          {/* Date */}
          <p className="text-gray-500 text-sm mb-1">Emitido el</p>
          <p className="text-gray-700 font-semibold text-base mb-10">
            {formatDateLong(cert.issuedAt)}
          </p>

          {/* Decorative line */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <div className="h-px w-24" style={{ background: 'linear-gradient(to right, transparent, #00B4D8)' }} />
            <div className="w-2 h-2 rounded-full" style={{ background: '#7B2FBE' }} />
            <div className="h-px w-24" style={{ background: 'linear-gradient(to left, transparent, #7B2FBE)' }} />
          </div>

          {/* Verification */}
          <div className="bg-gray-50 rounded-xl px-6 py-4 inline-block">
            <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">ID de verificación</p>
            <p className="font-mono text-xs text-gray-500 break-all">{cert.certId}</p>
            <p className="text-xs text-gray-400 mt-1">
              Verifica en: <span className="text-blue-500">{typeof window !== 'undefined' ? window.location.href : ''}</span>
            </p>
          </div>
        </div>

        {/* Footer gradient */}
        <div
          className="h-3 w-full"
          style={{ background: 'linear-gradient(135deg, #00B4D8, #7B2FBE)' }}
        />
      </div>

      <p className="text-gray-400 text-xs mt-4 print:hidden">
        Usa Ctrl+P (o Cmd+P en Mac) → "Guardar como PDF" para descargar el certificado
      </p>

      {/* Print styles */}
      <style>{`
        @media print {
          body { margin: 0; }
          @page { size: A4 landscape; margin: 0; }
        }
      `}</style>
    </div>
  );
}
