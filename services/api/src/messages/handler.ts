import type { APIGatewayProxyEventV2WithRequestContext, APIGatewayEventRequestContextV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  getChatsForUser,
  getChatMeta,
  getUserMembership,
  upsertChat,
  upsertMembership,
  updateChatLastMessage,
  markChatRead,
  getMessages,
  putMessage,
  reactToMessage,
} from '../shared/db-messages.js';
import { getAllEnrollments } from '../shared/db-dynamo.js';
import { ok, badRequest, forbidden, notFound, serverError, cors } from '../shared/response.js';

type AuthContext = { userId: string; email: string; role: string };
type Event = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & { authorizer?: { lambda?: AuthContext } }
>;

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

// Simple in-memory cache for Cognito user names (warm Lambda)
const nameCache = new Map<string, string>();

async function getDisplayName(userId: string, email: string): Promise<string> {
  if (nameCache.has(userId)) return nameCache.get(userId)!;
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
    const name = res.UserAttributes?.find((a) => a.Name === 'name')?.Value || email || userId;
    nameCache.set(userId, name);
    return name;
  } catch {
    return email || userId;
  }
}

async function listGroupUsers(GroupName: string): Promise<{ username: string; name: string; email: string }[]> {
  const users: { username: string; name: string; email: string }[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName, Limit: 60, NextToken: token }));
    for (const u of res.Users ?? []) {
      const attr = (name: string) => u.Attributes?.find((a) => a.Name === name)?.Value ?? '';
      users.push({ username: u.Username ?? '', name: attr('name'), email: attr('email') });
    }
    token = res.NextToken;
  } while (token);
  return users;
}

