'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { Users, ChevronDown, ChevronUp, Loader2, BookOpen, X, CheckSquare, Square } from 'lucide-react';

interface GroupSummary {
  groupId: string;
  group: {
    id: string;
    name: string;
    description?: string;
    _count?: { members: number };
  };
}

interface Member {
  userId: string;
  name?: string;
  email?: string;
  enrolledCourseIds: string[];
  enrollments?: string[]; // all enrolled course IDs (from evaluator's courses)
}

interface Course {
  id: string;
  title: string;
}

export default function EvaluatorGroupsPage() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersMap, setMembersMap] = useState<Record<string, Member[]>>({});
  const [loadingMembers, setLoadingMembers] = useState<string | null>(null);
  const [myCourses, setMyCourses] = useState<Course[]>([]);

  // Enroll modal
  const [enrollModal, setEnrollModal] = useState<{ groupId: string; members: Member[] } | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [groupData, courseData] = await Promise.all([
          api.evaluator.groups.list(),
          api.evaluator.myCourses(),
        ]);
        setGroups(groupData.groups ?? groupData);
        setMyCourses((courseData.courses ?? courseData).filter((c: any) => c.isActive));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const toggleGroup = useCallback(async (groupId: string) => {
    if (expandedId === groupId) {
      setExpandedId(null);
      return;
    }
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

  const openEnrollModal = (groupId: string) => {
    const members = membersMap[groupId] ?? [];
    setEnrollModal({ groupId, members });
    setSelectedCourseId('');
    setSelectedUserIds([]);
  };

  const handleCourseSelect = (courseId: string) => {
    setSelectedCourseId(courseId);
    // pre-select students NOT already enrolled in this course
    const members = enrollModal?.members ?? [];
    const preSelected = members
      .filter((m) => !(m.enrolledCourseIds ?? []).includes(courseId))
      .map((m) => m.userId);
    setSelectedUserIds(preSelected);
  };

  const handleEnroll = async () => {
    if (!enrollModal || !selectedCourseId || selectedUserIds.length === 0) return;
    setEnrolling(true);
    try {
      await api.evaluator.groups.enroll(enrollModal.groupId, {
        userIds: selectedUserIds,
        courseId: selectedCourseId,
      });
      // refresh members
      setLoadingMembers(enrollModal.groupId);
      const data = await api.evaluator.groups.members(enrollModal.groupId);
      setMembersMap((prev) => ({ ...prev, [enrollModal.groupId]: data.members ?? data }));
      setLoadingMembers(null);
      setEnrollModal(null);
    } catch (e: any) {
      alert(e.message ?? 'Error al inscribir');
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Grupos Base</h1>
        <p className="text-sm text-gray-500 mt-1">Grupos de estudiantes asignados a ti para inscribir en tus cursos</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No tienes grupos asignados</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ group }) => {
            const isExpanded = expandedId === group.id;
            const members = membersMap[group.id] ?? [];
            const isLoadingM = loadingMembers === group.id;

            return (
              <div key={group.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 dark:text-white">{group.name}</p>
                    {group.description && <p className="text-sm text-gray-500 mt-0.5">{group.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">{group._count?.members ?? 0} estudiante{(group._count?.members ?? 0) !== 1 ? 's' : ''}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700 p-4">
                    {isLoadingM ? (
                      <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center mb-3">
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{members.length} estudiante{members.length !== 1 ? 's' : ''}</p>
                          <button
                            onClick={() => openEnrollModal(group.id)}
                            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700"
                          >
                            <BookOpen className="w-3.5 h-3.5" /> Inscribir al curso
                          </button>
                        </div>
                        {members.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">Sin estudiantes en este grupo</p>
                        ) : (
                          <div className="space-y-2">
                            {members.map((m) => (
                              <div key={m.userId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 text-xs font-bold flex-shrink-0">
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

      {/* Enroll modal */}
      {enrollModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Inscribir estudiantes al curso</h2>
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
                {myCourses.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>

            {selectedCourseId && (
              <div className="flex-1 overflow-y-auto">
                <p className="text-sm font-medium mb-2">Estudiantes a inscribir</p>
                <div className="space-y-1">
                  {enrollModal.members.map((m) => {
                    const alreadyEnrolled = (m.enrolledCourseIds ?? []).includes(selectedCourseId);
                    const checked = selectedUserIds.includes(m.userId);
                    return (
                      <button
                        key={m.userId}
                        disabled={alreadyEnrolled}
                        onClick={() => !alreadyEnrolled && setSelectedUserIds(checked ? selectedUserIds.filter((x) => x !== m.userId) : [...selectedUserIds, m.userId])}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
                          alreadyEnrolled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        {alreadyEnrolled ? (
                          <CheckSquare className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : checked ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.name ?? m.userId}</p>
                          {m.email && <p className="text-xs text-gray-400 truncate">{m.email}</p>}
                          {alreadyEnrolled && <p className="text-xs text-green-600">Ya inscrito</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setEnrollModal(null)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button
                onClick={handleEnroll}
                disabled={enrolling || !selectedCourseId || selectedUserIds.length === 0}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {enrolling && <Loader2 className="w-4 h-4 animate-spin" />}
                Inscribir ({selectedUserIds.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
