'use client';

import { useEffect, useState } from 'react';
import { Mail, Save, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

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
  const { t, lang } = useLanguage();

  const TEMPLATE_LABELS: Record<string, string> = {
    REFLECTION_APPROVED: t.admin.templateReflectionApproved,
    REFLECTION_REJECTED: t.admin.templateReflectionRejected,
    REFLECTION_RECONSIDERED: t.admin.templateReflectionReconsidered,
    TASK_ASSIGNED: t.admin.templateTaskAssigned,
    TASK_DUE_SOON: t.admin.templateTaskDueSoon,
    MESSAGE_UNREAD: t.admin.templateMessageUnread,
    COURSE_UPDATED: t.admin.templateCourseUpdated,
    WELCOME: t.admin.templateWelcome,
    ENROLLMENT: t.admin.templateEnrollment,
  };

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string>('REFLECTION_APPROVED');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

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
        <h1 className="font-heading font-bold text-2xl text-charcoal">{t.admin.emailTemplatesTitle}</h1>
      </div>
      <p className="text-sm text-gray-500">
        {t.admin.emailTemplatesSubtitle('{{variable}}')}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Template selector */}
        <div className="lg:col-span-1 space-y-1">
          {templates.map((tpl) => (
            <button
              key={tpl.type}
              onClick={() => handleSelect(tpl.type)}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                selected === tpl.type
                  ? 'bg-cta-from text-white'
                  : 'hover:bg-surface text-gray-600'
              }`}
            >
              {TEMPLATE_LABELS[tpl.type] ?? tpl.type}
              {tpl.updatedAt && (
                <p className={`text-xs mt-0.5 ${selected === tpl.type ? 'text-white/70' : 'text-gray-400'}`}>
                  {t.admin.templateEdited}
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
                  {showPreview ? t.admin.templateEdit : t.admin.templatePreview}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cta-from text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  {saved ? t.admin.templateSaved : t.admin.templateSave}
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
              <label className="block text-xs font-semibold text-gray-500 mb-1">{t.admin.templateSubjectLabel}</label>
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
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t.admin.templatePreviewLabel}</label>
                <div
                  className="border border-border rounded-xl p-4 text-sm bg-white min-h-48 prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: htmlBody }}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t.admin.templateBodyLabel}</label>
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
                {t.admin.lastEdited(new Date(current.updatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX'))}
                {current.updatedBy && t.admin.lastEditedBy(current.updatedBy)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
