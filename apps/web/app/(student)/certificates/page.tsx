'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { Certificate } from '@lux/types';

function formatDate(iso: string) {
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

export default function CertificatesPage() {
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.certificates.mine().then((r: any) => setCerts(r.data ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#17527E] via-[#1A6494] to-[#0F3F62] px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Mis Certificados</h1>
        <p className="text-blue-200 text-sm mt-1">Cursos completados y credenciales obtenidas</p>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-[#17527E] border-t-transparent rounded-full mx-auto" />
          </div>
        )}

        {!loading && certs.length === 0 && (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
            <div className="w-16 h-16 rounded-full bg-[#17527E]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#17527E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <p className="text-gray-500 font-medium">Aún no tienes certificados</p>
            <p className="text-gray-400 text-sm mt-1">Completa un curso para obtener tu primer certificado</p>
          </div>
        )}

        <div className="space-y-4">
          {certs.map((cert) => (
            <div key={cert.certId} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              {/* Top bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-[#17527E] to-[#0F3F62]" />

              <div className="px-6 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <svg className="w-4 h-4 text-[#E2BA50] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                      <span className="text-xs font-semibold text-[#17527E] uppercase tracking-wide">Certificado</span>
                    </div>
                    <h2 className="text-base font-bold text-gray-800 line-clamp-2">{cert.courseTitle}</h2>
                    <p className="text-sm text-gray-500 mt-1">Emitido el {formatDate(cert.issuedAt)}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 mt-4">
                  <a
                    href={`/certificado/${cert.certId}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#17527E] bg-[#17527E]/5 hover:bg-[#17527E]/10 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    </svg>
                    Ver certificado
                  </a>

                  <a
                    href={api.certificates.pdfUrl(cert.certId)}
                    download={`certificado-${cert.certId}.pdf`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    PDF
                  </a>

                  <a
                    href={linkedInUrl(cert)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#0A66C2] hover:bg-[#004182] transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                    LinkedIn
                  </a>

                  <a
                    href={api.certificates.pdfUrl(cert.certId).replace('/pdf', '/badge')}
                    download={`badge-${cert.certId}.json`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#C9A130] bg-[#E2BA50]/10 hover:bg-[#E2BA50]/20 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                    Open Badge
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