export const handler = async (event: Event) => {
  if (event.requestContext.http.method === 'OPTIONS') return cors();

  const userId = event.requestContext.authorizer?.lambda?.userId;
  const email  = event.requestContext.authorizer?.lambda?.email ?? '';
  const role   = event.requestContext.authorizer?.lambda?.role ?? '';
  const method = event.requestContext.http.method;
  const path   = event.rawPath;

  if (!userId) return forbidden('No autenticado');

  let body: any = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* no body */ }

  try {
    // ── GET /messages/contacts — lista de contactos según rol ───────────────
    if (method === 'GET' && path === '/messages/contacts') {
      if (role === 'STUDENT') {
        // Get the student's enrolled courses
        const allEnrollments = await getAllEnrollments();
        const myEnrollments = allEnrollments.filter((e) => e.userId === userId);
        const myCourseIds = new Set(myEnrollments.map((e) => e.courseId));

        // Get all coursemates (students in the same courses)
        const coursemates = myCourseIds.size > 0
          ? allEnrollments
              .filter((e) => e.userId !== userId && myCourseIds.has(e.courseId))
              .map((e) => e.userId)
          : [];
        const coursemateIds = [...new Set(coursemates)];

        // Fetch evaluators + coursemate details from Cognito in parallel
        const [evaluators, admins] = await Promise.all([
          listGroupUsers('EVALUATOR'),
          listGroupUsers('ADMIN'),
        ]);

        // Fetch coursemate names from Cognito
        const coursemateDetails = await Promise.all(
          coursemateIds.slice(0, 30).map(async (uid) => {
            try {
              const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: uid }));
              const attr = (n: string) => res.UserAttributes?.find((a) => a.Name === n)?.Value ?? '';
              return { username: uid, name: attr('name'), email: attr('email'), badge: 'Compañero' };
            } catch { return null; }
          })
        );

        const evalWithBadge = [...evaluators, ...admins].map((u) => ({ ...u, badge: 'Evaluador' }));
        const validCoursemates = coursemateDetails.filter(Boolean) as any[];
        return ok([...evalWithBadge, ...validCoursemates]);
      } else {
        // Evaluadores/Admins ven estudiantes
        const students = await listGroupUsers('STUDENT');
        return ok(students);
      }
    }

    // ── GET /messages/chats ─────────────────────────────────────────────────
    if (method === 'GET' && path === '/messages/chats') {
      const chats = await getChatsForUser(userId);
      return ok(chats);
    }

    // ── POST /messages/chats — create a chat ────────────────────────────────
    if (method === 'POST' && path === '/messages/chats') {
      const { type, targetUserId, courseId, name, participantIds } = body as {
        type?: string;
        targetUserId?: string;
        courseId?: string;
        name?: string;
        participantIds?: string[];
      };

      if (!type) return badRequest('type es requerido');

      if (type === 'DIRECT') {
        if (!targetUserId) return badRequest('targetUserId es requerido para chat DIRECT');
        const chatId = `direct_${[userId, targetUserId].sort().join('_')}`;
        const chatName = await getDisplayName(targetUserId, '');
        const myName   = await getDisplayName(userId, email);
        const participants = [userId, targetUserId];

        await upsertChat(chatId, { type: 'DIRECT', name: chatName, participants });
        await upsertMembership(userId,       chatId, { chatName, chatType: 'DIRECT' });
        await upsertMembership(targetUserId, chatId, { chatName: myName, chatType: 'DIRECT' });

        return ok({ chatId });
      }

      if (type === 'GROUP') {
        if (!courseId) return badRequest('courseId es requerido para chat GROUP');
        const chatId = `group_${courseId}`;
        const chatName = name ?? `Grupo del curso`;
        const participants = [...new Set([userId, ...(participantIds ?? [])])];

        await upsertChat(chatId, { type: 'GROUP', name: chatName, participants });
        await Promise.all(
          participants.map((p) => upsertMembership(p, chatId, { chatName, chatType: 'GROUP' }))
        );

        return ok({ chatId });
      }

      return badRequest(`Tipo de chat no soportado: ${type}`);
    }

    // ── GET /messages/{chatId} — get messages ───────────────────────────────
    const chatMatch = path.match(/^\/messages\/([^/]+)$/);
    if (chatMatch && method === 'GET') {
      const chatId = chatMatch[1]!;

      // Ensure user is a participant (auto-join group chats for legacy/unlisted members)
      let membership = await getUserMembership(userId, chatId);
      if (!membership && chatId.startsWith('group_')) {
        const meta = await getChatMeta(chatId);
        await upsertMembership(userId, chatId, {
          chatName: meta?.name ?? 'Chat del curso',
          chatType: 'GROUP',
        });
        membership = { chatId, chatName: meta?.name ?? 'Chat del curso' };
      }
      if (!membership) return forbidden('No eres participante de este chat');

      const messages = await getMessages(chatId, 50);
      await markChatRead(userId, chatId);

      return ok({ chatId, messages });
    }

    // ── POST /messages/{chatId} — send message ──────────────────────────────
    if (chatMatch && method === 'POST') {
      const chatId = chatMatch[1]!;
      const { text } = body as { text?: string };
      if (!text?.trim()) return badRequest('El mensaje no puede estar vacío');

      let membership = await getUserMembership(userId, chatId);
      if (!membership && chatId.startsWith('group_')) {
        const meta = await getChatMeta(chatId);
        await upsertMembership(userId, chatId, {
          chatName: meta?.name ?? 'Chat del curso',
          chatType: 'GROUP',
        });
        membership = { chatId, chatName: meta?.name ?? 'Chat del curso' };
      }
      if (!membership) return forbidden('No eres participante de este chat');

      const meta = await getChatMeta(chatId);
      const participants: string[] = meta?.participants ?? [userId];

      const senderName = await getDisplayName(userId, email);
      const result = await putMessage({ chatId, senderId: userId, senderName, text: text.trim() });
      await updateChatLastMessage(chatId, participants, userId, text.trim());

      return ok({ ...result, senderId: userId, senderName, text: text.trim() });
    }

    // ── PUT /messages/{chatId}/read — mark as read ──────────────────────────
    const readMatch = path.match(/^\/messages\/([^/]+)\/read$/);
    if (readMatch && method === 'PUT') {
      const chatId = readMatch[1]!;
      await markChatRead(userId, chatId);
      return ok({ ok: true });
    }

    // ── POST /messages/{chatId}/react — toggle emoji reaction ───────────────
    const reactMatch = path.match(/^\/messages\/([^/]+)\/react$/);
    if (reactMatch && method === 'POST') {
      const chatId = reactMatch[1]!;
      const { ts, emoji } = body as { ts?: string; emoji?: string };
      if (!ts || !emoji) return badRequest('ts y emoji son requeridos');
      const membership = await getUserMembership(userId, chatId);
      if (!membership) return forbidden('No eres participante de este chat');
      await reactToMessage(chatId, ts, userId, emoji);
      return ok({ ok: true });
    }

    return notFound('Ruta no encontrada');
  } catch (err) {
    return serverError(err);
  }
};
