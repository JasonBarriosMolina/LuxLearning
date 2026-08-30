'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type GroupSummary = { id: string; name: string; color?: string };
type GroupMember = { userId: string; name: string; email: string };

interface GroupFilterPanelProps {
  groups: GroupSummary[];
  selectedGroupId: string;
  onSelectGroup: (id: string) => void;
  members: GroupMember[] | null;
  selectedMemberIds: Set<string>;
  onToggleMember: (userId: string) => void;
  onSelectAllMembers: () => void;
  onSelectNoMembers: () => void;
  canAdd: boolean;
  onAddSelected: () => void;
}

// Trello DmPpbrff comment 2026-08-30 20:13: picking a group used to just show a bare
// "Agregar los N estudiantes" button with no way to see who those N people were, or to
// leave some out. This panel shows the member list (name/email) as soon as a group is
// picked — even before a course is selected — and lets Mack pick the whole group or
// individual members before adding.
export function GroupFilterPanel({
  groups, selectedGroupId, onSelectGroup, members, selectedMemberIds, onToggleMember,
  onSelectAllMembers, onSelectNoMembers, canAdd, onAddSelected,
}: GroupFilterPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400 flex-shrink-0">Filtrar por grupo:</span>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onSelectGroup('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${selectedGroupId === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
          >
            Todos
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => onSelectGroup(g.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${selectedGroupId === g.id ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
            >
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: g.color ?? '#17527E' }} />
              {g.name}
              {selectedGroupId === g.id && <ChevronDown className="w-3 h-3" />}
            </button>
          ))}
        </div>
      </div>

      {selectedGroupId !== 'all' && members !== null && (
        <div className="rounded-xl border border-border bg-surface p-3 max-w-md">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-500">
              {members.length === 0 ? 'Este grupo no tiene estudiantes' : `Estudiantes del grupo (${members.length})`}
            </p>
            {members.length > 0 && (
              <div className="flex gap-2 text-xs">
                <button onClick={onSelectAllMembers} className="text-cta-from hover:underline">Todos</button>
                <button onClick={onSelectNoMembers} className="text-gray-400 hover:underline">Ninguno</button>
              </div>
            )}
          </div>
          {members.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {members.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 text-sm text-charcoal py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.has(m.userId)}
                    onChange={() => onToggleMember(m.userId)}
                  />
                  <span className="truncate">{m.name}</span>
                  {m.email && m.email !== m.name && (
                    <span className="text-xs text-gray-400 truncate">({m.email})</span>
                  )}
                </label>
              ))}
            </div>
          )}
          {canAdd && selectedMemberIds.size > 0 && (
            <Button size="sm" variant="secondary" onClick={onAddSelected} className="mt-2 w-full">
              Agregar {selectedMemberIds.size} estudiante{selectedMemberIds.size > 1 ? 's' : ''} seleccionado{selectedMemberIds.size > 1 ? 's' : ''}
            </Button>
          )}
          {!canAdd && members.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">Selecciona un curso arriba para poder agregarlos.</p>
          )}
        </div>
      )}
    </div>
  );
}
