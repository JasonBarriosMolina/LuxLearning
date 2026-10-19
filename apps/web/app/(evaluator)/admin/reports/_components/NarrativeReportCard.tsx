'use client';

import { useState } from 'react';
import { Sparkles, Loader2, RefreshCw, Copy, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  studentId: string;
  courseId?: string;
  studentName?: string;
}

function renderNarrative(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (raw: string) =>
    esc(raw)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<u>$1</u>');
  const lines = md.split('\n');
  const parts: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('- ') || line.startsWith('• ')) {
      if (!inList) { parts.push('<ul style="padding-left:1.25em;margin:6px 0;list-style:disc">'); inList = true; }
      parts.push(`<li style="margin:3px 0;font-size:0.875rem;color:#374151">${inline(line.slice(2))}</li>`);
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      if (!line) { parts.push('<div style="height:6px"></div>'); }
      else if (line.startsWith('## ')) {
        parts.push(`<p style="font-weight:700;color:#17527E;margin:14px 0 4px;font-size:0.8125rem;text-transform:uppercase;letter-spacing:0.04em">${esc(line.slice(3))}</p>`);
      } else {
        parts.push(`<p style="margin:3px 0;font-size:0.875rem;color:#374151;line-height:1.6">${inline(line)}</p>`);
      }
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('');
}

export function NarrativeReportCard({ studentId, courseId, studentName }: Props) {
  const [narrative, setNarrative] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.admin.narrativeReport({ studentId, courseId });
      const d = (res as any).data ?? res;
      setNarrative(d.narrative ?? '');
      setGeneratedAt(d.generatedAt ?? '');
    } catch {
      setError('No se pudo generar el reporte. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(narrative);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#E2BA50] to-[#C9A130] flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#3A2A00]" />
          </div>
          <div>
            <h3 className="font-semibold text-charcoal text-sm">Reporte Narrativo IA</h3>
            <p className="text-xs text-gray-400">
              {narrative
                ? `Generado ${new Date(generatedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`
                : 'Análisis cualitativo personalizado por Lux Mentor'
              }
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {narrative && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#E2BA50] to-[#C9A130] text-[#3A2A00] text-xs font-semibold hover:opacity-90 disabled:opacity-60 transition-all"
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando…</>
              : narrative
              ? <><RefreshCw className="w-3.5 h-3.5" /> Regenerar</>
              : <><Sparkles className="w-3.5 h-3.5" /> Generar reporte</>
            }
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading && (
        <div className="bg-[#17527E]/5 rounded-xl p-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#17527E] mx-auto mb-2" />
          <p className="text-sm text-[#17527E] font-medium">Lux Mentor analizando el perfil de {studentName ?? 'estudiante'}…</p>
          <p className="text-xs text-gray-400 mt-1">Esto puede tomar unos segundos</p>
        </div>
      )}

      {!loading && narrative && (
        <div
          className="bg-gradient-to-br from-[#17527E]/5 to-[#17527E]/10 rounded-xl p-4 border border-[#E2BA50]/20"
          dangerouslySetInnerHTML={{ __html: renderNarrative(narrative) }}
        />
      )}

      {!loading && !narrative && !error && (
        <div className="bg-gray-50 rounded-xl px-4 py-6 text-center text-sm text-gray-400 border border-dashed border-gray-200">
          Presiona "Generar reporte" para que Lux Mentor analice el perfil completo de {studentName ?? 'este estudiante'}
        </div>
      )}
    </div>
  );
}
