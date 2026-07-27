'use client';

import { CheckCircle, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface AiStudent {
  username: string;
  email: string;
  name: string;
}

interface AiWizardModalProps {
  open: boolean;
  onClose: () => void;
  aiStep: 1 | 2 | 3 | 4;
  setAiStep: React.Dispatch<React.SetStateAction<1 | 2 | 3 | 4>>;
  aiMethod: 'topic' | 'url';
  setAiMethod: React.Dispatch<React.SetStateAction<'topic' | 'url'>>;
  aiInput: string;
  setAiInput: React.Dispatch<React.SetStateAction<string>>;
  aiLoading: boolean;
  aiLoadingMsg: string;
  aiResult: any;
  setAiResult: React.Dispatch<React.SetStateAction<any>>;
  aiPublishing: boolean;
  aiError: string;
  aiStudentList: AiStudent[];
  aiSelectedStudents: string[];
  setAiSelectedStudents: React.Dispatch<React.SetStateAction<string[]>>;
  aiAssigning: boolean;
  aiSuggestedTags: string[];
  aiAcceptedTags: string[];
  setAiAcceptedTags: React.Dispatch<React.SetStateAction<string[]>>;
  editingModTitle: { idx: number; value: string } | null;
  setEditingModTitle: React.Dispatch<React.SetStateAction<{ idx: number; value: string } | null>>;
  regenModIdx: number | null;
  setRegenModIdx: React.Dispatch<React.SetStateAction<number | null>>;
  onGenerate: () => void;
  onPublish: () => void;
  onAssign: () => void;
  t: any;
}

export function AiWizardModal({
  open,
  onClose,
  aiStep,
  setAiStep,
  aiMethod,
  setAiMethod,
  aiInput,
  setAiInput,
  aiLoading,
  aiLoadingMsg,
  aiResult,
  setAiResult,
  aiPublishing,
  aiError,
  aiStudentList,
  aiSelectedStudents,
  setAiSelectedStudents,
  aiAssigning,
  aiSuggestedTags,
  aiAcceptedTags,
  setAiAcceptedTags,
  editingModTitle,
  setEditingModTitle,
  regenModIdx,
  setRegenModIdx,
  onGenerate,
  onPublish,
  onAssign,
  t,
}: AiWizardModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.admin.aiWizardTitle}
      size="2xl"
      closeOnOverlay={false}
    >
      <div className="space-y-5">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  aiStep >= s
                    ? 'bg-gradient-to-br from-cta-from to-cta-to text-white'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {s}
              </div>
              {s < 4 && (
                <div className={`w-6 h-0.5 ${aiStep > s ? 'bg-cta-from' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
          <span className="ml-2 text-xs text-gray-400">
            {aiStep === 1
              ? t.admin.aiStepMethod
              : aiStep === 2
              ? t.admin.aiStepInfo
              : aiStep === 3
              ? t.admin.aiStepReview
              : t.admin.aiStepAssign}
          </span>
        </div>

        {/* Step 1 — Method */}
        {aiStep === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{t.admin.aiMethodQuestion}</p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { id: 'topic', icon: '💡', title: t.admin.aiTopicTitle, desc: t.admin.aiTopicDesc },
                  { id: 'url', icon: '🌐', title: t.admin.aiUrlTitle, desc: t.admin.aiUrlDesc },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAiMethod(opt.id)}
                  className={`text-left p-4 rounded-xl border-2 transition-colors ${
                    aiMethod === opt.id
                      ? 'border-cta-from bg-blue-50 dark:bg-blue-900/20'
                      : 'border-border hover:border-gray-300'
                  }`}
                >
                  <div className="text-2xl mb-2">{opt.icon}</div>
                  <p className="font-semibold text-charcoal text-sm">{opt.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
            <div className="p-3 rounded-xl border-2 border-dashed border-gray-200 opacity-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📄</span>
                <div>
                  <p className="font-semibold text-charcoal text-sm">{t.admin.choicePdfTitle}</p>
                  <p className="text-xs text-gray-500">{t.admin.choicePdfDesc}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setAiStep(2)}>{t.admin.aiNextBtn}</Button>
            </div>
          </div>
        )}

        {/* Step 2 — Input */}
        {aiStep === 2 && (
          <div className="space-y-4">
            {aiMethod === 'topic' ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-charcoal">{t.admin.aiTopicLabel}</label>
                <textarea
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder={t.admin.aiTopicPlaceholder}
                  className="input-field min-h-[100px] resize-y"
                  autoFocus
                />
                <p className="text-xs text-gray-400">{t.admin.aiTopicHint}</p>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-sm font-medium text-charcoal">{t.admin.aiUrlLabel}</label>
                <input
                  type="url"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder={t.admin.aiUrlPlaceholder}
                  className="input-field"
                  autoFocus
                />
                <p className="text-xs text-gray-400">{t.admin.aiUrlHint}</p>
              </div>
            )}
            {aiError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
                {aiError}
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setAiStep(1)}>
                {t.admin.aiBackBtn}
              </Button>
              <Button
                onClick={onGenerate}
                loading={aiLoading}
                leftIcon={!aiLoading ? <Sparkles className="w-4 h-4" /> : undefined}
                disabled={!aiInput.trim()}
              >
                {aiLoading ? aiLoadingMsg || t.admin.aiGenerating : t.admin.aiGenerateBtn}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — Preview */}
        {aiStep === 3 && aiResult && (
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl border border-blue-100 dark:border-blue-900/40">
              <p className="font-heading font-bold text-charcoal text-lg">{aiResult.title}</p>
              <p className="text-sm text-gray-500 mt-1">{aiResult.description}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                  {t.admin.modulesCount((aiResult.modules ?? []).length)}
                </span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {t.admin.lessonsCount(
                    (aiResult.modules ?? []).reduce(
                      (s: number, m: any) => s + (m.lessons?.length ?? 0),
                      0
                    )
                  )}
                </span>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                  {t.admin.quizQuestionsCount(
                    (aiResult.modules ?? []).reduce(
                      (s: number, m: any) => s + (m.questions?.length ?? 0),
                      0
                    )
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {(aiResult.modules ?? []).map((m: any, i: number) => (
                <div key={i} className="border border-border rounded-xl overflow-hidden">
                  {/* Module header */}
                  <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 flex items-center justify-between gap-2">
                    {editingModTitle?.idx === i ? (
                      <input
                        autoFocus
                        value={editingModTitle.value}
                        onChange={(e) => setEditingModTitle({ idx: i, value: e.target.value })}
                        onBlur={() => {
                          if (editingModTitle.value.trim()) {
                            setAiResult((prev: any) => {
                              const modules = [...(prev.modules ?? [])];
                              modules[i] = { ...modules[i], title: editingModTitle.value.trim() };
                              return { ...prev, modules };
                            });
                          }
                          setEditingModTitle(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingModTitle(null);
                        }}
                        className="input-field text-sm font-semibold py-0.5 flex-1 min-w-0"
                      />
                    ) : (
                      <p className="font-semibold text-sm text-charcoal truncate flex-1">
                        {m.order}. {m.title}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                        {(m.lessons ?? []).length} lec
                      </span>
                      <span className="text-xs bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-medium">
                        {(m.questions ?? []).length} quiz
                      </span>
                      {editingModTitle?.idx !== i && (
                        <button
                          type="button"
                          title={t.admin.editInfo}
                          onClick={() => setEditingModTitle({ idx: i, value: m.title })}
                          className="p-1 rounded text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        title={t.admin.regenAI}
                        disabled={regenModIdx !== null}
                        onClick={async () => {
                          setRegenModIdx(i);
                          try {
                            const res = await api.admin.courses.aiGenerateModule({
                              topic: m.title,
                              courseTitle: aiResult?.title,
                            });
                            const generated = (res as any).data ?? res;
                            if (generated?.title) {
                              setAiResult((prev: any) => {
                                const modules = [...(prev.modules ?? [])];
                                modules[i] = {
                                  ...generated,
                                  order: m.order,
                                  questions: generated.questions ?? modules[i].questions,
                                };
                                return { ...prev, modules };
                              });
                            }
                          } catch {
                            /* silent */
                          } finally {
                            setRegenModIdx(null);
                          }
                        }}
                        className="p-1 rounded text-gray-400 hover:text-purple-500 hover:bg-purple-50 transition-colors disabled:opacity-40"
                      >
                        {regenModIdx === i ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  {/* Lessons list */}
                  <div className="px-3 py-2 space-y-0.5">
                    {(m.lessons ?? []).map((l: any, j: number) => (
                      <p
                        key={j}
                        className={`text-xs ${l.type === 'video' ? 'text-purple-500' : 'text-gray-400'}`}
                      >
                        {l.type === 'video' ? '🎬' : '📄'} {l.title}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400">{t.admin.aiPublishNote}</p>
            {aiError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
                {aiError}
              </div>
            )}
            <div className="flex justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setAiStep(2);
                  setAiResult(null);
                }}
              >
                {t.admin.aiRegenBtn}
              </Button>
              <Button
                onClick={onPublish}
                loading={aiPublishing}
                leftIcon={<CheckCircle className="w-4 h-4" />}
              >
                {t.admin.aiPublishBtn}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4 — Assign students */}
        {aiStep === 4 && (
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-900/20 dark:to-blue-900/20 rounded-xl border border-emerald-200">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-8 h-8 text-emerald-500 shrink-0" />
                <div>
                  <p className="font-heading font-bold text-charcoal">{t.admin.aiPublishedTitle}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{t.admin.aiPublishedSubtitle}</p>
                </div>
              </div>
            </div>

            {/* Suggested tags */}
            {aiSuggestedTags.length > 0 && (
              <div className="p-3 bg-surface rounded-xl border border-border">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {t.admin.aiTagsSuggestedLabel}
                </p>
                <div className="flex flex-wrap gap-2">
                  {aiSuggestedTags.map((tag) => {
                    const active = aiAcceptedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setAiAcceptedTags((prev) =>
                            active ? prev.filter((t) => t !== tag) : [...prev, tag]
                          )
                        }
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                          active
                            ? 'bg-cta-from text-white border-cta-from'
                            : 'bg-white text-gray-400 border-border hover:border-gray-400'
                        }`}
                      >
                        {active ? '✓ ' : '+ '}
                        {tag}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-2">{t.admin.aiTagsHint}</p>
              </div>
            )}

            {aiStudentList.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">{t.admin.aiNoStudents}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-charcoal">
                    {t.admin.aiSelectStudentsLabel}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setAiSelectedStudents(aiStudentList.map((s) => s.username))
                      }
                      className="text-xs text-cta-from font-medium hover:opacity-70"
                    >
                      {t.admin.aiSelectAll}
                    </button>
                    <span className="text-xs text-gray-300">|</span>
                    <button
                      type="button"
                      onClick={() => setAiSelectedStudents([])}
                      className="text-xs text-gray-400 font-medium hover:opacity-70"
                    >
                      {t.admin.aiSelectNone}
                    </button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                  {aiStudentList.map((s) => {
                    const checked = aiSelectedStudents.includes(s.username);
                    return (
                      <label
                        key={s.username}
                        className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setAiSelectedStudents((prev) =>
                              checked
                                ? prev.filter((u) => u !== s.username)
                                : [...prev, s.username]
                            )
                          }
                          className="w-4 h-4 accent-cta-from"
                        />
                        <div className="w-8 h-8 rounded-full bg-cta-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(s.name || s.email)[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-charcoal truncate">
                            {s.name || s.email}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{s.email}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400">
                  {t.admin.aiSelectedCount(aiSelectedStudents.length, aiStudentList.length)}
                </p>
              </>
            )}

            <div className="flex justify-between">
              <Button variant="secondary" onClick={onClose}>
                {t.admin.aiSkipBtn}
              </Button>
              <Button
                onClick={onAssign}
                loading={aiAssigning}
                disabled={aiSelectedStudents.length === 0}
                leftIcon={<CheckCircle className="w-4 h-4" />}
              >
                {t.admin.aiAssignBtn}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
