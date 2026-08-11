'use client';

import { useState } from 'react';
import { UserPlus, X, Check, Mail, Copy, CheckCheck, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { UserRole, AppUser } from './RoleSelector';

export interface InviteStrings {
  titleCreated: string; titleNew: string; subCreated: string; subNew: string;
  successMsg: string; emailLabel: string; passLabel: string; copyPass: string;
  warning: string; closeBtn: string; emailField: string; emailPh: string;
  nameLabel: string; namePh: string; roleLabel: string; coursesLabel: string;
  coursesHint: string; cancelBtn: string; inviteBtn: string; emailRequired: string;
  roleStudent: string; roleEvaluator: string; roleAdmin: string;
}

interface Props {
  onClose: () => void;
  onCreated: (u: AppUser) => void;
  courses: { id: string; title: string }[];
  strings: InviteStrings;
}

export function InviteModal({ onClose, onCreated, courses, strings }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('STUDENT');
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleCourse = (id: string) =>
    setSelectedCourses((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);

  const copyPassword = () => {
    if (created) {
      navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const submit = async () => {
    if (!email.trim()) { setError(strings.emailRequired); return; }
    setLoading(true); setError('');
    try {
      const res: any = await api.admin.users.invite({
        email: email.trim(),
        role,
        name: name.trim() || undefined,
        courseIds: selectedCourses.length > 0 ? selectedCourses : undefined,
      });
      const raw = (res as any)?.data ?? res;
      const newUser: AppUser = {
        username: raw.username ?? email.trim(),
        email: raw.email ?? email.trim(),
        name: name.trim(),
        role,
        enabled: true,
        status: 'FORCE_CHANGE_PASSWORD',
        createdAt: new Date().toISOString(),
      };
      onCreated(newUser);
      setCreated({ email: email.trim(), temporaryPassword: raw.temporaryPassword ?? '' });
    } catch (e: any) {
      setError(e?.body?.error ?? e?.message ?? 'Error al crear usuario');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cta-gradient flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-charcoal">
                {created ? strings.titleCreated : strings.titleNew}
              </h2>
              <p className="text-xs text-gray-400">
                {created ? strings.subCreated : strings.subNew}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-gray-400 hover:text-charcoal transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success: show credentials */}
        {created && (
          <div className="space-y-3">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-emerald-700">
                <Check className="w-4 h-4 shrink-0" />
                <p className="text-sm font-semibold">{strings.successMsg}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">{strings.emailLabel}</p>
                  <p className="font-medium text-charcoal">{created.email}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">{strings.passLabel}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-1.5 font-mono text-sm text-charcoal font-bold tracking-wider">
                      {created.temporaryPassword}
                    </code>
                    <button
                      onClick={copyPassword}
                      className="p-2 rounded-lg border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50 transition-colors"
                      title={strings.copyPass}
                    >
                      {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {strings.warning}
              </p>
            </div>
            <Button className="w-full" size="sm" onClick={onClose}>
              {strings.closeBtn}
            </Button>
          </div>
        )}

        {/* Fields */}
        {!created && (
          <>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{strings.emailField}</label>
                <Input
                  type="email"
                  placeholder={strings.emailPh}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<Mail className="w-4 h-4" />}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{strings.nameLabel}</label>
                <Input
                  placeholder={strings.namePh}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{strings.roleLabel}</label>
                <div className="flex gap-2">
                  {(['STUDENT', 'EVALUATOR', 'ADMIN'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-all ${
                        role === r
                          ? r === 'ADMIN' ? 'border-purple-500 bg-purple-50 text-purple-700'
                            : r === 'EVALUATOR' ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-border text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      {r === 'STUDENT' ? strings.roleStudent : r === 'EVALUATOR' ? strings.roleEvaluator : strings.roleAdmin}
                    </button>
                  ))}
                </div>
              </div>
              {courses.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">
                    {strings.coursesLabel} <span className="font-normal text-gray-400">{strings.coursesHint}</span>
                  </label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {courses.map((c) => {
                      const checked = selectedCourses.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggleCourse(c.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 text-sm text-left transition-all ${
                            checked ? 'border-cta-from bg-blue-50 text-charcoal' : 'border-border text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                            checked ? 'border-cta-from bg-cta-from' : 'border-gray-300'
                          }`}>
                            {checked && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <span className="truncate">{c.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button variant="secondary" onClick={onClose} className="flex-1" size="sm">{strings.cancelBtn}</Button>
              <Button onClick={submit} loading={loading} className="flex-1" size="sm">
                <UserPlus className="w-4 h-4" />
                {strings.inviteBtn}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
