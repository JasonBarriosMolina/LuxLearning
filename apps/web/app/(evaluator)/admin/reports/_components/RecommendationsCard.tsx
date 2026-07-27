'use client';

import { BookOpen, Edit2, Save, X, Loader2 } from 'lucide-react';

type RecommendationItem = {
  id: string; weakTopic: string; title: string; type: string;
  url: string; description: string; aiGenerated: boolean;
};

type RecommendationEntry = {
  moduleId: string; moduleTitle: string;
  items: RecommendationItem[];
};

function typeIcon(type: string) {
  const icons: Record<string, string> = { article: '📄', book: '📚', video: '🎥', link: '🔗' };
  return icons[type] ?? '🔗';
}

interface Props {
  recommendations: RecommendationEntry[];
  editingRecs: string | null;
  editedItems: any[];
  savingRecs: boolean;
  onStartEdit: (moduleId: string, items: any[]) => void;
  onSave: (moduleId: string) => void;
  onCancelEdit: () => void;
  onSetEditedItems: (items: any[]) => void;
  labels: {
    title: string;
    hint: string;
    editBtn: string;
    saveBtn: string;
    titlePlaceholder: string;
    urlPlaceholder: string;
    descPlaceholder: string;
    deleteItem: string;
    addResource: string;
  };
}

export function RecommendationsCard({
  recommendations, editingRecs, editedItems, savingRecs,
  onStartEdit, onSave, onCancelEdit, onSetEditedItems, labels,
}: Props) {
  if (recommendations.length === 0) return null;
  return (
    <div className="card">
      <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
        <BookOpen className="w-5 h-5 text-cta-from" /> {labels.title}
        <span className="text-xs font-normal text-gray-400 ml-1">{labels.hint}</span>
      </h2>
      <div className="space-y-6">
        {recommendations.map((rec) => (
          <div key={rec.moduleId} className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-charcoal">{rec.moduleTitle}</p>
              {editingRecs !== rec.moduleId ? (
                <button
                  onClick={() => onStartEdit(rec.moduleId, rec.items)}
                  className="no-print flex items-center gap-1 text-xs text-gray-500 hover:text-cta-from transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" /> {labels.editBtn}
                </button>
              ) : (
                <div className="no-print flex items-center gap-2">
                  <button
                    onClick={() => onSave(rec.moduleId)}
                    disabled={savingRecs}
                    className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    {savingRecs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {labels.saveBtn}
                  </button>
                  <button onClick={onCancelEdit} className="text-xs text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {editingRecs === rec.moduleId ? (
              <div className="space-y-3">
                {editedItems.map((item, i) => (
                  <div key={item.id} className="bg-surface rounded-lg p-3 space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={item.title}
                        onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], title: e.target.value }; onSetEditedItems(n); }}
                        className="flex-1 text-sm px-3 py-1.5 border border-border rounded-lg"
                        placeholder={labels.titlePlaceholder}
                      />
                      <select
                        value={item.type}
                        onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], type: e.target.value }; onSetEditedItems(n); }}
                        className="text-sm px-2 py-1.5 border border-border rounded-lg"
                      >
                        {['article', 'book', 'video', 'link'].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <input
                      value={item.url}
                      onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], url: e.target.value }; onSetEditedItems(n); }}
                      className="w-full text-sm px-3 py-1.5 border border-border rounded-lg"
                      placeholder={labels.urlPlaceholder}
                    />
                    <input
                      value={item.description}
                      onChange={(e) => { const n = [...editedItems]; n[i] = { ...n[i], description: e.target.value }; onSetEditedItems(n); }}
                      className="w-full text-sm px-3 py-1.5 border border-border rounded-lg"
                      placeholder={labels.descPlaceholder}
                    />
                    <button
                      onClick={() => onSetEditedItems(editedItems.filter((_, j) => j !== i))}
                      className="text-xs text-red-400 hover:text-red-600"
                    >{labels.deleteItem}</button>
                  </div>
                ))}
                <button
                  onClick={() => onSetEditedItems([...editedItems, { id: Date.now().toString(), weakTopic: '', title: '', type: 'link', url: '', description: '', aiGenerated: false }])}
                  className="text-xs text-cta-from hover:underline"
                >{labels.addResource}</button>
              </div>
            ) : (
              <div className="space-y-2">
                {rec.items.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                    <span className="text-lg shrink-0">{typeIcon(item.type)}</span>
                    <div className="min-w-0">
                      <a href={item.url} target="_blank" rel="noreferrer"
                        className="text-sm font-medium text-cta-from hover:underline">{item.title}</a>
                      <p className="text-xs text-gray-500 mt-0.5">{item.weakTopic}</p>
                      {item.description && <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>}
                    </div>
                    {item.aiGenerated && <span className="shrink-0 text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">IA</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
