'use client';

import { useEffect, useState } from 'react';
import { Award, Save, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface CertTemplate {
  logoUrl?: string;
  watermarkText?: string;
  primaryColor?: string;
  secondaryColor?: string;
  footerText?: string;
  fields?: { studentName: boolean; courseTitle: boolean; issuedAt: boolean };
}

const DEFAULTS: CertTemplate = {
  primaryColor: '#7B2FBE',
  secondaryColor: '#00B4D8',
  watermarkText: 'Lux Learning',
  footerText: 'Este certificado acredita la finalización exitosa del curso.',
  fields: { studentName: true, courseTitle: true, issuedAt: true },
};

export default function AdminCertificatesPage() {
  const [template, setTemplate] = useState<CertTemplate>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.certificates.template.get();
        setTemplate({ ...DEFAULTS, ...((res as any).data ?? res) });
      } catch { /* use defaults */ } finally { setLoading(false); }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await api.certificates.template.save(template);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar');
    } finally { setSaving(false); }
  };

  const fields = template.fields ?? DEFAULTS.fields!;

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Award className="w-7 h-7 text-purple-500" />
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">Plantilla de Certificados</h1>
          <p className="text-sm text-gray-500">Personaliza el diseño de los certificados PDF generados.</p>
        </div>
      </div>

      <div className="card space-y-5">
        {/* Colors */}
        <div>
          <h2 className="text-sm font-semibold text-charcoal mb-3">Colores</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Color primario</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={template.primaryColor ?? DEFAULTS.primaryColor}
                  onChange={(e) => setTemplate({ ...template, primaryColor: e.target.value })}
                  className="w-10 h-10 rounded border border-border cursor-pointer"
                />
                <span className="text-sm text-gray-600 font-mono">{template.primaryColor ?? DEFAULTS.primaryColor}</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Color secundario</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={template.secondaryColor ?? DEFAULTS.secondaryColor}
                  onChange={(e) => setTemplate({ ...template, secondaryColor: e.target.value })}
                  className="w-10 h-10 rounded border border-border cursor-pointer"
                />
                <span className="text-sm text-gray-600 font-mono">{template.secondaryColor ?? DEFAULTS.secondaryColor}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Text fields */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-charcoal">Texto</h2>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Texto de marca de agua</label>
            <input
              value={template.watermarkText ?? ''}
              onChange={(e) => setTemplate({ ...template, watermarkText: e.target.value })}
              className="input-field text-sm w-full"
              placeholder="ej. Lux Learning"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Texto del pie de página</label>
            <input
              value={template.footerText ?? ''}
              onChange={(e) => setTemplate({ ...template, footerText: e.target.value })}
              className="input-field text-sm w-full"
              placeholder="ej. Este certificado acredita la finalización exitosa del curso."
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">URL del logo (opcional)</label>
            <input
              value={template.logoUrl ?? ''}
              onChange={(e) => setTemplate({ ...template, logoUrl: e.target.value })}
              className="input-field text-sm w-full"
              placeholder="https://..."
            />
          </div>
        </div>

        {/* Fields toggle */}
        <div>
          <h2 className="text-sm font-semibold text-charcoal mb-3">Campos visibles en el certificado</h2>
          <div className="space-y-2">
            {[
              { key: 'studentName' as const, label: 'Nombre del estudiante' },
              { key: 'courseTitle' as const, label: 'Título del curso' },
              { key: 'issuedAt' as const, label: 'Fecha de emisión' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    fields[key] ? 'bg-cta-from border-cta-from' : 'border-gray-300 group-hover:border-gray-400'
                  }`}
                  onClick={() => setTemplate({
                    ...template,
                    fields: { ...fields, [key]: !fields[key] },
                  })}
                >
                  {fields[key] && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <span className="text-sm text-charcoal">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div>
          <h2 className="text-sm font-semibold text-charcoal mb-3">Vista previa</h2>
          <div className="rounded-xl overflow-hidden border border-border shadow-sm">
            <div className="h-2 w-full" style={{ background: `linear-gradient(90deg, ${template.primaryColor ?? DEFAULTS.primaryColor}, ${template.secondaryColor ?? DEFAULTS.secondaryColor})` }} />
            <div className="p-6 bg-white text-center space-y-2 relative">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: template.secondaryColor ?? DEFAULTS.secondaryColor }}>
                {template.watermarkText || DEFAULTS.watermarkText}
              </p>
              <p className="text-xl font-bold" style={{ color: template.primaryColor ?? DEFAULTS.primaryColor }}>Certificado de Finalización</p>
              {fields.courseTitle && <p className="text-sm font-semibold text-gray-700">Nombre del Curso</p>}
              <p className="text-xs text-gray-400">Se otorga a</p>
              {fields.studentName && <p className="text-lg font-bold text-gray-800">Nombre del Estudiante</p>}
              {fields.issuedAt && <p className="text-xs text-gray-400">Emitido el 1 de enero de 2025</p>}
              <div className="border-t border-gray-200 mt-3 pt-3">
                <p className="text-xs text-gray-400">{template.footerText || DEFAULTS.footerText}</p>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {saved && <p className="text-sm text-green-600 font-medium">✓ Plantilla guardada</p>}

        <div className="flex justify-end">
          <Button onClick={handleSave} loading={saving} leftIcon={<Save className="w-4 h-4" />}>
            Guardar plantilla
          </Button>
        </div>
      </div>
    </div>
  );
}
