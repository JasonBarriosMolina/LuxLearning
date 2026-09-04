// ─── lessons/notes.ts ────────────────────────────────────────────────────────
// Student notes routes — split out of lessons/handler.ts (600-line domain-module
// limit). Trello DmPpbrff, 2026-09-04 (Mack): lesson highlights should be
// summarizable ("Consultar a Lux Mentor") into notes the student can revisit
// later in the app — real server-side persistence, tags, and a search, replacing
// the old idea of exporting to PDF (Mack: "sacaría la info de Lux Learning... el
// uso y consumo [de la app] es importante").
import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { listNotes, saveNote, deleteNote, type NoteContextType } from '../shared/db-notes';
import { ok, badRequest, serverError } from '../shared/response';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' });

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }>;

const isValidContextType = (v: unknown): v is NoteContextType => v === 'lesson' || v === 'class';

/** Returns a response if this event matches a /lessons/notes* route, else null so
 *  the caller falls through to its other routes. */
export async function handleLessonNotes(event: Event, userId: string, method: string, path: string): Promise<any | null> {
  // GET /lessons/notes?contextType=lesson&contextId=xxx
  if (method === 'GET' && path.includes('/lessons/notes')) {
    const contextType = event.queryStringParameters?.contextType;
    const contextId = event.queryStringParameters?.contextId;
    if (!isValidContextType(contextType) || !contextId) return badRequest('contextType (lesson|class) y contextId son requeridos');
    const notes = await listNotes(userId, contextType, contextId);
    return ok(notes);
  }

  // POST /lessons/notes/delete — DELETE-with-body isn't reliably supported by every
  // client/gateway combo in this codebase (no other DELETE route exists here either),
  // so this follows the same POST-for-mutation convention as toggleFavorite above.
  if (method === 'POST' && path.includes('/lessons/notes/delete')) {
    const body = JSON.parse(event.body ?? '{}');
    const { contextType, contextId, noteId } = body as { contextType?: string; contextId?: string; noteId?: string };
    if (!isValidContextType(contextType) || !contextId || !noteId) return badRequest('contextType, contextId y noteId son requeridos');
    await deleteNote(userId, contextType, contextId, noteId);
    return ok({ deleted: true });
  }

  // POST /lessons/notes/summarize-highlights — "Consultar a Lux Mentor": summarizes
  // the student's highlighted passages from a lesson into one study-note.
  if (method === 'POST' && path.includes('/lessons/notes/summarize-highlights')) {
    const body = JSON.parse(event.body ?? '{}');
    const { contextId, highlights, lessonTitle } = body as { contextId?: string; highlights?: string[]; lessonTitle?: string };
    if (!contextId) return badRequest('contextId es requerido');
    if (!Array.isArray(highlights) || highlights.length === 0) return badRequest('highlights (array no vacío) es requerido');

    const prompt = `Eres Mentor, el asistente educativo de Lux Learning. Un estudiante resaltó estos fragmentos${lessonTitle ? ` de la lección "${lessonTitle}"` : ''} porque le parecieron importantes:

${highlights.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

Escribe un resumen breve (3-5 oraciones) en español que conecte estas ideas en una explicación clara y fácil de repasar después. No repitas los fragmentos literalmente, sintetiza el concepto. Responde SOLO con el resumen, sin introducciones ni despedidas.`;

    try {
      const bedrockRes = await bedrock.send(new InvokeModelCommand({
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      }));
      const parsed = JSON.parse(new TextDecoder().decode(bedrockRes.body));
      const summary = (parsed.content?.[0]?.text ?? '').trim();
      if (!summary) return serverError('No se pudo generar el resumen. Intenta de nuevo.');
      const note = await saveNote(userId, {
        contextType: 'lesson', contextId, text: summary, tags: ['resumen'], source: 'highlight-summary',
      });
      return ok(note);
    } catch (err: any) {
      console.error('[lessons/notes] summarize-highlights failed:', err?.message ?? err);
      return serverError('No se pudo generar el resumen: ' + (err?.message ?? ''));
    }
  }

  // POST /lessons/notes — create or update (pass noteId to update) a manual note
  if (method === 'POST' && path.includes('/lessons/notes')) {
    const body = JSON.parse(event.body ?? '{}');
    const { contextType, contextId, text, tags, noteId } = body as {
      contextType?: string; contextId?: string; text?: string; tags?: string[]; noteId?: string;
    };
    if (!isValidContextType(contextType) || !contextId) return badRequest('contextType (lesson|class) y contextId son requeridos');
    if (!text || !text.trim()) return badRequest('text es requerido');
    const note = await saveNote(userId, {
      noteId, contextType, contextId, text: text.trim().slice(0, 2000),
      tags: Array.isArray(tags) ? tags.slice(0, 10).map((t) => String(t).slice(0, 40)) : [],
    });
    return ok(note);
  }

  return null;
}
