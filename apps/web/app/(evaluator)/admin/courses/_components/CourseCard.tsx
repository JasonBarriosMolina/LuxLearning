'use client';

import Link from 'next/link';
import {
  Pencil,
  Trash2,
  ArrowRight,
  Tag,
  X,
  Loader2,
  RefreshCw,
  UserCircle,
  FolderOpen,
  ClipboardList,
  Users,
  CalendarDays,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface CourseCardProps {
  course: any;
  regeneratingCourse: string | null;
  onEdit: (course: any) => void;
  onRegenerate: (courseId: string) => void;
  onEvalModal: (courseId: string, courseName: string) => void;
  onPublish: (courseId: string) => void;
  onRestore: (courseId: string) => void;
  onArchive: (courseId: string) => void;
  onDelete: (courseId: string) => void;
  onStatusChange: (courseId: string, status: 'active' | 'inactive' | 'archived' | 'draft') => void;
  t: any;
}

export function CourseCard({
  course,
  regeneratingCourse,
  onEdit,
  onRegenerate,
  onEvalModal,
  onPublish,
  onRestore,
  onArchive,
  onDelete,
  onStatusChange,
  t,
}: CourseCardProps) {
  return (
    <div className={`card flex items-center gap-4 ${course.isArchived ? 'opacity-70' : ''}`}>
      {/* Status indicator */}
      <div
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          course.isArchived
            ? 'bg-gray-300'
            : course.isDraft
            ? 'bg-yellow-400'
            : course.isActive
            ? 'bg-emerald-500'
            : 'bg-gray-300'
        }`}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-charcoal truncate mb-0.5">{course.title}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={course.isArchived ? 'archived' : course.isDraft ? 'draft' : course.isActive ? 'active' : 'inactive'}
            onChange={(e) => onStatusChange(course.id, e.target.value as any)}
            onClick={(e) => e.stopPropagation()}
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer appearance-none pr-5 bg-no-repeat
              ${course.isArchived ? 'bg-gray-100 text-gray-600' : course.isDraft ? 'bg-yellow-100 text-yellow-700' : course.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`, backgroundPosition: 'right 6px center', backgroundSize: '8px 5px' }}
          >
            <option value="active">{t.admin.courseActive ?? 'Activo'}</option>
            <option value="inactive">{t.admin.courseInactive ?? 'Inactivo'}</option>
            <option value="draft">{t.admin.statusDraft ?? 'Borrador'}</option>
            <option value="archived">{t.admin.statusArchived ?? 'Archivado'}</option>
          </select>
          {course.isPilot && <Badge variant="info">{t.admin.coursePilot}</Badge>}
          {course.isLegacy && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {t.admin.statusLegacy}
            </span>
          )}
          <span className="text-xs text-gray-500">{t.admin.modulesCount(course.modules?.length ?? 0)}</span>

          {/* Creator */}
          {course.createdByName && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <User className="w-2.5 h-2.5" />
              {course.createdByName}
            </span>
          )}

          {/* Evaluator assigned */}
          {course.evaluatorName && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-teal-50 text-teal-700 font-medium">
              <UserCircle className="w-2.5 h-2.5" />
              {course.evaluatorName}
            </span>
          )}

          {/* Creation date */}
          {course.createdAt && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <CalendarDays className="w-2.5 h-2.5" />
              {new Date(course.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}

          {course.tags?.map((tag: string) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600 font-medium"
            >
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {course.isArchived ? (
          <>
            <Link
              href={`/evaluator/my-resources?courseId=${course.id}`}
              className="p-2 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
              title="Recursos del curso"
            >
              <FolderOpen className="w-4 h-4" />
            </Link>
            <button
              onClick={() => onRestore(course.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-600 border border-border hover:bg-surface transition-colors"
            >
              {t.admin.restoreBtn}
            </button>
          </>
        ) : (
          <>
            {course.isDraft && (
              <button
                onClick={() => onPublish(course.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
              >
                {t.admin.publishBtn}
              </button>
            )}
            <Link
              href={`/admin/courses/${course.id}`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-cta-from hover:bg-blue-50 transition-colors"
            >
              {t.admin.editContent} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href={`/evaluator/my-resources?courseId=${course.id}`}
              className="p-2 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
              title="Recursos del curso"
            >
              <FolderOpen className="w-4 h-4" />
            </Link>
            <Link
              href={`/evaluator/reflections?courseId=${course.id}`}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors"
              title="Ver reflexiones de este curso"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              {course.pendingReflections > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 rounded-full">
                  {course.pendingReflections}
                </span>
              )}
            </Link>
            <Link
              href={`/evaluator/students?courseId=${course.id}`}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-teal-600 hover:bg-teal-50 transition-colors"
              title="Ver estudiantes de este curso"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Estudiantes</span>
            </Link>
            <button
              onClick={() => onEdit(course)}
              className="p-2 rounded-lg text-gray-400 hover:text-charcoal hover:bg-surface transition-colors"
              title={t.admin.editInfo}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => onRegenerate(course.id)}
              disabled={regeneratingCourse === course.id}
              className="p-2 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors disabled:opacity-50"
              title={t.admin.regenAI}
            >
              {regeneratingCourse === course.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => onEvalModal(course.id, course.title)}
              className="p-2 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
              title={
                course.evaluatorName
                  ? `${t.admin.assignEvaluatorPrefix}: ${course.evaluatorName}`
                  : t.admin.assignEvaluator
              }
            >
              <UserCircle className={`w-4 h-4 ${course.evaluatorName ? 'text-teal-500' : ''}`} />
            </button>
            {!course.isDraft && (
              <button
                onClick={() => onArchive(course.id)}
                className="p-2 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition-colors"
                title={t.admin.archiveBtn}
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => onDelete(course.id)}
              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title={t.admin.deleteBtn}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
