'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Building2, DoorOpen, Pencil, Check, X as XIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import type { Building, ClassRoomRow } from './types';

// Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "una de las cosas
// importantes que debe existir en parámetros, tal vez como una sección
// intermedia entre parámetros y cursos, son las aulas disponibles... la
// institución puede agregar aulas, puede agregar edificios y edificios que
// contengan aulas... divididas por piso... nombre preferencial... aforo...
// descripción de qué tipo de cursos se pueden dar." Vive al final de
// StepParams.tsx (paso 2) — justo antes del paso 3 de Cursos.
const COURSE_TYPE_LABELS: Record<string, string> = {
  TEORICO: 'Teórico', TEORICO_PRACTICO: 'Teórico-Práctico', PROYECTOS: 'Taller/Proyectos',
  PROGRAMA_ESPECIAL: 'Programa Especial', CURSO_CORTO: 'Curso Corto', LIBRE: 'Curso Libre/Tutoría',
};

export function RoomsManager({ readOnly = false }: { readOnly?: boolean }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<ClassRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newBuildingName, setNewBuildingName] = useState('');
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const [editingBuildingName, setEditingBuildingName] = useState('');

  const [showAddRoom, setShowAddRoom] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomCapacity, setRoomCapacity] = useState('');
  const [roomBuildingId, setRoomBuildingId] = useState('');
  const [roomFloor, setRoomFloor] = useState('');
  const [roomPreferredName, setRoomPreferredName] = useState('');
  const [roomTags, setRoomTags] = useState<string[]>([]);
  const [addingRoom, setAddingRoom] = useState(false);

  const load = () => {
    setLoading(true); setError('');
    Promise.all([api.admin.scheduler.buildings.list(), api.admin.scheduler.rooms.list()])
      .then(([b, r]: any[]) => { setBuildings(b?.data ?? []); setRooms(r?.data ?? []); })
      .catch((err: any) => setError(err?.message ?? 'No se pudieron cargar las aulas.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleAddBuilding = async () => {
    if (!newBuildingName.trim()) return;
    setAddingBuilding(true); setError('');
    try {
      const res = await api.admin.scheduler.buildings.create(newBuildingName.trim());
      setBuildings([...buildings, (res as any).data]);
      setNewBuildingName('');
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo crear el edificio.');
    } finally {
      setAddingBuilding(false);
    }
  };

  const handleRenameBuilding = async (id: string) => {
    const name = editingBuildingName.trim();
    if (!name) return;
    try {
      await api.admin.scheduler.buildings.update(id, name);
      setBuildings(buildings.map((b) => (b.id === id ? { ...b, name } : b)));
      setEditingBuildingId(null);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo renombrar el edificio.');
    }
  };

  const handleDeleteBuilding = async (id: string) => {
    if (!confirm('¿Eliminar este edificio? Las aulas que tenga quedan sin edificio, no se borran.')) return;
    try {
      await api.admin.scheduler.buildings.delete(id);
      setBuildings(buildings.filter((b) => b.id !== id));
      setRooms(rooms.map((r) => (r.buildingId === id ? { ...r, buildingId: null } : r)));
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo eliminar el edificio.');
    }
  };

  // Trello *LUX SCHEDULER* (Mack, 2026-09-15, 15:36): "si el edificio es A y
  // tiene 3 pisos, las aulas del piso 1 deberían llamarse 101, 102... cuando
  // es el piso 2: 201, 202..." — sugerencia de nombre, editable antes de crear.
  const suggestName = (floor: string) => {
    const f = Number(floor);
    if (!f) return '';
    const sameFloor = rooms.filter((r) => r.buildingId === (roomBuildingId || null) && r.floor === f);
    return `${f}${String(sameFloor.length + 1).padStart(2, '0')}`;
  };

  const handleAddRoom = async () => {
    const capacity = Number(roomCapacity);
    if (!roomName.trim() || !capacity || capacity < 1) return;
    setAddingRoom(true); setError('');
    try {
      const res = await api.admin.scheduler.rooms.create({
        name: roomName.trim(), capacity,
        buildingId: roomBuildingId || undefined,
        floor: roomFloor ? Number(roomFloor) : undefined,
        preferredName: roomPreferredName.trim() || undefined,
        courseTypeTags: roomTags,
      });
      setRooms([...rooms, (res as any).data]);
      setRoomName(''); setRoomCapacity(''); setRoomBuildingId(''); setRoomFloor(''); setRoomPreferredName(''); setRoomTags([]);
      setShowAddRoom(false);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo crear el aula.');
    } finally {
      setAddingRoom(false);
    }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!confirm('¿Eliminar esta aula?')) return;
    try {
      await api.admin.scheduler.rooms.delete(id);
      setRooms(rooms.filter((r) => r.id !== id));
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo eliminar el aula.');
    }
  };

  const buildingName = (id: string | null) => buildings.find((b) => b.id === id)?.name;

  if (loading) return (
    <div className="card flex items-center justify-center py-8 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando aulas…
    </div>
  );

  if (readOnly && rooms.length === 0) return (
    <p className="text-xs text-gray-400 italic">Ningún aula registrada aún. Agregalas desde tu perfil.</p>
  );

  return (
    <div className={readOnly ? 'space-y-3' : 'card space-y-4'}>
      {!readOnly && (
        <div>
          <h2 className="font-heading font-semibold text-charcoal flex items-center gap-1.5"><DoorOpen className="w-4 h-4" /> Aulas y edificios</h2>
          <p className="text-xs text-gray-500">Solo aplica a cursos presenciales. Cada curso puede fijar un aula específica desde el catálogo (paso 3).</p>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Edificios */}
      {!readOnly && <div className="space-y-2">
        <p className="text-xs font-semibold text-charcoal flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Edificios</p>
        <div className="flex flex-wrap gap-1.5">
          {buildings.map((b) => (
            <span key={b.id} className="flex items-center gap-1 text-xs bg-surface border border-border rounded-full pl-2.5 pr-1 py-1">
              {editingBuildingId === b.id ? (
                <>
                  <input
                    autoFocus type="text" value={editingBuildingName} onChange={(e) => setEditingBuildingName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRenameBuilding(b.id); else if (e.key === 'Escape') setEditingBuildingId(null); }}
                    className="text-xs border border-gray-200 rounded-md px-1.5 py-0.5 w-24"
                  />
                  <button onClick={() => handleRenameBuilding(b.id)} className="p-0.5 text-emerald-500 hover:text-emerald-600"><Check className="w-3 h-3" /></button>
                  <button onClick={() => setEditingBuildingId(null)} className="p-0.5 text-gray-300 hover:text-gray-600"><XIcon className="w-3 h-3" /></button>
                </>
              ) : (
                <>
                  {b.name}
                  <button onClick={() => { setEditingBuildingId(b.id); setEditingBuildingName(b.name); }} className="p-0.5 text-gray-300 hover:text-cta-from"><Pencil className="w-3 h-3" /></button>
                  <button onClick={() => handleDeleteBuilding(b.id)} className="p-0.5 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                </>
              )}
            </span>
          ))}
          <div className="flex items-center gap-1">
            <input
              type="text" value={newBuildingName} onChange={(e) => setNewBuildingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddBuilding(); }}
              placeholder="Edificio A" className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-28"
            />
            <button onClick={handleAddBuilding} disabled={addingBuilding || !newBuildingName.trim()} className="p-1 text-gray-400 hover:text-cta-from disabled:opacity-50">
              {addingBuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>}

      {/* Aulas agrupadas por edificio */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-charcoal">Aulas ({rooms.length})</p>
        {rooms.length > 0 && (() => {
          const grouped: { building: Building | null; rooms: ClassRoomRow[] }[] = [];
          buildings.forEach((b) => {
            const br = rooms.filter((r) => r.buildingId === b.id);
            if (br.length) grouped.push({ building: b, rooms: br });
          });
          const unassigned = rooms.filter((r) => !r.buildingId);
          if (unassigned.length) grouped.push({ building: null, rooms: unassigned });
          return grouped.map(({ building: b, rooms: gr }) => (
            <div key={b?.id ?? '__none__'} className="space-y-1">
              <p className="text-[11px] font-semibold text-gray-400 flex items-center gap-1">
                <Building2 className="w-3 h-3" />{b?.name ?? 'Sin edificio'}
              </p>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border">
                  {gr.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5 pr-3 font-medium text-charcoal">
                        {r.name}{r.preferredName && <span className="text-gray-400 font-normal"> — {r.preferredName}</span>}
                        {r.floor != null && <span className="text-gray-400 font-normal"> · piso {r.floor}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-gray-500">cap. {r.capacity}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{r.courseTypeTags.length ? r.courseTypeTags.map((t) => COURSE_TYPE_LABELS[t] ?? t).join(', ') : '—'}</td>
                      {!readOnly && <td className="py-1.5">
                        <button onClick={() => handleDeleteRoom(r.id)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ));
        })()}

        {!readOnly && showAddRoom ? (
          <div className="p-3 bg-surface rounded-xl border border-border space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select value={roomBuildingId} onChange={(e) => setRoomBuildingId(e.target.value)} className="input-field text-xs py-1.5">
                <option value="">— sin edificio —</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input
                type="number" min={1} value={roomFloor}
                onChange={(e) => { setRoomFloor(e.target.value); if (!roomName) setRoomName(suggestName(e.target.value)); }}
                placeholder="Piso (opcional)" className="input-field text-xs py-1.5"
              />
              <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Nombre (ej. 101)" className="input-field text-xs py-1.5" />
              <input type="number" min={1} value={roomCapacity} onChange={(e) => setRoomCapacity(e.target.value)} placeholder="Aforo" className="input-field text-xs py-1.5" />
              <input type="text" value={roomPreferredName} onChange={(e) => setRoomPreferredName(e.target.value)} placeholder="Descripción (ej. Sala de ensayos, opcional)" className="input-field text-xs py-1.5 col-span-2" />
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Tipos de curso que se pueden dar acá (opcional):</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(COURSE_TYPE_LABELS).map(([id, label]) => (
                  <button
                    key={id} type="button"
                    onClick={() => setRoomTags(roomTags.includes(id) ? roomTags.filter((t) => t !== id) : [...roomTags, id])}
                    className={`px-2 py-0.5 rounded-full text-[11px] border ${roomTags.includes(id) ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-gray-500 border-border'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddRoom(false)} className="text-xs text-gray-400 hover:text-gray-700 px-2">Cancelar</button>
              <Button size="sm" onClick={handleAddRoom} loading={addingRoom} disabled={!roomName.trim() || !roomCapacity}>Crear aula</Button>
            </div>
          </div>
        ) : !readOnly ? (
          <Button variant="secondary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowAddRoom(true)}>
            Agregar aula
          </Button>
        ) : null}
      </div>
    </div>
  );
}
