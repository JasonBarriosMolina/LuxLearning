// ─── rooms.ts ───────────────────────────────────────────────────────────────
// Aulas y edificios para Lux Scheduler (Trello *LUX SCHEDULER*, Mack 2026-09-15,
// 15:36): "la institución puede agregar aulas, puede agregar edificios y
// edificios que contengan aulas... divididas por piso... nombre preferencial...
// aforo... descripción de qué tipo de cursos se pueden dar."
import { ok, created, badRequest, forbidden, notFound } from '../shared/response';
import { AdminCtx, isAdmin } from './ctx';

// Mismos valores que COURSE_TYPE_VALUES en courses.ts — un aula puede
// etiquetarse con los tipos de curso que soporta (teórico, taller, etc.)
// para filtrar qué aulas alcanzan cierto tipo de curso según el aforo.
const COURSE_TYPE_VALUES = ['TEORICO', 'TEORICO_PRACTICO', 'PROYECTOS', 'PROGRAMA_ESPECIAL', 'CURSO_CORTO', 'LIBRE'];

export async function handleRooms(ctx: AdminCtx): Promise<any | null> {
  const { method, path, prisma, event, body } = ctx;

  // ── /admin/scheduler/buildings ──────────────────────────────────────────
  if (path === '/admin/scheduler/buildings') {
    if (method === 'GET') {
      const buildings = await prisma.building.findMany({ orderBy: { name: 'asc' } });
      return ok(buildings);
    }
    if (method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const name = (body.name as string | undefined)?.trim();
      if (!name) return badRequest('name es requerido');
      const building = await prisma.building.create({ data: { name } }).catch(() => null);
      if (!building) return badRequest('Ya existe un edificio con ese nombre');
      return created(building);
    }
    return null;
  }

  const buildingMatch = path.match(/^\/admin\/scheduler\/buildings\/([^/]+)$/);
  if (buildingMatch && method === 'DELETE') {
    if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
    const id = buildingMatch[1]!;
    // Las aulas del edificio quedan sin edificio en vez de borrarse en cascada
    // — un aula no debería desaparecer solo porque se reorganizó un edificio.
    await prisma.classRoom.updateMany({ where: { buildingId: id }, data: { buildingId: null } });
    await prisma.building.delete({ where: { id } }).catch(() => null);
    return ok({ deleted: true });
  }

  // ── /admin/scheduler/rooms ───────────────────────────────────────────────
  if (path === '/admin/scheduler/rooms') {
    if (method === 'GET') {
      const rooms = await prisma.classRoom.findMany({ orderBy: [{ buildingId: 'asc' }, { floor: 'asc' }, { name: 'asc' }] });
      return ok(rooms);
    }
    if (method === 'POST') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const name = (body.name as string | undefined)?.trim();
      const capacity = Number(body.capacity);
      if (!name) return badRequest('name es requerido');
      if (!capacity || capacity < 1) return badRequest('capacity debe ser un número mayor a 0');
      const courseTypeTags = Array.isArray(body.courseTypeTags) ? body.courseTypeTags.filter((t: string) => COURSE_TYPE_VALUES.includes(t)) : [];
      const room = await prisma.classRoom.create({
        data: {
          name, capacity,
          buildingId: body.buildingId || null,
          floor: body.floor != null ? Number(body.floor) : null,
          preferredName: (body.preferredName as string | undefined)?.trim() || null,
          courseTypeTags,
        },
      });
      return created(room);
    }
    return null;
  }

  const roomMatch = path.match(/^\/admin\/scheduler\/rooms\/([^/]+)$/);
  if (roomMatch) {
    const id = roomMatch[1]!;
    if (method === 'PUT') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      const updateData: Record<string, any> = {};
      if ('name' in body) {
        const name = (body.name as string | undefined)?.trim();
        if (!name) return badRequest('name no puede quedar vacío');
        updateData.name = name;
      }
      if ('capacity' in body) {
        const capacity = Number(body.capacity);
        if (!capacity || capacity < 1) return badRequest('capacity debe ser un número mayor a 0');
        updateData.capacity = capacity;
      }
      if ('buildingId' in body) updateData.buildingId = body.buildingId || null;
      if ('floor' in body) updateData.floor = body.floor != null ? Number(body.floor) : null;
      if ('preferredName' in body) updateData.preferredName = (body.preferredName as string | undefined)?.trim() || null;
      if ('courseTypeTags' in body) {
        updateData.courseTypeTags = Array.isArray(body.courseTypeTags) ? body.courseTypeTags.filter((t: string) => COURSE_TYPE_VALUES.includes(t)) : [];
      }
      if (Object.keys(updateData).length === 0) return badRequest('No hay campos para actualizar');
      const room = await prisma.classRoom.update({ where: { id }, data: updateData }).catch(() => null);
      if (!room) return notFound('Aula no encontrada');
      return ok(room);
    }
    if (method === 'DELETE') {
      if (!isAdmin(event)) return forbidden('Se requiere rol de administrador');
      // No se borra si tiene clases publicadas asignadas — evita dejar
      // ScheduledClass.roomId apuntando a un aula que ya no existe.
      const inUse = await prisma.scheduledClass.count({ where: { roomId: id } });
      if (inUse > 0) return badRequest('No se puede eliminar: hay clases publicadas usando esta aula.');
      // Revisión de bugs (Jason, 2026-09-16): un curso con esta aula fijada
      // como preferredRoomId (ver CourseRow.tsx) quedaba con una referencia
      // colgante tras borrar el aula — el próximo horario generado la
      // pineaba igual con un id que ya no existe, sin nombre para mostrar.
      await prisma.course.updateMany({ where: { preferredRoomId: id }, data: { preferredRoomId: null } });
      await prisma.classRoom.delete({ where: { id } }).catch(() => null);
      return ok({ deleted: true });
    }
    return null;
  }

  return null;
}
