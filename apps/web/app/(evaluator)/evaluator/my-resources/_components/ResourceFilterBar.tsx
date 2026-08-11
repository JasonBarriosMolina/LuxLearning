'use client';

import { BookOpen, Calendar, FileType2, X } from 'lucide-react';

interface Course { id: string; title: string; isArchived?: boolean; }

const FILE_TYPES = [
  { key: 'all',   label: 'Todos' },
  { key: 'pdf',   label: '📄 PDF' },
  { key: 'video', label: '🎬 Video' },
  { key: 'image', label: '🖼️ Imagen' },
  { key: 'doc',   label: '📝 Documento' },
  { key: 'ppt',   label: '📊 Presentación' },
  { key: 'sheet', label: '📈 Hoja de cálculo' },
  { key: 'other', label: '📁 Otro' },
];

const DATE_FILTERS = [
  { key: 'all',   label: 'Todo' },
  { key: 'week',  label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
];

interface Props {
  courses: Course[];
  courseIdFilter: string | null;
  courseFilter: string;
  dateFilter: 'all' | 'week' | 'month';
  typeFilter: string;
  activeFiltersCount: number;
  onCourseChange: (id: string) => void;
  onDateChange: (key: 'all' | 'week' | 'month') => void;
  onTypeChange: (key: string) => void;
  onClearFilters: () => void;
}

export function ResourceFilterBar({
  courses, courseIdFilter, courseFilter, dateFilter, typeFilter, activeFiltersCount,
  onCourseChange, onDateChange, onTypeChange, onClearFilters,
}: Props) {
  return (
    <div className="card p-4 space-y-3">
      {/* Row 1: Curso + Fecha */}
      <div className="flex flex-wrap gap-3 items-center">
        {!courseIdFilter && (
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={courseFilter}
              onChange={(e) => onCourseChange(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-charcoal focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="all">Todos los cursos</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="flex gap-1">
            {DATE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => onDateChange(f.key as 'all' | 'week' | 'month')}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${dateFilter === f.key ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {activeFiltersCount > 0 && (
          <button onClick={onClearFilters} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 ml-auto">
            <X className="w-3.5 h-3.5" /> Limpiar filtros ({activeFiltersCount})
          </button>
        )}
      </div>

      {/* Row 2: File type */}
      <div className="flex items-center gap-2 flex-wrap">
        <FileType2 className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="flex flex-wrap gap-1">
          {FILE_TYPES.map((f) => (
            <button
              key={f.key}
              onClick={() => onTypeChange(f.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${typeFilter === f.key ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-indigo-200'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
