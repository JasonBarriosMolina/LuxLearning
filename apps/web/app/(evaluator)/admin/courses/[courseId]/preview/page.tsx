'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, PlayCircle, ChevronDown, ChevronRight, Lightbulb, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCourseDuration } from '@/lib/utils';
import { TextToSpeechButton } from '@/components/shared/TextToSpeechButton';

export default function CoursePreviewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());
  const [selectedLesson, setSelectedLesson] = useState<any>(null);

  useEffect(() => {
    api.admin.courses.get(courseId).then((res) => {
      const c = (res as any).data;
      setCourse(c);
      // Auto-expand first module and select its first lesson
      if (c?.modules?.length > 0) {
        const first = c.modules[0];
        setExpandedMods(new Set([first.id]));
        if (first.lessons?.length > 0) setSelectedLesson(first.lessons[0]);
      }
    }).finally(() => setLoading(false));
  }, [courseId]);

  const toggleMod = (id: string) => {
    setExpandedMods((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-4 animate-pulse pt-4">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="grid grid-cols-[280px_1fr] gap-6">
          <div className="space-y-3">{[1,2,3].map((n) => <div key={n} className="h-16 bg-gray-100 rounded-xl" />)}</div>
          <div className="h-96 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!course) return null;

  const allLessons = (course.modules ?? []).flatMap((m: any) => m.lessons ?? []);

  return (
    <div className="max-w-6xl mx-auto space-y-4 animate-fade-in pb-12">
      {/* Banner */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
        <span className="font-semibold">📚 Vista de Estudiante — modo solo lectura</span>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver al editor
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* ── Left panel: module/lesson navigator ── */}
        <div className="space-y-2 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto lg:pr-1">
          <div className="mb-3">
            <h2 className="font-heading font-bold text-lg text-charcoal">{course.title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {course.modules?.length ?? 0} módulos · {allLessons.length} lecciones
            </p>
          </div>

          {(course.modules ?? []).map((mod: any) => (
            <div key={mod.id} className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => toggleMod(mod.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-white text-left hover:bg-surface transition-colors"
              >
                {expandedMods.has(mod.id)
                  ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-400">MÓD. {mod.order}</p>
                  <p className="text-sm font-semibold text-charcoal truncate">{mod.title}</p>
                  <p className="text-xs text-gray-400">{mod.lessons?.length ?? 0} lecciones · {formatCourseDuration(mod.duration)}</p>
                </div>
              </button>

              {expandedMods.has(mod.id) && (
                <div className="border-t border-border bg-surface divide-y divide-border">
                  {(mod.lessons ?? []).map((lesson: any, idx: number) => (
                    <button
                      key={lesson.id}
                      onClick={() => setSelectedLesson(lesson)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        selectedLesson?.id === lesson.id
                          ? 'bg-cta-from/10 border-l-2 border-cta-from'
                          : 'hover:bg-white/60'
                      }`}
                    >
                      <PlayCircle className={`w-3.5 h-3.5 shrink-0 ${selectedLesson?.id === lesson.id ? 'text-cta-from' : 'text-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${selectedLesson?.id === lesson.id ? 'text-cta-from' : 'text-charcoal'}`}>
                          {idx + 1}. {lesson.title}
                        </p>
                        {lesson.duration && (
                          <p className="text-xs text-gray-400">{formatCourseDuration(lesson.duration)}</p>
                        )}
                      </div>
                    </button>
                  ))}
                  {(!mod.lessons || mod.lessons.length === 0) && (
                    <p className="text-xs text-gray-400 text-center py-3">Sin lecciones</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Right panel: lesson content ── */}
        <div className="space-y-5">
          {selectedLesson ? (
            <>
              {/* Lesson title + TTS */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <h3 className="font-heading font-bold text-xl text-charcoal flex-1">{selectedLesson.title}</h3>
                {selectedLesson.duration && (
                  <span className="text-xs text-gray-400 shrink-0 mt-1">{formatCourseDuration(selectedLesson.duration)}</span>
                )}
              </div>

              {/* TTS */}
              {(selectedLesson.content || selectedLesson.points?.length > 0) && (
                <TextToSpeechButton
                  text={[
                    selectedLesson.content ? selectedLesson.content.replace(/<[^>]+>/g, ' ') : '',
                    ...(selectedLesson.points ?? []),
                    selectedLesson.tip ?? '',
                  ].join(' ')}
                  audioUrl={selectedLesson.audioUrl}
                />
              )}

              {/* YouTube embed */}
              {selectedLesson.youtubeId && (
                <div className="aspect-video rounded-xl overflow-hidden bg-black shadow-sm">
                  <iframe
                    src={`https://www.youtube.com/embed/${selectedLesson.youtubeId}`}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}

              {/* Image */}
              {selectedLesson.imageUrl && !selectedLesson.youtubeId && (
                <img src={selectedLesson.imageUrl} alt={selectedLesson.title} className="w-full rounded-xl object-cover max-h-64" />
              )}

              {/* HTML content */}
              {selectedLesson.content && (
                <div
                  className="prose prose-sm max-w-none text-charcoal leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: selectedLesson.content }}
                />
              )}

              {/* Key points */}
              {selectedLesson.points?.filter((p: string) => p).length > 0 && (
                <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" /> Puntos clave
                  </p>
                  <ul className="space-y-2">
                    {selectedLesson.points.filter((p: string) => p).map((p: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-charcoal">
                        <span className="w-5 h-5 rounded-full bg-blue-200 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tip */}
              {selectedLesson.tip && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                  <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Consejo</p>
                    <p className="text-sm text-amber-800">{selectedLesson.tip}</p>
                  </div>
                </div>
              )}

              {/* Navigation prev/next */}
              {allLessons.length > 1 && (() => {
                const idx = allLessons.findIndex((l: any) => l.id === selectedLesson.id);
                const prev = allLessons[idx - 1];
                const next = allLessons[idx + 1];
                return (
                  <div className="flex justify-between gap-3 pt-4 border-t border-border">
                    {prev ? (
                      <button onClick={() => setSelectedLesson(prev)} className="flex items-center gap-1.5 text-sm text-cta-from hover:underline">
                        <ChevronRight className="w-4 h-4 rotate-180" /> {prev.title}
                      </button>
                    ) : <span />}
                    {next && (
                      <button onClick={() => setSelectedLesson(next)} className="flex items-center gap-1.5 text-sm text-cta-from hover:underline ml-auto">
                        {next.title} <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center gap-3 text-gray-400">
              <PlayCircle className="w-12 h-12 text-gray-200" />
              <p className="text-sm">Selecciona una lección en el panel izquierdo para previsualizarla</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
