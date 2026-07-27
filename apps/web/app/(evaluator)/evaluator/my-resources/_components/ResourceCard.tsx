'use client';

import { Pencil, Trash2, RotateCcw, Loader2, Link2 } from 'lucide-react';
import { FolderBreadcrumb } from './FolderBreadcrumb';

export interface Resource {
  evaluatorId: string;
  resourceId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  folder?: string;
  courseIds: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Course { id: string; title: string; isArchived?: boolean; }

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileIcon(fileType: string) {
  if (fileType.includes('pdf')) return '📄';
  if (fileType.includes('word') || fileType.includes('docx')) return '📝';
  if (fileType.includes('ppt') || fileType.includes('presentation')) return '📊';
  if (fileType.includes('excel') || fileType.includes('sheet')) return '📈';
  if (fileType.includes('image')) return '🖼️';
  if (fileType.includes('video')) return '🎬';
  if (fileType.includes('zip') || fileType.includes('rar')) return '🗜️';
  return '📁';
}

interface Props {
  resource: Resource;
  courses: Course[];
  courseIdFilter: string | null;
  courseFilter: string;
  deleting: string | null;
  restoring: string | null;
  viewFileLabel: string;
  onEdit: (r: Resource) => void;
  onDelete: (r: Resource) => void;
  onRestore: (r: Resource) => void;
}

export function ResourceCard({
  resource: r, courses, courseIdFilter, courseFilter,
  deleting, restoring, viewFileLabel,
  onEdit, onDelete, onRestore,
}: Props) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{fileIcon(r.fileType)}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-charcoal text-sm truncate">{r.title}</p>
          {r.description && <p className="text-xs text-gray-500 line-clamp-2">{r.description}</p>}
          <p className="text-xs text-gray-400 mt-0.5">
            {r.fileName} {formatSize(r.fileSize) && `· ${formatSize(r.fileSize)}`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!r.archived ? (
            <>
              <button onClick={() => onEdit(r)} className="p-1.5 rounded-lg hover:bg-surface text-gray-400 hover:text-charcoal transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onDelete(r)}
                disabled={deleting === r.resourceId}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
              >
                {deleting === r.resourceId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </>
          ) : (
            <button
              onClick={() => onRestore(r)}
              disabled={restoring === r.resourceId}
              className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors disabled:opacity-50"
            >
              {restoring === r.resourceId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
      {r.folder && <FolderBreadcrumb folder={r.folder} />}
      {!courseIdFilter && courseFilter === 'all' && r.courseIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.courseIds.map((cid) => {
            const c = courses.find((x) => x.id === cid);
            return c ? <span key={cid} className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">✓ {c.title}</span> : null;
          })}
        </div>
      )}
      <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
        <Link2 className="w-3 h-3" /> {viewFileLabel}
      </a>
    </div>
  );
}
