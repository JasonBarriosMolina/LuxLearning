'use client';

// Trello *LUX SCHEDULER* (Mack, 2026-09-16): "la opción de edificio y todo
// eso sería mejor que se guarde en el perfil del administrador para que quede
// directamente ahí y no tal vez en el aire en el planificador."
import { useEffect, useState } from 'react';
import { Building2, Check, DoorOpen, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

const COURSE_TYPE_LABELS: Record<string, string> = {
  TEORICO: 'Teórico', TEORICO_PRACTICO: 'Teórico-Práctico', PROYECTOS: 'Taller/Proyectos',
  PROGRAMA_ESPECIAL: 'Programa Especial', CURSO_CORTO: 'Curso Corto', LIBRE: 'Curso Libre/Tutoría',
};

interface Building { id: string; name: string; }
interface ClassRoomRow { id: string; name: string; capacity: number; buildingId: string | null; floor: number | null; preferredName: string | null; courseTypeTags: string[]; }

export function BuildingsSection() {
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
  const [roomDescription, setRoomDescription] = useState('');
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
        preferredName: roomDescription.trim() || undefined,
        courseTypeTags: roomTags,
      });
      setRooms([...rooms, (res as any).data]);
      setRoomName(''); setRoomCapacity(''); setRoomBuildingId(''); setRoomFloor(''); setRoomDescription(''); setRoomTags([]);
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

  if (loading) return (
    <div className="flex items-center gap-2 py-4 text-gray-400 text-sm">
      <Loader2 className="w-4 h-4 animate-spin" /> Cargando aulas y edificios…
    </div>
  );

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Edificios */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-charcoal flex items-center gap-2"><Building2 className="w-4 h-4" /> Edificios</p>
        <div className="flex flex-wrap gap-2">
          {buildings.map((b) => (
            <span key={b.id} className="flex items-center gap-1.5 text-sm bg-surface border border-border rounded-full pl-3 pr-1.5 py-1">
              {editingBuildingId === b.id ? (
                <>
                  <input
                    autoFocus type="text" value={editingBuildingName} onChange={(e) => setEditingBuildingName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRenameBuilding(b.id); else if (e.key === 'Escape') setEditingBuildingId(null); }}
                    className="text-sm border border-gray-200 rounded-md px-2 py-0.5 w-32"
                  />
                  <button onClick={() => handleRenameBuilding(b.id)} className="p-0.5 text-emerald-500 hover:text-emerald-600"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setEditingBuildingId(null)} className="p-0.5 text-gray-300 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
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
          <div className="flex items-center gap-1.5">
            <input
              type="text" value={newBuildingName} onChange={(e) => setNewBuildingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddBuilding(); }}
              placeholder="Nuevo edificio" className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-36"
            />
            <button onClick={handleAddBuilding} disabled={addingBuilding || !newBuildingName.trim()} className="p-1.5 text-gray-400 hover:text-cta-from disabled:opacity-50">
              {addingBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Aulas agrupadas por edificio */}
      <div className="space-y-4">
        <p className="text-sm font-semibold text-charcoal flex items-center gap-2"><DoorOpen className="w-4 h-4" /> Aulas ({rooms.length})</p>
        {(() => {
          const grouped: { building: Building | null; rooms: ClassRoomRow[] }[] = [];
          buildings.forEach((b) => {
            const br = rooms.filter((r) => r.buildingId === b.id);
            if (br.length) grouped.push({ building: b, rooms: br });
          });
          const unassigned = rooms.filter((r) => !r.buildingId);
          if (unassigned.length) grouped.push({ building: null, rooms: unassigned });
          return grouped.length === 0 && rooms.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No hay aulas registradas aún.</p>
          ) : (
            grouped.map(({ building: b, rooms: gr }) => (
              <div key={b?.id ?? '__none__'} className="space-y-1">
                <p className="text-xs font-semibold text-gray-400 flex items-center gap-1 uppercase tracking-wide">
                  <Building2 className="w-3.5 h-3.5" />{b?.name ?? 'Sin edificio'}
                </p>
                <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                  {gr.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-charcoal">
                          {r.name}{r.preferredName && <span className="text-gray-400 font-normal"> — {r.preferredName}</span>}
                          {r.floor != null && <span className="text-gray-400 font-normal text-xs ml-1">piso {r.floor}</span>}
                        </p>
                        <p className="text-xs text-gray-500">
                          Aforo: {r.capacity}
                          {r.courseTypeTags.length > 0 && ` · ${r.courseTypeTags.map((t) => COURSE_TYPE_LABELS[t] ?? t).join(', ')}`}
                        </p>
                      </div>
                      <button onClick={() => handleDeleteRoom(r.id)} className="p-1 text-gray-300 hover:text-red-500 shrink-0"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          );
        })()}

        {showAddRoom ? (
          <div className="p-4 bg-surface rounded-xl border border-border space-y-3">
            <p className="text-sm font-medium text-charcoal">Nueva aula</p>
            <div className="grid grid-cols-2 gap-3">
              <select value={roomBuildingId} onChange={(e) => setRoomBuildingId(e.target.value)} className="input-field text-sm">
                <option value="">— sin edificio —</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input
                type="number" min={1} value={roomFloor}
                onChange={(e) => { setRoomFloor(e.target.value); if (!roomName) setRoomName(suggestName(e.target.value)); }}
                placeholder="Piso (opcional)" className="input-field text-sm"
              />
              <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Nombre (ej. 101)" className="input-field text-sm" />
              <input type="number" min={1} value={roomCapacity} onChange={(e) => setRoomCapacity(e.target.value)} placeholder="Aforo" className="input-field text-sm" />
              <input type="text" value={roomDescription} onChange={(e) => setRoomDescription(e.target.value)} placeholder="Descripción (ej. Sala de ensayos, opcional)" className="input-field text-sm col-span-2" />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2">Tipos de curso que se pueden dar acá (opcional):</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(COURSE_TYPE_LABELS).map(([id, label]) => (
                  <button
                    key={id} type="button"
                    onClick={() => setRoomTags(roomTags.includes(id) ? roomTags.filter((t) => t !== id) : [...roomTags, id])}
                    className={`px-2.5 py-1 rounded-full text-xs border ${roomTags.includes(id) ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-gray-500 border-border'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddRoom(false)}>Cancelar</Button>
              <Button type="button" size="sm" onClick={handleAddRoom} loading={addingRoom} disabled={!roomName.trim() || !roomCapacity}>Crear aula</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowAddRoom(true)}>
            Agregar aula
          </Button>
        )}
      </div>
    </div>
  );
}
