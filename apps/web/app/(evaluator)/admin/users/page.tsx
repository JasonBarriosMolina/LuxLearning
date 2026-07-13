'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Users, UserPlus, Search, Shield, GraduationCap, ClipboardCheck,
  ToggleLeft, ToggleRight, Trash2, ChevronDown, Mail, X, Check, AlertTriangle, Copy, CheckCheck,
  Upload, CheckCircle, XCircle, SkipForward, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';

type UserRole = 'ADMIN' | 'EVALUATOR' | 'STUDENT';

type AppUser = {
  username: string;
  email: string;
  name: string;
  role: UserRole;
  enabled: boolean;
  status: string;
  createdAt: string | null;
};

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role, labels }: { role: UserRole; labels?: Record<UserRole, string> }) {
  const defaultLabels: Record<UserRole, string> = { ADMIN: 'Admin', EVALUATOR: 'Evaluador', STUDENT: 'Estudiante' };
  const l = labels ?? defaultLabels;
  const map: Record<UserRole, { label: string; className: string; icon: React.ReactNode }> = {
    ADMIN: { label: l.ADMIN, className: 'bg-purple-100 text-purple-700', icon: <Shield className="w-3 h-3" /> },
    EVALUATOR: { label: l.EVALUATOR, className: 'bg-blue-100 text-blue-700', icon: <ClipboardCheck className="w-3 h-3" /> },
    STUDENT: { label: l.STUDENT, className: 'bg-emerald-100 text-emerald-700', icon: <GraduationCap className="w-3 h-3" /> },
  };
  const { label, className, icon } = map[role];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {icon}{label}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, enabled, labels }: { status: string; enabled: boolean; labels?: { disabled: string; pending: string; active: string } }) {
  const l = labels ?? { disabled: 'Desactivado', pending: 'Pendiente activación', active: 'Activo' };
  if (!enabled) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{l.disabled}</span>;
  if (status === 'FORCE_CHANGE_PASSWORD') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{l.pending}</span>;
  if (status === 'CONFIRMED') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{l.active}</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{status}</span>;
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

interface InviteStrings {
  titleCreated: string; titleNew: string; subCreated: string; subNew: string;
  successMsg: string; emailLabel: string; passLabel: string; copyPass: string;
  warning: string; closeBtn: string; emailField: string; emailPh: string;
  nameLabel: string; namePh: string; roleLabel: string; coursesLabel: string;
  coursesHint: string; cancelBtn: string; inviteBtn: string; emailRequired: string;
  roleStudent: string; roleEvaluator: string; roleAdmin: string;
}

function InviteModal({ onClose, onCreated, courses, strings }: {
  onClose: () => void;
  onCreated: (u: AppUser) => void;
  courses: { id: string; title: string }[];
  strings: InviteStrings;
}) {
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
      // Unwrap { data: {...} } envelope from Lambda
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
        {!created && (<><div className="space-y-3">
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
        </div></>)}

      </div>
    </div>
  );
}

// ─── Role selector dropdown (portal-based to escape overflow:hidden) ─────────

