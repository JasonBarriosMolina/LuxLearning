'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Lock, ChevronLeft, ChevronRight, Sparkles, Loader2, X, Plus, RefreshCw, AlertCircle, Calendar, Settings2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { WeeklyGrid } from './_components/WeeklyGrid';
import type { StudyPlan, BedrockSuggestion } from './types';

const SUGGESTION_TYPE_ICON: Record<string, string> = {
  article: '📄', video: '🎥', exercise: '🏋️', book: '📚', strategy: '💡',
};

function AddItemModal({
  weekOf, dayIndex, onSave, onClose,
}: {
  weekOf: string; dayIndex: number; onSave: (item: any) => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const ts = t.studyPlan;
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('custom');
  const [desc, setDesc] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await api.studyPlan.addItem(weekOf, { dayIndex, title: title.trim(), type, description: desc || undefined, estimatedMinutes: minutes });
      onSave((res as any)?.data?.item ?? (res as any)?.item);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1A1A2E] rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">{ts.addItemTitle}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{ts.addItemName}</label>
            <input
              className="w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-[#17527E]/30 outline-none"
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Repasar capítulo 3"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{ts.addItemType}</label>
              <select
                className="w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-sm text-gray-900 dark:text-white outline-none"
                value={type} onChange={(e) => setType(e.target.value)}
              >
                {Object.entries(ts.types).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{ts.addItemTime}</label>
              <input type="number" min={5} max={240} step={5}
                className="w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-sm text-gray-900 dark:text-white outline-none"
                value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{ts.addItemDesc}</label>
            <textarea rows={2}
              className="w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-sm text-gray-900 dark:text-white outline-none resize-none"
              value={desc} onChange={(e) => setDesc(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 dark:border-white/10 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={submit} disabled={!title.trim() || saving}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-[#00B4D8] to-[#7B2FBE] text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Agregar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudyPlanPage() {
  const { t } = useLanguage();
  const ts = t.studyPlan;

  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<BedrockSuggestion[]>([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState<'none' | 'processing' | 'done' | 'error'>('none');
  const [changeNote, setChangeNote] = useState('');
  const [requestingSent, setRequestingSent] = useState(false);
  const [addModal, setAddModal] = useState<{ weekOf: string; dayIndex: number } | null>(null);
  const [hoursPerDay, setHoursPerDay] = useState<1 | 2 | 3>(2);
  const [showSettings, setShowSettings] = useState(false);
  const [exportingIcs, setExportingIcs] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load preferences on mount
  useEffect(() => {
    api.studyPlan.preferences.get().then((res: any) => {
      const h = (res as any)?.data?.hoursPerDay ?? (res as any)?.hoursPerDay;
      if (h && [1, 2, 3].includes(h)) setHoursPerDay(h as 1 | 2 | 3);
    }).catch(() => {});
  }, []);

  const saveHoursPerDay = async (h: 1 | 2 | 3) => {
    setHoursPerDay(h);
    await api.studyPlan.preferences.save({ hoursPerDay: h }).catch(() => {});
  };

  const handleExportIcs = async () => {
    setExportingIcs(true);
    try {
      const res: any = await api.studyPlan.exportIcs();
      const data = res?.data ?? res;
      if (!data?.ics) return;
      const blob = new Blob([data.ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename ?? 'plan.ics';
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* non-fatal */ } finally { setExportingIcs(false); }
  };

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, currentRes] = await Promise.all([
        api.studyPlan.list(4),
        api.studyPlan.current(),
      ]);
      const list: StudyPlan[] = (listRes as any)?.data ?? [];
      const current: StudyPlan = (currentRes as any)?.data;
      // Merge: put current at front, remove duplicate
      const merged = [current, ...list.filter((p) => p.weekOf !== current.weekOf)].filter(Boolean);
      setPlans(merged);
      setSelectedIdx(0);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  // Poll suggestions for current plan
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const current = plans[0];
    if (!current) return;
    if (current.suggestionsStatus === 'done') {
      setSuggestions(current.bedrockSuggestions ?? []);
      setSuggestionsStatus('done');
      return;
    }
    if (current.suggestionsStatus === 'processing') {
      setSuggestionsStatus('processing');
      pollRef.current = setInterval(async () => {
        try {
          const res: any = await api.studyPlan.suggestions();
          const d = res?.data ?? res;
          setSuggestionsStatus(d.status);
          if (d.status === 'done') {
            setSuggestions(d.suggestions ?? []);
            if (pollRef.current) clearInterval(pollRef.current);
          } else if (d.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch { if (pollRef.current) clearInterval(pollRef.current); }
      }, 4000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [plans]);

  const activePlan = plans[selectedIdx];
  const isLocked = !!(activePlan?.lockedBy);
  const isCurrentWeek = selectedIdx === 0;

  const handleTogglePin = async (weekOf: string, itemId: string, pinned: boolean) => {
    await api.studyPlan.toggleItem(weekOf, itemId, { pinned }).catch(() => {});
    setPlans((prev) => prev.map((p) => p.weekOf !== weekOf ? p : {
      ...p, days: p.days.map((d) => ({ ...d, items: d.items.map((i) => i.id === itemId ? { ...i, pinned } : i) })),
    }));
  };

  const handleToggleDone = async (weekOf: string, itemId: string, done: boolean) => {
    await api.studyPlan.toggleItem(weekOf, itemId, { completed: done }).catch(() => {});
    setPlans((prev) => prev.map((p) => p.weekOf !== weekOf ? p : {
      ...p, days: p.days.map((d) => ({ ...d, items: d.items.map((i) => i.id === itemId ? { ...i, completed: done } : i) })),
    }));
  };

  const handleRemove = async (weekOf: string, itemId: string) => {
    await api.studyPlan.removeItem(weekOf, itemId).catch(() => {});
    setPlans((prev) => prev.map((p) => p.weekOf !== weekOf ? p : {
      ...p, days: p.days.map((d) => ({ ...d, items: d.items.filter((i) => i.id !== itemId) })),
    }));
  };

  const handleAddItem = (weekOf: string, dayIndex: number) => setAddModal({ weekOf, dayIndex });

  const handleItemAdded = (weekOf: string, dayIndex: number, item: any) => {
    setAddModal(null);
    setPlans((prev) => prev.map((p) => p.weekOf !== weekOf ? p : {
      ...p, days: p.days.map((d, i) => i !== dayIndex ? d : { ...d, items: [...d.items, item] }),
    }));
  };

  const retrySuggestions = useCallback(async () => {
    setSuggestionsStatus('processing');
    setSuggestions([]);
    try {
      // Backend auto-retries when status === 'error' on GET /study-plan/current
      await api.studyPlan.current();
      // Start polling
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const res: any = await api.studyPlan.suggestions();
          const d = res?.data ?? res;
          setSuggestionsStatus(d.status);
          if (d.status === 'done') {
            setSuggestions(d.suggestions ?? []);
            if (pollRef.current) clearInterval(pollRef.current);
          } else if (d.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch { if (pollRef.current) clearInterval(pollRef.current); }
      }, 4000);
    } catch {
      setSuggestionsStatus('error');
    }
  }, []);

  const handleRequestChange = async () => {
    if (!activePlan) return;
    await api.studyPlan.requestChange(activePlan.weekOf, changeNote || undefined).catch(() => {});
    setRequestingSent(true);
    setPlans((prev) => prev.map((p) => p.weekOf !== activePlan.weekOf ? p : { ...p, changeRequested: true }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#17527E]" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gray-900 dark:text-white">{ts.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{ts.subtitle}</p>
        </div>
        {/* Week selector */}
        {plans.length > 1 && (
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIdx((i) => Math.min(plans.length - 1, i + 1))} disabled={selectedIdx >= plans.length - 1}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-40 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-[140px] text-center">
              {activePlan ? ts.weekOf(new Date(activePlan.weekOf + 'T00:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })) : ''}
              {selectedIdx === 0 && <span className="ml-1 text-xs text-[#17527E] dark:text-blue-300 font-medium">(actual)</span>}
            </span>
            <button onClick={() => setSelectedIdx((i) => Math.max(0, i - 1))} disabled={selectedIdx === 0}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-40 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Settings strip — hours per day + ICS export */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Configurar plan
        </button>
        <button
          onClick={handleExportIcs}
          disabled={exportingIcs}
          className="flex items-center gap-1.5 text-xs font-medium text-[#17527E] dark:text-blue-300 hover:underline disabled:opacity-50 transition-colors"
        >
          {exportingIcs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
          Exportar a calendario (.ics)
        </button>
        {showSettings && (
          <div className="w-full flex items-center gap-3 mt-1 p-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl">
            <Settings2 className="w-4 h-4 text-gray-400 shrink-0" />
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 shrink-0">
              Horas de estudio por día:
            </label>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => saveHoursPerDay(h)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    hoursPerDay === h
                      ? 'bg-[#17527E] text-white'
                      : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 ml-auto hidden sm:block">
              Usado al generar tu plan semanal automáticamente
            </p>
          </div>
        )}
      </div>

      {/* Lock banner */}
      {activePlan && isLocked && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-4 py-3">
          <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{ts.locked}</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{ts.lockedHint}</p>
          </div>
          {!activePlan.changeRequested && isCurrentWeek && (
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="text" placeholder={ts.requestChangeNote}
                className="text-xs border border-amber-200 dark:border-amber-700/40 rounded-lg px-2 py-1.5 bg-white dark:bg-amber-900/30 text-gray-700 dark:text-amber-200 outline-none w-40"
                value={changeNote} onChange={(e) => setChangeNote(e.target.value)}
              />
              <button onClick={handleRequestChange}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg transition-colors">
                {ts.requestChange}
              </button>
            </div>
          )}
          {(activePlan.changeRequested || requestingSent) && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">{ts.changeRequested} ✓</span>
          )}
        </div>
      )}

      {/* Grid */}
      {activePlan ? (
        <WeeklyGrid
          plan={activePlan}
          locked={isLocked}
          onTogglePin={handleTogglePin}
          onToggleDone={handleToggleDone}
          onRemove={handleRemove}
          onAddItem={handleAddItem}
        />
      ) : (
        <div className="text-center py-20 text-gray-400">
          <p>{ts.noActiveCourses}</p>
        </div>
      )}

      {/* Mentor Suggestions — current week only */}
      {isCurrentWeek && (
        <div className="bg-gradient-to-br from-[#7B2FBE]/5 to-[#17527E]/5 border border-[#7B2FBE]/20 dark:border-[#7B2FBE]/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-[#7B2FBE]" />
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">{ts.suggestions}</h2>
          </div>
          {suggestionsStatus === 'none' ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-400 flex-1">{ts.suggestionsEmpty}</p>
              <button
                onClick={retrySuggestions}
                className="flex items-center gap-1.5 text-xs font-medium text-[#7B2FBE] hover:underline shrink-0"
              >
                <RefreshCw className="w-3 h-3" /> {(ts as any).suggestionsRetry}
              </button>
            </div>
          ) : suggestionsStatus === 'processing' ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin text-[#7B2FBE]" /> {ts.suggestionsLoading}
            </div>
          ) : suggestionsStatus === 'error' ? (
            <div className="flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-gray-400 flex-1">{(ts as any).suggestionsError}</p>
              <button
                onClick={retrySuggestions}
                className="flex items-center gap-1.5 text-xs font-medium text-[#7B2FBE] hover:underline shrink-0"
              >
                <RefreshCw className="w-3 h-3" /> {(ts as any).suggestionsRetry}
              </button>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-400 flex-1">{ts.suggestionsEmpty}</p>
              <button
                onClick={retrySuggestions}
                className="flex items-center gap-1.5 text-xs font-medium text-[#7B2FBE] hover:underline shrink-0"
              >
                <RefreshCw className="w-3 h-3" /> {(ts as any).suggestionsRetry}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Resources (articles, videos, books, exercises) */}
              {suggestions.filter((s) => s.type !== 'strategy').map((s, i) => (
                <div key={i} className="flex items-start gap-3 bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 px-4 py-3">
                  <span className="text-base shrink-0 mt-0.5">{SUGGESTION_TYPE_ICON[s.type] ?? '💡'}</span>
                  <div className="flex-1 min-w-0">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-semibold text-[#17527E] dark:text-blue-300 hover:underline leading-snug block">
                        {s.title} ↗
                      </a>
                    ) : (
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-snug">{s.title}</p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{s.description}</p>
                  </div>
                </div>
              ))}
              {/* Strategies — full-width advice style */}
              {suggestions.filter((s) => s.type === 'strategy').length > 0 && (
                <div className="mt-1 space-y-2">
                  <p className="text-[10px] font-semibold text-[#7B2FBE] uppercase tracking-widest px-1">Consejo de Mentor</p>
                  {suggestions.filter((s) => s.type === 'strategy').map((s, i) => (
                    <div key={i} className="flex items-start gap-3 bg-[#7B2FBE]/5 dark:bg-[#7B2FBE]/10 rounded-xl border border-[#7B2FBE]/15 px-4 py-3">
                      <span className="text-base shrink-0 mt-0.5">💡</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-snug">{s.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{s.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add item modal */}
      {addModal && (
        <AddItemModal
          weekOf={addModal.weekOf}
          dayIndex={addModal.dayIndex}
          onSave={(item) => handleItemAdded(addModal.weekOf, addModal.dayIndex, item)}
          onClose={() => setAddModal(null)}
        />
      )}
    </div>
  );
}
