'use client';

import { useEffect, useState } from 'react';
import {
  Users, UserPlus, Search, ToggleLeft, ToggleRight, Trash2, Upload, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';
import { RoleBadge, UserRole } from './_components/RoleBadge';
import { StatusBadge } from './_components/StatusBadge';
import { RoleSelector, AppUser } from './_components/RoleSelector';
import { InviteModal } from './_components/InviteModal';
import { ConfirmDeleteDialog } from './_components/ConfirmDeleteDialog';
import { BulkImportModal } from './_components/BulkImportModal';

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
  const [actionLoading, setActionLoading] = useState<string>('');

  const load = () => {
    setLoading(true);
    Promise.all([api.admin.users.list(), api.admin.courses.list()])
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

  const stats = {
    total:      users.length,
    students:   users.filter((u) => u.role === 'STUDENT').length,
    evaluators: users.filter((u) => u.role === 'EVALUATOR').length,
    admins:     users.filter((u) => u.role === 'ADMIN').length,
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
          { label: t.admin.statTotalUsers,  value: stats.total,      color: 'text-charcoal',    bg: 'bg-surface' },
          { label: t.admin.statStudents,    value: stats.students,   color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: t.admin.statEvaluators,  value: stats.evaluators, color: 'text-blue-600',    bg: 'bg-blue-50' },
          { label: t.admin.statAdmins,      value: stats.admins,     color: 'text-purple-600',  bg: 'bg-purple-50' },
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
                      <td className="px-4 py-3.5">
                        <RoleSelector
                          user={user}
                          onChange={(r) => handleRoleChange(user, r)}
                          labels={{ STUDENT: t.admin.roleStudentLabel, EVALUATOR: t.admin.roleEvaluatorLabel, ADMIN: t.admin.roleAdminLabel }}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge
                          status={user.status}
                          enabled={user.enabled}
                          labels={{ disabled: t.admin.statusDisabled, pending: t.admin.statusPendingActivation, active: t.admin.statusActiveLabel }}
                        />
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-400">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 justify-end">
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
        <ConfirmDeleteDialog
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
