'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Certificate } from '@lux/types';

function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function linkedInUrl(cert: Certificate) {
  const verifyUrl = `https://luxlearning.academy/certificado/${cert.certId}`;
  const issued = new Date(cert.issuedAt);
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: cert.courseTitle ?? 'Curso Lux Learning',
    organizationName: 'Lux Learning',
    issueYear: String(issued.getFullYear()),
    issueMonth: String(issued.getMonth() + 1),
    certId: cert.certId,
    certUrl: verifyUrl,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

export default function CertificatePage() {
  const { certId } = useParams<{ certId: string }>();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.certificates.get(certId).then((res: any) => {
      if (res?.data) { setCert(res.data); } else { setNotFound(true); }
      setLoading(false);
    }).catch(() => { setNotFound(true); setLoading(false); });
  }, [certId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(typeof window !== 'undefined' ? window.location.href : '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-4 border-[#17527E] border-t-transparent rounded-full" />
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

      {/* Action buttons — hidden when printing */}
      <div className="mb-6 flex gap-2 print:hidden flex-wrap justify-center">
        <a
          href={api.certificates.pdfUrl(certId)}
          download={`certificado-${certId}.pdf`}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white text-sm shadow-lg bg-gradient-to-r from-[#17527E] to-[#0F3F62] hover:from-[#1A6494] hover:to-[#17527E] transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Descargar PDF
        </a>

        <a
          href={linkedInUrl(cert)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white text-sm bg-[#0A66C2] hover:bg-[#004182] transition-colors shadow"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          Agregar a LinkedIn
        </a>

        <a
          href={`${api.certificates.pdfUrl(certId).replace('/pdf', '/badge')}`}
          download={`badge-${certId}.json`}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow transition-colors"
        >
          <svg className="w-4 h-4 text-[#E2BA50]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          Open Badge
        </a>

        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow transition-colors"
        >
          {copied ? '✓ Copiado' : 'Copiar enlace'}
        </button>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Imprimir
        </button>
      </div>

      {/* Certificate */}
      <div
        className="bg-white w-full max-w-3xl shadow-2xl print:shadow-none"
        style={{ borderRadius: '16px', overflow: 'hidden', fontFamily: "'Georgia', serif", printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
      >
        {/* Header gradient */}
        <div className="h-3 w-full bg-gradient-to-r from-[#17527E] to-[#0F3F62]" />

        <div className="px-16 py-12 text-center">
          {/* Brand */}
          <p className="text-sm font-bold tracking-[0.3em] uppercase mb-8 text-[#17527E]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            Lux Learning
          </p>

          <p className="text-base tracking-widest uppercase text-gray-400 mb-2" style={{ fontFamily: 'Montserrat, sans-serif', letterSpacing: '0.25em' }}>
            Certificado de Finalización
          </p>

          {/* Decorative line */}
          <div className="flex items-center justify-center gap-4 my-4">
            <div className="h-px w-24" style={{ background: 'linear-gradient(to right, transparent, #17527E)' }} />
            <div className="w-2.5 h-2.5 rounded-full bg-[#E2BA50]" />
            <div className="h-px w-24" style={{ background: 'linear-gradient(to left, transparent, #17527E)' }} />
          </div>

          <p className="text-gray-500 text-sm mt-6 mb-2">Se certifica que</p>

          {/* Student name */}
          <h1
            className="text-4xl font-bold mt-1 mb-6"
            style={{ background: 'linear-gradient(135deg, #17527E, #0F3F62)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', fontFamily: 'Montserrat, sans-serif' }}
          >
            {cert.studentName}
          </h1>

          <p className="text-gray-500 text-sm mb-2">ha completado satisfactoriamente el curso</p>

          {/* Course name */}
          <h2 className="text-2xl font-bold text-gray-800 mb-8 px-8" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {cert.courseTitle}
          </h2>

          {/* Date */}
          <p className="text-gray-500 text-sm mb-1">Emitido el</p>
          <p className="text-gray-700 font-semibold text-base mb-10">{formatDateLong(cert.issuedAt)}</p>

          {/* Decorative line */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <div className="h-px w-24" style={{ background: 'linear-gradient(to right, transparent, #17527E)' }} />
            <div className="w-2.5 h-2.5 rounded-full bg-[#E2BA50]" />
            <div className="h-px w-24" style={{ background: 'linear-gradient(to left, transparent, #17527E)' }} />
          </div>

          {/* Verification + badges */}
          <div className="bg-gray-50 rounded-xl px-6 py-4 inline-block">
            <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">ID de verificación</p>
            <p className="font-mono text-xs text-gray-500 break-all">{cert.certId}</p>
            <p className="text-xs text-gray-400 mt-1">
              Verifica en: <span className="text-[#17527E]">{typeof window !== 'undefined' ? window.location.href : ''}</span>
            </p>
          </div>
        </div>

        {/* Footer gradient */}
        <div className="h-3 w-full bg-gradient-to-r from-[#17527E] to-[#0F3F62]" />
      </div>

      <p className="text-gray-400 text-xs mt-4 print:hidden">
        Usa Ctrl+P (o Cmd+P en Mac) → "Guardar como PDF" para descargar el certificado
      </p>

      <style>{`
        @media print {
          body { margin: 0; }
          @page { size: A4 landscape; margin: 0; }
        }
      `}</style>
    </div>
  );
}
