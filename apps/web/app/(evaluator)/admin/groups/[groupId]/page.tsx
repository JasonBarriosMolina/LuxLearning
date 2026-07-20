'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowLeft, Plus, Trash2, Users, UserCheck, X, Search, Loader2, CheckSquare, Square } from 'lucide-react';

type Tab = 'members' | 'evaluators';

interface Member {
  userId: string;
  addedAt: string;
  enrolledCourseIds: string[];
  name?: string;
  email?: string;
}

interface Evaluator {
  evaluatorId: string;
  assignedAt: string;
  name?: string;
  email?: string;
}

interface CognitoUser {
  username: string;
  name?: string;
  email?: string;
  role?: string;
}

export default function AdminGroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [allUsers, setAllUsers] = useState<CognitoUser[]>([]);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(true);

  // Add members modal
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);

  // Remove member modal
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const [selectedUnenroll, setSelectedUnenroll] = useState<string[]>([]);
  const [courseNames, setCourseNames] = useState<Record<string, string>>({});

  // Add evaluator modal
  const [showAddEval, setShowAddEval] = useState(false);
  const [evalSearch, setEvalSearch] = useState('');
  const [addingEval, setAddingEval] = useState(false);

  // Remove evaluator
  const [removingEval, setRemovingEval] = useState<string | null>(null);

  const loadGroup = useCallback(async () => {
    setLoading(true);
    try {
      const [membersData, evalsData] = await Promise.all([
        api.admin.groups.members(groupId),
        api.admin.groups.evaluators(groupId),
      ]);
      setMembers(membersData.members ?? membersData);
      setEvaluators(evalsData.evaluators ?? evalsData);
      if (membersData.groupName) setGroupName(membersData.groupName);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { loadGroup(); }, [loadGroup]);

  const openAddMembers = async () => {
    if (allUsers.length === 0) {
      const data = await api.admin.users.list();
      const users: CognitoUser[] = (data.users ?? data).filter((u: any) => u.role === 'STUDENT' || u.groups?.includes('STUDENT'));
      setAllUsers(users);
    }
    setSelectedUserIds([]);
    setMemberSearch('');
    setShowAddMembers(true);
  };

  const handleAddMembers = async () => {
    if (selectedUserIds.length === 0) return;
    setAddingMembers(true);
    try {
      await api.admin.groups.addMembers(groupId, { userIds: selectedUserIds });
      setShowAddMembers(false);
      loadGroup();
    } finally {
      setAddingMembers(false);
    }
  };

  const openRemoveMember = async (member: Member) => {
    setRemovingMember(member);
    setSelectedUnenroll([]);
    if (member.enrolledCourseIds.length > 0 && Object.keys(courseNames).length === 0) {
      try {
        const data = await api.admin.courses.list();
        const map: Record<string, string> = {};
        (data.courses ?? data).forEach((c: any) => { map[c.id] = c.title; });
        setCourseNames(map);
      } catch {}
    }
  };

  const handleRemoveMember = async () => {
    if (!removingMember) return;
    try {
      await api.admin.groups.removeMember(groupId, removingMember.userId, { unenrollCourseIds: selectedUnenroll });
      setRemovingMember(null);
      loadGroup();
    } catch (e: any) {
      alert(e.message ?? 'Error al eliminar');
    }
  };

  const openAddEval = async () => {
    if (allUsers.length === 0) {
      const data = await api.admin.users.list();
      setAllUsers(data.users ?? data);
    }
    setEvalSearch('');
    setShowAddEval(true);
  };

  const handleAddEvaluator = async (evaluatorId: string) => {
    setAddingEval(true);
    try {
      await api.admin.groups.addEvaluator(groupId, { evaluatorId });
      setShowAddEval(false);
      loadGroup();
    } finally {
      setAddingEval(false);
    }
  };

  const handleRemoveEvaluator = async (evaluatorId: string) => {
    try {
      await api.admin.groups.removeEvaluator(groupId, evaluatorId);
      setRemovingEval(null);
      loadGroup();
    } catch (e: any) {
      alert(e.message ?? 'Error al eliminar');
    }
  };

  const currentMemberIds = new Set(members.map((m) => m.userId));

  const filteredStudents = allUsers
    .filter((u) => {
      const isStudent = (u as any).role === 'STUDENT' || (u as any).groups?.includes('STUDENT');
      if (!isStudent) return false;
      if (currentMemberIds.has(u.username)) return false;
      if (!memberSearch) return true;
      const q = memberSearch.toLowerCase();
      return (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q);
    });

  const currentEvalIds = new Set(evaluators.map((e) => e.evaluatorId));

  const filteredEvaluators = allUsers.filter((u) => {
    const isEval = (u as any).role === 'EVALUATOR' || (u as any).groups?.includes('EVALUATOR');
    if (!isEval) return false;
    if (currentEvalIds.has(u.username)) return false;
    if (!evalSearch) return true;
    const q = evalSearch.toLowerCase();
    return (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/admin/groups')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{groupName || 'Grupo'}</h1>
          <p className="text-sm text-gray-500">Gestión de miembros y evaluadores</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {(['members', 'evaluators'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'members' ? <Users className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
            {t === 'members' ? `Estudiantes (${members.length})` : `Evaluadores (${evaluators.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : tab === 'members' ? (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">{members.length} estudiante{members.length !== 1 ? 's' : ''} en el grupo</p>
            <button onClick={openAddMembers} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Agregar estudiantes
            </button>
          </div>
          {members.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin estudiantes en este grupo</p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.userId} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold text-sm flex-shrink-0">
                    {(m.name ?? m.userId)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{m.name ?? m.userId}</p>
                    {m.email && <p className="text-xs text-gray-400 truncate">{m.email}</p>}
                    {m.enrolledCourseIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.enrolledCourseIds.map((cid) => (
                          <span key={cid} className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                            {courseNames[cid] ?? cid.slice(0, 8)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => openRemoveMember(m)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">{evaluators.length} evaluador{evaluators.length !== 1 ? 'es' : ''} asignado{evaluators.length !== 1 ? 's' : ''}</p>
            <button onClick={openAddEval} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Asignar evaluador
            </button>
          </div>
          {evaluators.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <UserCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin evaluadores asignados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {evaluators.map((ev) => (
                <div key={ev.evaluatorId} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 font-semibold text-sm flex-shrink-0">
                    {(ev.name ?? ev.evaluatorId)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{ev.name ?? ev.evaluatorId}</p>
                    {ev.email && <p className="text-xs text-gray-400 truncate">{ev.email}</p>}
                  </div>
                  <button onClick={() => setRemovingEval(ev.evaluatorId)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add members modal */}
      {showAddMembers && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Agregar estudiantes</h2>
              <button onClick={() => setShowAddMembers(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Buscar por nombre o email..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {filteredStudents.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No hay más estudiantes para agregar</p>
              ) : (
                filteredStudents.map((u) => {
                  const checked = selectedUserIds.includes(u.username);
                  return (
                    <button
                      key={u.username}
                      onClick={() => setSelectedUserIds(checked ? selectedUserIds.filter((x) => x !== u.username) : [...selectedUserIds, u.username])}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                    >
                      {checked ? <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" /> : <Square className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{u.name ?? u.username}</p>
                        {u.email && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAddMembers(false)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button
                onClick={handleAddMembers}
                disabled={addingMembers || selectedUserIds.length === 0}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {addingMembers && <Loader2 className="w-4 h-4 animate-spin" />}
                Agregar ({selectedUserIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove member modal */}
      {removingMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-2">Quitar estudiante</h2>
            <p className="text-sm text-gray-500 mb-4">
              ¿Seguro que deseas quitar a <strong>{removingMember.name ?? removingMember.userId}</strong> del grupo?
            </p>
            {removingMember.enrolledCourseIds.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Este estudiante fue inscrito a estos cursos desde el grupo. ¿Des-inscribir también?</p>
                <div className="space-y-1">
                  {removingMember.enrolledCourseIds.map((cid) => {
                    const checked = selectedUnenroll.includes(cid);
                    return (
                      <button
                        key={cid}
                        onClick={() => setSelectedUnenroll(checked ? selectedUnenroll.filter((x) => x !== cid) : [...selectedUnenroll, cid])}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      >
                        {checked ? <CheckSquare className="w-4 h-4 text-red-500 flex-shrink-0" /> : <Square className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                        <span className="text-sm">{courseNames[cid] ?? cid}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setRemovingMember(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button onClick={handleRemoveMember} className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700">Quitar</button>
            </div>
          </div>
        </div>
      )}

      {/* Add evaluator modal */}
      {showAddEval && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl flex flex-col max-h-[70vh]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Asignar evaluador</h2>
              <button onClick={() => setShowAddEval(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Buscar evaluador..."
                value={evalSearch}
                onChange={(e) => setEvalSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {filteredEvaluators.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No hay más evaluadores disponibles</p>
              ) : (
                filteredEvaluators.map((u) => (
                  <button
                    key={u.username}
                    onClick={() => handleAddEvaluator(u.username)}
                    disabled={addingEval}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left disabled:opacity-50"
                  >
                    <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 text-sm font-semibold flex-shrink-0">
                      {(u.name ?? u.username)[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.name ?? u.username}</p>
                      {u.email && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remove evaluator confirm */}
      {removingEval && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-bold mb-2">¿Quitar evaluador?</h2>
            <p className="text-sm text-gray-500 mb-5">El evaluador perderá acceso a este grupo. Los estudiantes ya inscritos en sus cursos no se verán afectados.</p>
            <div className="flex gap-2">
              <button onClick={() => setRemovingEval(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button onClick={() => handleRemoveEvaluator(removingEval)} className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700">Quitar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
