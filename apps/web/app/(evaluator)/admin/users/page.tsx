'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Users, UserPlus, Search, Shield, GraduationCap, ClipboardCheck,
  ToggleLeft, ToggleRight, Trash2, ChevronDown, Mail, X, Check, AlertTriangle, Copy, CheckCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

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

function RoleBadge({ role }: { role: UserRole }) {
  const map: Record<UserRole, { label: string; className: string; icon: React.ReactNode }> = {
    ADMIN: { label: 'Admin', className: 'bg-purple-100 text-purple-700', icon: <Shield className="w-3 h-3" /> },
    EVALUATOR: { label: 'Evaluador', className: 'bg-blue-100 text-blue-700', icon: <ClipboardCheck className="w-3 h-3" /> },
    STUDENT: { label: 'Estudiante', className: 'bg-emerald-100 text-emerald-700', icon: <GraduationCap className="w-3 h-3" /> },
  };
  const { label, className, icon } = map[role];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {icon}{label}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">Desactivado</span>;
  if (status === 'FORCE_CHANGE_PASSWORD') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Pendiente activación</span>;
  if (status === 'CONFIRMED') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Activo</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{status}</span>;
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ onClose, onCreated, courses }: {
  onClose: () => void;
  onCreated: (u: AppUser) => void;
  courses: { id: string; title: string }[];
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
    if (!email.trim()) { setError('El email es requerido'); return; }
    setLoading(true); setError('');
    try {
      const res: any = await api.admin.users.invite({
        email: email.trim(),
        role,
        name: name.trim() || undefined,
        courseIds: selectedCourses.length > 0 ? selectedCourses : undefined,
      });
      onCreated(res as AppUser);
      setCreated({ email: email.trim(), temporaryPassword: res.temporaryPassword ?? '' });
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
                {created ? 'Usuario creado' : 'Invitar usuario'}
              </h2>
              <p className="text-xs text-gray-400">
                {created ? 'Comparte las credenciales con el usuario' : 'El usuario deberá cambiar la contraseña al primer ingreso'}
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
                <p className="text-sm font-semibold">Cuenta creada exitosamente</p>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Correo electrónico</p>
                  <p className="font-medium text-charcoal">{created.email}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Contraseña temporal</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-1.5 font-mono text-sm text-charcoal font-bold tracking-wider">
                      {created.temporaryPassword}
                    </code>
                    <button
                      onClick={copyPassword}
                      className="p-2 rounded-lg border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50 transition-colors"
                      title="Copiar contraseña"
                    >
                      {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ Comparte esta contraseña con el usuario. Deberá cambiarla en su primer inicio de sesión.
              </p>
            </div>
            <Button className="w-full" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        )}


        {/* Fields */}
        {!created && (<><div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Email *</label>
            <Input
              type="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              leftIcon={<Mail className="w-4 h-4" />}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Nombre completo</label>
            <Input
              placeholder="Nombre del usuario"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Rol</label>
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
                  {r === 'STUDENT' ? 'Estudiante' : r === 'EVALUATOR' ? 'Evaluador' : 'Admin'}
                </button>
              ))}
            </div>
          </div>

          {courses.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Cursos asignados <span className="font-normal text-gray-400">(opcional — sin selección ve todos)</span>
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
          <Button variant="secondary" onClick={onClose} className="flex-1" size="sm">Cancelar</Button>
          <Button onClick={submit} loading={loading} className="flex-1" size="sm">
            <UserPlus className="w-4 h-4" />
            Invitar
          </Button>
        </div></>)}

      </div>
    </div>
  );
}

// ─── Role selector dropdown (portal-based to escape overflow:hidden) ─────────

function RoleSelector({ user, onChange }: { user: AppUser; onChange: (role: UserRole) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const roles: { value: UserRole; label: string }[] = [
    { value: 'STUDENT', label: 'Estudiante' },
    { value: 'EVALUATOR', label: 'Evaluador' },
    { value: 'ADMIN', label: 'Admin' },
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

function ConfirmDelete({ email, onConfirm, onCancel }: { email: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-charcoal text-sm">Eliminar usuario</h3>
            <p className="text-xs text-gray-400">Esta acción no se puede deshacer</p>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          ¿Estás seguro de que deseas eliminar a <strong className="text-charcoal">{email}</strong>?
          El usuario perderá acceso inmediatamente.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel} className="flex-1" size="sm">Cancelar</Button>
          <Button variant="danger" onClick={onConfirm} className="flex-1" size="sm">Eliminar</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'ALL'>('ALL');
  const [showInvite, setShowInvite] = useState(false);
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
          <h1 className="font-heading font-bold text-2xl text-charcoal">Gestión de Usuarios</h1>
          <p className="text-gray-500 mt-1 text-sm">Invita, edita roles y gestiona el acceso de los usuarios</p>
        </div>
        <Button onClick={() => setShowInvite(true)} size="sm">
          <UserPlus className="w-4 h-4" />
          Invitar usuario
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total usuarios', value: stats.total, color: 'text-charcoal', bg: 'bg-surface' },
          { label: 'Estudiantes', value: stats.students, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Evaluadores', value: stats.evaluators, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Admins', value: stats.admins, color: 'text-purple-600', bg: 'bg-purple-50' },
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
            placeholder="Buscar por email o nombre..."
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
              {r === 'ALL' ? 'Todos' : r === 'STUDENT' ? 'Estudiantes' : r === 'EVALUATOR' ? 'Evaluadores' : 'Admins'}
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
          <p className="font-heading font-bold text-charcoal">Sin resultados</p>
          <p className="text-gray-500 text-sm mt-1">
            {search || roleFilter !== 'ALL' ? 'Ningún usuario coincide con el filtro.' : 'Todavía no hay usuarios registrados.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Usuario</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Rol</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Registrado</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Acciones</th>
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
                        <RoleSelector user={user} onChange={(r) => handleRoleChange(user, r)} />
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <StatusBadge status={user.status} enabled={user.enabled} />
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3.5 text-xs text-gray-400">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      {/* Actions */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 justify-end">
                          {/* Enable / disable toggle */}
                          <button
                            onClick={() => handleToggleStatus(user)}
                            disabled={busy}
                            title={user.enabled ? 'Desactivar usuario' : 'Activar usuario'}
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
                            title="Eliminar usuario"
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
          onClose={() => setShowInvite(false)}
          onCreated={(u) => setUsers((prev) => [u, ...prev])}
          courses={courses}
        />
      )}
      {deleteTarget && (
        <ConfirmDelete
          email={deleteTarget.email}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