function RoleSelector({ user, onChange, labels }: { user: AppUser; onChange: (role: UserRole) => void; labels?: Record<UserRole, string> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const l = labels ?? { STUDENT: 'Estudiante', EVALUATOR: 'Evaluador', ADMIN: 'Admin' };

  const roles: { value: UserRole; label: string }[] = [
    { value: 'STUDENT', label: l.STUDENT },
    { value: 'EVALUATOR', label: l.EVALUATOR },
    { value: 'ADMIN', label: l.ADMIN },
  ];

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.right - 140, width: rect.width });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const dropdown = open ? (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 140, zIndex: 9999 }}
      className="bg-white border border-border rounded-xl shadow-xl overflow-hidden animate-fade-in"
    >
      {roles.map((r) => (
        <button
          key={r.value}
          onClick={() => { onChange(r.value); setOpen(false); }}
          className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium hover:bg-surface transition-colors text-left ${user.role === r.value ? 'bg-surface' : ''}`}
        >
          {user.role === r.value
            ? <Check className="w-3 h-3 text-cta-from shrink-0" />
            : <span className="w-3 shrink-0" />}
          <RoleBadge role={r.value} />
        </button>
      ))}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs font-medium text-gray-600 hover:border-gray-400 hover:bg-surface transition-all"
      >
        <RoleBadge role={user.role} />
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </>
  );
}

// ─── Confirm delete dialog ────────────────────────────────────────────────────

function ConfirmDelete({ email, onConfirm, onCancel, strings }: { email: string; onConfirm: () => void; onCancel: () => void; strings?: { title: string; subtitle: string; msg: (e: string) => string; confirmBtn: string; cancelBtn: string } }) {
  const s = strings ?? { title: 'Eliminar usuario', subtitle: 'Esta acción no se puede deshacer', msg: (e: string) => `¿Estás seguro de que deseas eliminar a ${e}? El usuario perderá acceso inmediatamente.`, confirmBtn: 'Eliminar', cancelBtn: 'Cancelar' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-charcoal text-sm">{s.title}</h3>
            <p className="text-xs text-gray-400">{s.subtitle}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600" dangerouslySetInnerHTML={{ __html: s.msg(email).replace(email, `<strong class="text-charcoal">${email}</strong>`) }} />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel} className="flex-1" size="sm">{s.cancelBtn}</Button>
          <Button variant="danger" onClick={onConfirm} className="flex-1" size="sm">{s.confirmBtn}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Import Modal ───────────────────────────────────────────────────────

function BulkImportModal({ onClose, onDone, courses }: { onClose: () => void; onDone: () => void; courses: { id: string; title: string }[] }) {
  const [csv, setCsv] = useState('');
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [role, setRole] = useState<'STUDENT' | 'EVALUATOR'>('STUDENT');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: { email: string; reason: string }[]; total: number } | null>(null);

  const rowCount = csv.trim() ? csv.split(/\r?\n/).filter(l => l.trim() && !l.toLowerCase().startsWith('email')).length : 0;

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csv.trim()) return;
    setLoading(true);
    try {
      const res = await api.admin.users.bulkImport({ csv, courseIds: selectedCourses, role });
      setResult((res as any).data ?? res);
      onDone();
    } catch (err: any) {
      alert(err?.body?.error ?? 'Error al importar. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCourse = (id: string) =>
    setSelectedCourses((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
              <Upload className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-charcoal text-base">Importar estudiantes por CSV</h2>
              <p className="text-xs text-gray-400">Hasta 100 usuarios por importación</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {result ? (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-emerald-50 rounded-xl p-3">
                <p className="font-bold text-2xl text-emerald-600">{result.created}</p>
                <p className="text-xs text-emerald-700 mt-0.5">Creados</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3">
                <p className="font-bold text-2xl text-amber-600">{result.skipped}</p>
                <p className="text-xs text-amber-700 mt-0.5">Ya existían</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <p className="font-bold text-2xl text-red-600">{result.errors.length}</p>
                <p className="text-xs text-red-700 mt-0.5">Errores</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500">Errores:</p>
                {result.errors.map((err, i) => (
                  <div key={i} className="flex items-center gap-2 bg-red-50 rounded-lg px-3 py-2">
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span className="text-xs text-red-700 font-medium">{err.email}</span>
                    <span className="text-xs text-red-500">— {err.reason}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={onClose} className="btn-primary w-full">Cerrar</button>
          </div>
        ) : (
          <form onSubmit={handleImport} className="p-6 space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600">CSV — una fila por usuario</label>
              <p className="text-xs text-gray-400">Formato: <code className="bg-surface px-1 rounded">email,nombre</code> (nombre opcional). Puedes pegar directo desde Excel.</p>
              <textarea
                className="w-full h-36 text-sm border border-border rounded-xl p-3 font-mono resize-none focus:outline-none focus:border-cta-from"
                placeholder={'juan@empresa.com,Juan García\nana@empresa.com,Ana López\npedro@empresa.com'}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                required
              />
              {rowCount > 0 && <p className="text-xs text-gray-400">{rowCount} fila{rowCount !== 1 ? 's' : ''} detectada{rowCount !== 1 ? 's' : ''}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600">Rol</label>
              <div className="flex gap-2">
                {(['STUDENT', 'EVALUATOR'] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRole(r)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-all ${role === r ? 'border-cta-from bg-blue-50 text-cta-from' : 'border-border text-gray-500 hover:border-gray-300'}`}>
                    {r === 'STUDENT' ? 'Estudiante' : 'Evaluador'}
                  </button>
                ))}
              </div>
            </div>

            {courses.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600">Inscribir en cursos <span className="font-normal text-gray-400">(opcional)</span></label>
                <div className="max-h-36 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                  {courses.map((c) => (
                    <label key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface cursor-pointer">
                      <input type="checkbox" checked={selectedCourses.includes(c.id)} onChange={() => toggleCourse(c.id)} className="w-3.5 h-3.5 accent-cta-from" />
                      <span className="text-sm text-charcoal">{c.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
              <button type="submit" disabled={loading || !csv.trim()} className="btn-primary flex-1 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {loading ? 'Importando...' : `Importar${rowCount > 0 ? ` ${rowCount}` : ''}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { t, lang } = useLanguage();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'ALL'>('ALL');
  const [showInvite, setShowInvite] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [actionLoading, setActionLoading] = useState<string>(''); // username being acted on

  const load = () => {
    setLoading(true);
    Promise.all([
      api.admin.users.list(),
      api.admin.courses.list(),
    ])
      .then(([usersRes, coursesRes]: any[]) => {
        setUsers(Array.isArray(usersRes) ? usersRes : (usersRes?.data ?? []));
        const allCourses = Array.isArray(coursesRes) ? coursesRes : (coursesRes?.data ?? []);
        setCourses(allCourses.map((c: any) => ({ id: c.id, title: c.title })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleRoleChange = async (user: AppUser, newRole: UserRole) => {
    if (newRole === user.role) return;
    setActionLoading(user.username);
    try {
      await api.admin.users.changeRole(user.username, newRole);
      setUsers((prev) => prev.map((u) => u.username === user.username ? { ...u, role: newRole } : u));
    } catch (e: any) {
      alert(e?.body?.error ?? 'Error al cambiar rol');
    } finally {
      setActionLoading('');
    }
  };

  const handleToggleStatus = async (user: AppUser) => {
    setActionLoading(user.username);
    try {
      const newEnabled = !user.enabled;
      await api.admin.users.setStatus(user.username, newEnabled);
      setUsers((prev) => prev.map((u) => u.username === user.username ? { ...u, enabled: newEnabled } : u));
    } catch (e: any) {
      alert(e?.body?.error ?? 'Error al cambiar estado');
    } finally {
      setActionLoading('');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.username);
    try {
      await api.admin.users.delete(deleteTarget.username);
      setUsers((prev) => prev.filter((u) => u.username !== deleteTarget.username));
      setDeleteTarget(null);
    } catch (e: any) {
      alert(e?.body?.error ?? 'Error al eliminar usuario');
    } finally {
      setActionLoading('');
    }
  };

  const filtered = users.filter((u) => {
    const matchesSearch = search === '' ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  // Stats
  const stats = {
    total: users.length,
    students: users.filter((u) => u.role === 'STUDENT').length,
    evaluators: users.filter((u) => u.role === 'EVALUATOR').length,
    admins: users.filter((u) => u.role === 'ADMIN').length,
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading font-bold text-2xl text-charcoal">{t.admin.usersPageTitle}</h1>
          <p className="text-gray-500 mt-1 text-sm">{t.admin.usersPageSubtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowBulkImport(true)} size="sm">
            <Upload className="w-4 h-4" />
            Importar CSV
          </Button>
          <Button onClick={() => setShowInvite(true)} size="sm">
            <UserPlus className="w-4 h-4" />
            {t.admin.inviteUserBtn}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t.admin.statTotalUsers, value: stats.total, color: 'text-charcoal', bg: 'bg-surface' },
          { label: t.admin.statStudents, value: stats.students, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: t.admin.statEvaluators, value: stats.evaluators, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: t.admin.statAdmins, value: stats.admins, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map((s) => (
          <div key={s.label} className={`card ${s.bg} text-center py-4`}>
            <p className={`font-bold text-2xl font-heading ${s.color}`}>{loading ? '—' : s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder={t.admin.searchByEmailName}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="flex bg-surface rounded-xl p-1 gap-1 shrink-0">
          {(['ALL', 'STUDENT', 'EVALUATOR', 'ADMIN'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                roleFilter === r ? 'bg-white shadow-sm text-charcoal' : 'text-gray-500 hover:text-charcoal'
              }`}
            >
              {r === 'ALL' ? t.admin.filterAllUsers : r === 'STUDENT' ? t.admin.filterStudents : r === 'EVALUATOR' ? t.admin.filterEvaluators : t.admin.filterAdmins}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="card h-16 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-heading font-bold text-charcoal">{t.admin.noUsersFound}</p>
          <p className="text-gray-500 text-sm mt-1">
            {t.admin.noUsersMsg(search !== '' || roleFilter !== 'ALL')}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">{t.admin.colUser}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{t.admin.colRole}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{t.admin.colStatus}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{t.admin.colRegistered}</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">{t.admin.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((user) => {
                  const busy = actionLoading === user.username;
                  return (
                    <tr key={user.username} className={`hover:bg-surface/50 transition-colors ${busy ? 'opacity-60' : ''}`}>
                      {/* User */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-xs shrink-0">
                            {(user.name || user.email || '?')[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            {user.name && <p className="font-medium text-charcoal text-sm truncate">{user.name}</p>}
                            <p className={`text-gray-500 truncate ${user.name ? 'text-xs' : 'text-sm font-medium text-charcoal'}`}>{user.email}</p>
                          </div>
                        </div>
                      </td>
                      {/* Role */}
                      <td className="px-4 py-3.5">
                        <RoleSelector user={user} onChange={(r) => handleRoleChange(user, r)} labels={{ STUDENT: t.admin.roleStudentLabel, EVALUATOR: t.admin.roleEvaluatorLabel, ADMIN: t.admin.roleAdminLabel }} />
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <StatusBadge status={user.status} enabled={user.enabled} labels={{ disabled: t.admin.statusDisabled, pending: t.admin.statusPendingActivation, active: t.admin.statusActiveLabel }} />
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3.5 text-xs text-gray-400">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      {/* Actions */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 justify-end">
                          {/* Enable / disable toggle */}
                          <button
                            onClick={() => handleToggleStatus(user)}
                            disabled={busy}
                            title={user.enabled ? t.admin.deactivateUser : t.admin.activateUser}
                            className="p-1.5 rounded-lg hover:bg-surface transition-colors text-gray-400 hover:text-charcoal disabled:opacity-40"
                          >
                            {user.enabled
                              ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                              : <ToggleLeft className="w-5 h-5" />}
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => setDeleteTarget(user)}
                            disabled={busy}
                            title={t.admin.deleteUserBtn}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-gray-300 hover:text-red-500 disabled:opacity-40"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-border">
            {filtered.map((user) => {
              const busy = actionLoading === user.username;
              return (
                <div key={user.username} className={`p-4 space-y-3 ${busy ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-cta-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {(user.name || user.email || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      {user.name && <p className="font-medium text-charcoal text-sm">{user.name}</p>}
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                    </div>
                    <StatusBadge status={user.status} enabled={user.enabled} />
                  </div>
                  <div className="flex items-center justify-between">
                    <RoleSelector user={user} onChange={(r) => handleRoleChange(user, r)} />
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleToggleStatus(user)} disabled={busy} className="p-1.5 rounded-lg hover:bg-surface transition-colors">
                        {user.enabled ? <ToggleRight className="w-5 h-5 text-emerald-500" /> : <ToggleLeft className="w-5 h-5 text-gray-400" />}
                      </button>
                      <button onClick={() => setDeleteTarget(user)} disabled={busy} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-gray-300 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      {showInvite && (
        <InviteModal
          onClose={() => { setShowInvite(false); load(); }}
          onCreated={(u) => setUsers((prev) => [u, ...prev])}
          courses={courses}
          strings={{
            titleCreated: t.admin.inviteModalTitleCreated,
            titleNew: t.admin.inviteModalTitleNew,
            subCreated: t.admin.inviteModalSubCreated,
            subNew: t.admin.inviteModalSubNew,
            successMsg: t.admin.inviteCreatedSuccess,
            emailLabel: t.admin.inviteEmailLabel,
            passLabel: t.admin.inviteTempPassLabel,
            copyPass: t.admin.inviteCopyPassword,
            warning: t.admin.inviteWarning,
            closeBtn: t.admin.inviteCloseBtn,
            emailField: t.admin.inviteEmailFieldLabel,
            emailPh: t.admin.inviteEmailPlaceholder,
            nameLabel: t.admin.inviteNameLabel,
            namePh: t.admin.inviteNamePlaceholder,
            roleLabel: t.admin.inviteRoleLabel,
            coursesLabel: t.admin.inviteCoursesLabel,
            coursesHint: t.admin.inviteCoursesHint,
            cancelBtn: t.admin.inviteCancelBtn,
            inviteBtn: t.admin.inviteBtn,
            emailRequired: t.admin.inviteEmailRequired,
            roleStudent: t.admin.roleStudentLabel,
            roleEvaluator: t.admin.roleEvaluatorLabel,
            roleAdmin: t.admin.roleAdminLabel,
          }}
        />
      )}
      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onDone={load}
          courses={courses}
        />
      )}
      {deleteTarget && (
        <ConfirmDelete
          email={deleteTarget.email}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          strings={{
            title: t.admin.deleteUserModalTitle,
            subtitle: t.admin.deleteUserModalSubtitle,
            msg: t.admin.deleteUserModalMsg,
            confirmBtn: t.admin.deleteUserConfirmBtn,
            cancelBtn: t.admin.deleteUserCancelBtn,
          }}
        />
      )}
    </div>
  );
}
