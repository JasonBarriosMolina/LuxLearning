import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const CHATS_TABLE = process.env.DYNAMO_TABLE_CHATS ?? 'LuxChats';
const MSGS_TABLE  = process.env.DYNAMO_TABLE_MESSAGES ?? 'LuxMessages';

function msgId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Chats ──────────────────────────────────────────────────────────────────────

export async function getChatsForUser(userId: string): Promise<any[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: CHATS_TABLE,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `USER#${userId}` },
  }));
  const items = (res.Items ?? []).sort((a, b) => (b.lastTs ?? '').localeCompare(a.lastTs ?? ''));
  // Enrich any membership records missing chatName by fetching the chat META record
  const missing = items.filter((i) => !i.chatName);
  if (missing.length > 0) {
    const metas = await Promise.all(missing.map((i) => getChatMeta(i.chatId)));
    metas.forEach((meta, idx) => { if (meta?.name) missing[idx].chatName = meta.name; });
  }
  return items;
}

export async function getChatMeta(chatId: string): Promise<any | null> {
  const res = await ddb.send(new GetCommand({
    TableName: CHATS_TABLE,
    Key: { pk: `CHAT#${chatId}`, sk: 'META' },
  }));
  return res.Item ?? null;
}

export async function getUserMembership(userId: string, chatId: string): Promise<any | null> {
  const res = await ddb.send(new GetCommand({
    TableName: CHATS_TABLE,
    Key: { pk: `USER#${userId}`, sk: chatId },
  }));
  return res.Item ?? null;
}

export async function upsertChat(chatId: string, meta: {
  type: string; name: string; participants: string[];
}): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: CHATS_TABLE,
    Item: { pk: `CHAT#${chatId}`, sk: 'META', chatId, ...meta, createdAt: now, lastTs: now },
    ConditionExpression: 'attribute_not_exists(pk)',
  })).catch(() => {}); // ignore if already exists
}

export async function upsertMembership(userId: string, chatId: string, meta: {
  chatName: string; chatType: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: CHATS_TABLE,
    Item: { pk: `USER#${userId}`, sk: chatId, chatId, ...meta, unread: 0, lastTs: now },
    ConditionExpression: 'attribute_not_exists(pk)',
  })).catch(() => {});
}

export async function updateChatLastMessage(
  chatId: string,
  participants: string[],
  senderId: string,
  text: string,
): Promise<void> {
  const now = new Date().toISOString();
  const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;

  // Update chat META record
  await ddb.send(new UpdateCommand({
    TableName: CHATS_TABLE,
    Key: { pk: `CHAT#${chatId}`, sk: 'META' },
    UpdateExpression: 'SET lastMessage = :msg, lastTs = :ts',
    ExpressionAttributeValues: { ':msg': preview, ':ts': now },
  })).catch(() => {});

  // Increment unread for all participants except sender; update lastMessage for all
  await Promise.all(
    participants.map((p) => {
      const isSender = p === senderId;
      return ddb.send(new UpdateCommand({
        TableName: CHATS_TABLE,
        Key: { pk: `USER#${p}`, sk: chatId },
        UpdateExpression: isSender
          ? 'SET lastMessage = :msg, lastTs = :ts'
          : 'SET lastMessage = :msg, lastTs = :ts ADD #u :one',
        ExpressionAttributeNames: isSender ? undefined : { '#u': 'unread' },
        ExpressionAttributeValues: isSender
          ? { ':msg': preview, ':ts': now }
          : { ':msg': preview, ':ts': now, ':one': 1 },
      })).catch(() => {});
    }),
  );
}

export async function markChatRead(userId: string, chatId: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: CHATS_TABLE,
    Key: { pk: `USER#${userId}`, sk: chatId },
    UpdateExpression: 'SET #u = :zero',
    ExpressionAttributeNames: { '#u': 'unread' },
    ExpressionAttributeValues: { ':zero': 0 },
  })).catch(() => {});
}

// ── Messages ───────────────────────────────────────────────────────────────────

export async function getMessages(chatId: string, limit = 50): Promise<any[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: MSGS_TABLE,
    KeyConditionExpression: 'chatId = :cid',
    ExpressionAttributeValues: { ':cid': chatId },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (res.Items ?? []).reverse(); // chronological order (oldest first)
}

export async function putMessage(msg: {
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
}): Promise<{ ts: string; createdAt: string }> {
  const now = new Date().toISOString();
  const ts = `${now}#${msgId()}`;
  await ddb.send(new PutCommand({
    TableName: MSGS_TABLE,
    Item: { ...msg, ts, createdAt: now },
  }));
  return { ts, createdAt: now };
}

// ── Reactions ──────────────────────────────────────────────────────────────────
// reactions stored as a map: { [emoji]: [userId, ...] } in the message record

export async function reactToMessage(
  chatId: string,
  ts: string,
  userId: string,
  emoji: string,
): Promise<void> {
  // First get current reactions to do toggle logic
  const res = await ddb.send(new QueryCommand({
    TableName: MSGS_TABLE,
    KeyConditionExpression: 'chatId = :cid AND #ts = :ts',
    ExpressionAttributeNames: { '#ts': 'ts' },
    ExpressionAttributeValues: { ':cid': chatId, ':ts': ts },
    Limit: 1,
  }));
  const msg = res.Items?.[0];
  if (!msg) return;

  const reactions: Record<string, string[]> = msg.reactions ?? {};
  const existing = reactions[emoji] ?? [];
  const alreadyReacted = existing.includes(userId);

  if (alreadyReacted) {
    // Remove reaction
    const updated = existing.filter((u) => u !== userId);
    if (updated.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = updated;
    }
  } else {
    reactions[emoji] = [...existing, userId];
  }

  await ddb.send(new UpdateCommand({
    TableName: MSGS_TABLE,
    Key: { chatId, ts },
    UpdateExpression: 'SET reactions = :r',
    ExpressionAttributeValues: { ':r': reactions },
  })).catch(() => {});
}
