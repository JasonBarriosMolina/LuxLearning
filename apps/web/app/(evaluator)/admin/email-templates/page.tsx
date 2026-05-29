'use client';

import { useEffect, useState } from 'react';
import { Mail, Save, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';

const TEMPLATE_LABELS: Record<string, string> = {
  REFLECTION_APPROVED: 'Reflexión aprobada',
  REFLECTION_REJECTED: 'Reflexión rechazada',
  REFLECTION_RECONSIDERED: 'Reflexión reconsiderada',
  TASK_ASSIGNED: 'Tarea asignada',
  TASK_DUE_SOON: 'Tarea por vencer',
  MESSAGE_UNREAD: 'Mensaje sin leer',
  COURSE_UPDATED: 'Curso actualizado',
  WELCOME: 'Bienvenida',
  ENROLLMENT: 'Inscripción en curso',
};

const TEMPLATE_VARS: Record<string, string[]> = {
  REFLECTION_APPROVED: ['studentName', 'moduleTitle', 'feedback', 'frontendUrl'],
  REFLECTION_REJECTED: ['studentName', 'moduleTitle', 'feedback', 'frontendUrl'],
  REFLECTION_RECONSIDERED: ['studentName', 'moduleTitle', 'reason', 'frontendUrl'],
  TASK_ASSIGNED: ['studentName', 'taskTitle', 'courseTitle', 'dueDate', 'frontendUrl'],
  TASK_DUE_SOON: ['studentName', 'taskTitle', 'daysLeft', 'frontendUrl'],
  MESSAGE_UNREAD: ['recipientName', 'senderName', 'messagePreview', 'frontendUrl'],
  COURSE_UPDATED: ['studentName', 'courseTitle', 'frontendUrl'],
  WELCOME: ['studentName', 'frontendUrl'],
  ENROLLMENT: ['studentName', 'courseTitle', 'frontendUrl'],
};

interface Template {
  type: string;
  subject: string;
  htmlBody: string;
  updatedAt?: string;
  updatedBy?: string;
}

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string>('REFLECTION_APPROVED');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.admin.emailTemplates.list()
      .then((res: any) => {
        const list: Template[] = Array.isArray(res) ? res : (res.data ?? []);
        setTemplates(list);
        const first = list.find((t) => t.type === selected) ?? list[0];
        if (first) {
          setSubject(first.subject);
          setHtmlBody(first.htmlBody);
          setSelected(first.type);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (type: string) => {
    const t = templates.find((tpl) => tpl.type === type);
    if (t) {
      setSelected(type);
      setSubject(t.subject);
      setHtmlBody(t.htmlBody);
      setShowPreview(false);
      setSaved(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.admin.emailTemplates.update(selected, subject, htmlBody);
      setTemplates((prev) => prev.map((t) => t.type === selected ? { ...t, subject, htmlBody } : t));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* non-fatal */ } finally {
      setSaving(false);
    }
  };

  const current = templates.find((t) => t.type === selected);
  const vars = TEMPLATE_VARS[selected] ?? [];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-cta-from" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <Mail className="w-6 h-6 text-cta-from" />
        <h1 className="font-heading font-bold text-2xl text-charcoal">Templates de Email</h1>
      </div>
      <p className="text-sm text-gray-500">
        Personaliza los correos que se envían a estudiantes y evaluadores. Usa <code className="bg-surface px-1 rounded">{'{{variable}}'}</code> para insertar datos dinámicos.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Template selector */}
        <div className="lg:col-span-1 space-y-1">
          {templates.map((t) => (
            <button
              key={t.type}
              onClick={() => handleSelect(t.type)}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                selected === t.type
                  ? 'bg-cta-from text-white'
                  : 'hover:bg-surface text-gray-600'
              }`}
            >
              {TEMPLATE_LABELS[t.type] ?? t.type}
              {t.updatedAt && (
                <p className={`text-xs mt-0.5 ${selected === t.type ? 'text-white/70' : 'text-gray-400'}`}>
                  Editado
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold text-base text-charcoal">
                {TEMPLATE_LABELS[selected] ?? selected}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPreview((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-gray-600 hover:bg-surface transition-colors"
                >
                  {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showPreview ? 'Editar' : 'Preview'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cta-from text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  {saved ? 'Guardado' : 'Guardar'}
                </button>
              </div>
            </div>

            {/* Available variables */}
            <div className="flex flex-wrap gap-1.5">
              {vars.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    const tag = `{{${v}}}`;
                    setHtmlBody((prev) => prev + tag);
                  }}
                  className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded-full border border-purple-200 hover:bg-purple-100 transition-colors font-mono"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>

            {/* Subject */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Asunto (se añade "Lux Learning - Notificación: " automáticamente)</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cta-from bg-surface"
              />
            </div>

            {/* Body */}
            {showPreview ? (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Preview</label>
                <div
                  className="border border-border rounded-xl p-4 text-sm bg-white min-h-48 prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: htmlBody }}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Cuerpo HTML</label>
                <textarea
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  rows={14}
                  className="w-full border border-border rounded-xl px-4 py-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-cta-from bg-surface"
                />
              </div>
            )}

            {current?.updatedAt && (
              <p className="text-xs text-gray-400">
                Última edición: {new Date(current.updatedAt).toLocaleString('es-MX')}
                {current.updatedBy && ` · por ${current.updatedBy}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
