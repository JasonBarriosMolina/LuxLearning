'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import {
  Users, ChevronDown, ChevronUp, Loader2, BookOpen, X,
  CheckSquare, Square, Plus, Pencil, Trash2, Search,
} from 'lucide-react';

const COLOR_PALETTE = [
  '#17527E', '#7C3AED', '#059669', '#DC2626',
  '#D97706', '#0891B2', '#BE185D', '#374151',
];

interface Group {
  id: string;
  name: string;
  description?: string;
  color: string;
  source: 'admin' | 'own';
  memberCount: number;
}

interface Member {
  userId: string;
  name?: string;
  email?: string;
  enrolledCourseIds: string[];
}

interface PoolStudent {
  userId: string;
  name: string;
  email: string;
}

interface Course {
  id: string;
  title: string;
}

export default function EvaluatorGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersMap, setMembersMap] = useState<Record<string, Member[]>>({});
  const [loadingMembers, setLoadingMembers] = useState<string | null>(null);
  const [myCourses, setMyCourses] = useState<Course[]>([]);
  const [pool, setPool] = useState<PoolStudent[]>([]);

  // Create / edit modal
  const [groupModal, setGroupModal] = useState<{ mode: 'create' | 'edit'; group?: Group } | null>(null);
  const [gForm, setGForm] = useState({ name: '', description: '', color: COLOR_PALETTE[0] });
  const [savingGroup, setSavingGroup] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Add members modal
  const [addMembersGroup, setAddMembersGroup] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedPool, setSelectedPool] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);

  // Remove member confirm
  const [removingMember, setRemovingMember] = useState<{ groupId: string; member: Member } | null>(null);

  // Enroll modal
  const [enrollModal, setEnrollModal] = useState<{ groupId: string; members: Member[] } | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedEnrollIds, setSelectedEnrollIds] = useState<string[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.evaluator.groups.list();
      setGroups(data.groups ?? data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
    api.evaluator.myCourses().then((res: any) => {
      const list = Array.isArray(res) ? res : (res?.courses ?? res?.data ?? []);
      setMyCourses(list.filter((c: any) => c.isActive).map((c: any) => ({ id: c.id ?? c.courseId, title: c.title })));
    }).catch(() => {});
    api.evaluator.groups.studentPool().then((res: any) => {
      setPool(Array.isArray(res) ? res : (res?.students ?? []));
    }).catch(() => {});
  }, [loadGroups]);

  const toggleGroup = useCallback(async (groupId: string) => {
    if (expandedId === groupId) { setExpandedId(null); return; }
    setExpandedId(groupId);
    if (!membersMap[groupId]) {
      setLoadingMembers(groupId);
      try {
        const data = await api.evaluator.groups.members(groupId);
        setMembersMap((prev) => ({ ...prev, [groupId]: data.members ?? data }));
      } finally {
        setLoadingMembers(null);
      }
    }
  }, [expandedId, membersMap]);

  const openCreate = () => {
    setGForm({ name: '', description: '', color: COLOR_PALETTE[0] });
    setGroupModal({ mode: 'create' });
  };

  const openEdit = (g: Group) => {
    setGForm({ name: g.name, description: g.description ?? '', color: g.color ?? COLOR_PALETTE[0] });
    setGroupModal({ mode: 'edit', group: g });
  };

  const handleSaveGroup = async () => {
    if (!gForm.name.trim()) return;
    setSavingGroup(true);
    try {
      if (groupModal?.mode === 'create') {
        await api.evaluator.groups.create({ name: gForm.name.trim(), description: gForm.description.trim() || undefined, color: gForm.color });
      } else if (groupModal?.group) {
        await api.evaluator.groups.update(groupModal.group.id, { name: gForm.name.trim(), description: gForm.description.trim() || undefined, color: gForm.color });
      }
      setGroupModal(null);
      loadGroups();
    } catch (e: any) {
      alert(e.message ?? 'Error al guardar el grupo');
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await api.evaluator.groups.delete(id);
      setDeleteId(null);
      loadGroups();
    } catch (e: any) {
      alert(e.message ?? 'Error al eliminar');
    }
  };

  const openAddMembers = (groupId: string) => {
    setSelectedPool([]);
    setMemberSearch('');
    setAddMembersGroup(groupId);
  };

  const handleAddMembers = async () => {
    if (!addMembersGroup || selectedPool.length === 0) return;
    setAddingMembers(true);
    try {
      await api.evaluator.groups.addMembers(addMembersGroup, { userIds: selectedPool });
      const data = await api.evaluator.groups.members(addMembersGroup);
      setMembersMap((prev) => ({ ...prev, [addMembersGroup]: data.members ?? data }));
      setAddMembersGroup(null);
      loadGroups();
    } catch (e: any) {
      alert(e.message ?? 'Error al agregar miembros');
    } finally {
      setAddingMembers(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!removingMember) return;
    const { groupId, member } = removingMember;
    try {
      await api.evaluator.groups.removeMember(groupId, member.userId);
      setMembersMap((prev) => ({ ...prev, [groupId]: (prev[groupId] ?? []).filter((m) => m.userId !== member.userId) }));
      setRemovingMember(null);
    } catch (e: any) {
      alert(e.message ?? 'Error al quitar miembro');
    }
  };

  const openEnrollModal = (groupId: string) => {
    const members = membersMap[groupId] ?? [];
    setEnrollModal({ groupId, members });
    setSelectedCourseId('');
    setSelectedEnrollIds([]);
  };

  const handleCourseSelect = (courseId: string) => {
    setSelectedCourseId(courseId);
    const members = enrollModal?.members ?? [];
    setSelectedEnrollIds(members.filter((m) => !(m.enrolledCourseIds ?? []).includes(courseId)).map((m) => m.userId));
  };

  const handleEnroll = async () => {
    if (!enrollModal || !selectedCourseId || selectedEnrollIds.length === 0) return;
    setEnrolling(true);
    try {
      await api.evaluator.groups.enroll(enrollModal.groupId, { userIds: selectedEnrollIds, courseId: selectedCourseId });
      const data = await api.evaluator.groups.members(enrollModal.groupId);
      setMembersMap((prev) => ({ ...prev, [enrollModal.groupId]: data.members ?? data }));
      setEnrollModal(null);
    } catch (e: any) {
      alert(e.message ?? 'Error al inscribir');
    } finally {
      setEnrolling(false);
    }
  };

  const filteredPool = pool.filter((s) => {
    const existing = new Set((membersMap[addMembersGroup ?? ''] ?? []).map((m) => m.userId));
    if (existing.has(s.userId)) return false;
    if (!memberSearch) return true;
    const q = memberSearch.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Grupos Base</h1>
          <p className="text-sm text-gray-500 mt-1">Grupos asignados y propios para organizar estudiantes</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> Crear grupo
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No tienes grupos asignados ni propios</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const isExpanded = expandedId === group.id;
            const members = membersMap[group.id] ?? [];
            const isOwn = group.source === 'own';

            return (
              <div key={group.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  {/* Color badge */}
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color ?? '#17527E' }} />
                  <button onClick={() => toggleGroup(group.id)} className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 dark:text-white">{group.name}</p>
                      {!isOwn && (
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">Asignado</span>
                      )}
                    </div>
                    {group.description && <p className="text-sm text-gray-500 mt-0.5">{group.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">{group.memberCount} estudiante{group.memberCount !== 1 ? 's' : ''}</p>
                  </button>
                  <div className="flex items-center gap-1">
                    {isOwn && (
                      <>
                        <button onClick={() => openEdit(group)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteId(group.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button onClick={() => toggleGroup(group.id)} className="p-1.5 text-gray-400">
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700 p-4">
                    {loadingMembers === group.id ? (
                      <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center mb-3">
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{members.length} estudiante{members.length !== 1 ? 's' : ''}</p>
                          <div className="flex gap-2">
                            {isOwn && (
                              <button onClick={() => openAddMembers(group.id)} className="flex items-center gap-1.5 border border-gray-300 dark:border-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700">
                                <Plus className="w-3.5 h-3.5" /> Agregar
                              </button>
                            )}
                            <button onClick={() => openEnrollModal(group.id)} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700">
                              <BookOpen className="w-3.5 h-3.5" /> Inscribir al curso
                            </button>
                          </div>
                        </div>
                        {members.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">Sin estudiantes en este grupo</p>
                        ) : (
                          <div className="space-y-2">
                            {members.map((m) => (
                              <div key={m.userId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                  style={{ backgroundColor: group.color ?? '#17527E' }}>
                                  {(m.name ?? m.userId)[0].toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{m.name ?? m.userId}</p>
                                  {m.email && <p className="text-xs text-gray-400 truncate">{m.email}</p>}
                                </div>
                                {m.enrolledCourseIds.length > 0 && (
                                  <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full flex-shrink-0">
                                    {m.enrolledCourseIds.length} curso{m.enrolledCourseIds.length !== 1 ? 's' : ''}
                                  </span>
                                )}
                                {isOwn && (
                                  <button onClick={() => setRemovingMember({ groupId: group.id, member: m })} className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg flex-shrink-0">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit group modal */}
      {groupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">{groupModal.mode === 'create' ? 'Crear grupo' : 'Editar grupo'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nombre *</label>
                <input
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ej. IIS 2026 — Grupo A"
                  value={gForm.name}
                  onChange={(e) => setGForm({ ...gForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Descripción (opcional)</label>
                <textarea
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2}
                  value={gForm.description}
                  onChange={(e) => setGForm({ ...gForm, description: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Color del grupo</label>
                <div className="flex gap-2 flex-wrap">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => setGForm({ ...gForm, color: c })}
                      className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ backgroundColor: c, borderColor: gForm.color === c ? '#000' : 'transparent' }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setGroupModal(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button
                onClick={handleSaveGroup}
                disabled={savingGroup || !gForm.name.trim()}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingGroup && <Loader2 className="w-4 h-4 animate-spin" />}
                {groupModal.mode === 'create' ? 'Crear' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete group confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-bold mb-2">¿Eliminar grupo?</h2>
            <p className="text-sm text-gray-500 mb-5">Se eliminará el grupo y sus miembros. Las inscripciones a cursos no se verán afectadas.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button onClick={() => handleDeleteGroup(deleteId)} className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700">Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Add members modal */}
      {addMembersGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Agregar estudiantes</h2>
              <button onClick={() => setAddMembersGroup(null)}><X className="w-5 h-5 text-gray-400" /></button>
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
              {filteredPool.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No hay más estudiantes disponibles</p>
              ) : (
                filteredPool.map((s) => {
                  const checked = selectedPool.includes(s.userId);
                  return (
                    <button
                      key={s.userId}
                      onClick={() => setSelectedPool(checked ? selectedPool.filter((x) => x !== s.userId) : [...selectedPool, s.userId])}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                    >
                      {checked ? <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" /> : <Square className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{s.name}</p>
                        <p className="text-xs text-gray-400 truncate">{s.email}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setAddMembersGroup(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button
                onClick={handleAddMembers}
                disabled={addingMembers || selectedPool.length === 0}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {addingMembers && <Loader2 className="w-4 h-4 animate-spin" />}
                Agregar ({selectedPool.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove member confirm */}
      {removingMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-bold mb-2">¿Quitar estudiante?</h2>
            <p className="text-sm text-gray-500 mb-5">
              ¿Seguro que deseas quitar a <strong>{removingMember.member.name ?? removingMember.member.userId}</strong> del grupo? Las inscripciones a cursos no se verán afectadas.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setRemovingMember(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button onClick={handleRemoveMember} className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700">Quitar</button>
            </div>
          </div>
        </div>
      )}

      {/* Enroll modal */}
      {enrollModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Inscribir al curso</h2>
              <button onClick={() => setEnrollModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Seleccionar curso</label>
              <select
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedCourseId}
                onChange={(e) => handleCourseSelect(e.target.value)}
              >
                <option value="">-- Selecciona un curso --</option>
                {myCourses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            {selectedCourseId && (
              <div className="flex-1 overflow-y-auto space-y-1">
                <p className="text-sm font-medium mb-2">Estudiantes a inscribir</p>
                {enrollModal.members.map((m) => {
                  const alreadyEnrolled = (m.enrolledCourseIds ?? []).includes(selectedCourseId);
                  const checked = selectedEnrollIds.includes(m.userId);
                  return (
                    <button
                      key={m.userId}
                      disabled={alreadyEnrolled}
                      onClick={() => !alreadyEnrolled && setSelectedEnrollIds(checked ? selectedEnrollIds.filter((x) => x !== m.userId) : [...selectedEnrollIds, m.userId])}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${alreadyEnrolled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                    >
                      {alreadyEnrolled ? <CheckSquare className="w-4 h-4 text-green-500 flex-shrink-0" /> : checked ? <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" /> : <Square className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{m.name ?? m.userId}</p>
                        {alreadyEnrolled && <p className="text-xs text-green-600">Ya inscrito</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEnrollModal(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button
                onClick={handleEnroll}
                disabled={enrolling || !selectedCourseId || selectedEnrollIds.length === 0}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {enrolling && <Loader2 className="w-4 h-4 animate-spin" />}
                Inscribir ({selectedEnrollIds.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
