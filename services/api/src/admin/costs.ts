import {
  CostExplorerClient, GetCostAndUsageCommand, GetCostForecastCommand,
} from '@aws-sdk/client-cost-explorer';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from '../shared/db-dynamo';
import { getCurrentEnv } from '../shared/env-context';
import { ok, forbidden } from '../shared/response';
import type { AdminCtx } from './ctx';

// GET /admin/costs?days=30[&refresh=1]  — SUPER_ADMIN only.
// Two sources:
//  1. Cost Explorer (real AWS bill, account-wide: prod + staging + test together, daily).
//  2. LuxMediaUsage counters (test/staging only): Bedrock tokens per Lambda/model and
//     image/Polly units, priced here with list prices → estimated per-env spend.
// Cost Explorer bills $0.01 per request, so results are cached in-memory per container.

const ce = new CostExplorerClient({ region: 'us-east-1' }); // CE only exists in us-east-1

// USD list prices used for the per-env estimate (Bedrock bills by model, not by caller).
const PRICE = {
  haikuInPerM: 1, haikuOutPerM: 5,
  imageEach: 0.04,
  pollyPerMChars: 16,
};

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; data: any }>();

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const round = (n: number) => Math.round(n * 100) / 100;

async function costAndUsage(start: string, end: string) {
  const rows: any[] = [];
  let token: string | undefined;
  do {
    const res = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }],
      NextPageToken: token,
    }));
    rows.push(...(res.ResultsByTime ?? []));
    token = res.NextPageToken;
  } while (token);
  return rows;
}

function summarize(rows: any[], from: string) {
  const byService: Record<string, number> = {};
  const byDay: Record<string, Record<string, number>> = {};
  const usage: Record<string, { service: string; usageType: string; cost: number; qty: number }> = {};
  for (const r of rows) {
    const day: string = r.TimePeriod.Start;
    if (day < from) continue;
    for (const g of r.Groups ?? []) {
      const [service, usageType] = g.Keys as string[];
      const cost = Number(g.Metrics?.UnblendedCost?.Amount ?? 0);
      if (!cost) continue;
      byService[service] = (byService[service] ?? 0) + cost;
      (byDay[day] ??= {})[service] = ((byDay[day][service]) ?? 0) + cost;
      const k = `${service}|${usageType}`;
      usage[k] ??= { service, usageType, cost: 0, qty: 0 };
      usage[k].cost += cost;
    }
  }
  return { byService, byDay, usage: Object.values(usage) };
}

async function mediaUsage(days: number) {
  const today = new Date();
  const dates = Array.from({ length: days }, (_, i) => isoDay(addDays(today, -i)));
  const results = await Promise.all(dates.map((d) => ddb.send(new QueryCommand({
    TableName: TABLES.MEDIA_USAGE,
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': `use#${d}` },
  })).then((r: any) => ({ d, items: (r.Items ?? []) as any[] })).catch(() => ({ d, items: [] as any[] }))));

  const daily: Record<string, number> = {};
  const bedrock: Record<string, { lambda: string; model: string; calls: number; inTok: number; outTok: number; cost: number }> = {};
  const media = { image: { calls: 0, units: 0, cost: 0 }, polly: { calls: 0, units: 0, cost: 0 } };
  for (const { d, items } of results) {
    for (const it of items) {
      const sk = String(it.sk);
      if (sk.startsWith('bedrock#')) {
        const [, lambda, ...m] = sk.split('#');
        const model = m.join('#');
        const inTok = Number(it.inTok ?? 0), outTok = Number(it.outTok ?? 0);
        const cost = (inTok * PRICE.haikuInPerM + outTok * PRICE.haikuOutPerM) / 1e6;
        const key = `${lambda}|${model}`;
        const b = (bedrock[key] ??= { lambda, model, calls: 0, inTok: 0, outTok: 0, cost: 0 });
        b.calls += Number(it.calls ?? 0); b.inTok += inTok; b.outTok += outTok; b.cost += cost;
        daily[d] = (daily[d] ?? 0) + cost;
      } else if (sk === 'image' || sk === 'polly') {
        const units = Number(it.units ?? 0);
        const cost = sk === 'image' ? units * PRICE.imageEach : (units / 1e6) * PRICE.pollyPerMChars;
        media[sk].calls += Number(it.calls ?? 0); media[sk].units += units; media[sk].cost += cost;
        daily[d] = (daily[d] ?? 0) + cost;
      }
    }
  }

  const month = isoDay(today).slice(0, 7);
  const caps = await Promise.all(['image', 'polly'].map((kind) => ddb.send(new QueryCommand({
    TableName: TABLES.MEDIA_USAGE,
    KeyConditionExpression: 'pk = :p AND sk = :s',
    ExpressionAttributeValues: { ':p': `cap#${month}`, ':s': kind },
  })).then((r: any) => [kind, Number(r.Items?.[0]?.used ?? 0)] as const).catch(() => [kind, 0] as const)));

  const bedrockRows = Object.values(bedrock).map((b) => ({ ...b, cost: round(b.cost) })).sort((a, b) => b.cost - a.cost);
  return {
    pricing: PRICE,
    bedrock: bedrockRows,
    media: {
      image: { ...media.image, cost: round(media.image.cost), monthUsed: Object.fromEntries(caps).image },
      polly: { ...media.polly, cost: round(media.polly.cost), monthUsed: Object.fromEntries(caps).polly },
    },
    daily: Object.entries(daily).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, cost]) => ({ date, cost: round(cost) })),
    total: round(bedrockRows.reduce((s, b) => s + b.cost, 0) + media.image.cost + media.polly.cost),
  };
}

async function forecast() {
  try {
    const now = new Date();
    const start = isoDay(addDays(now, 1));
    const end = isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
    if (start >= end) return null; // last day of month: nothing left to forecast
    const r = await ce.send(new GetCostForecastCommand({
      TimePeriod: { Start: start, End: end }, Metric: 'UNBLENDED_COST', Granularity: 'MONTHLY',
    }));
    return round(Number(r.Total?.Amount ?? 0));
  } catch { return null; }
}

async function build(days: number) {
  const now = new Date();
  const end = isoDay(addDays(now, 1)); // End is exclusive → include today
  const from = isoDay(addDays(now, -(days - 1)));
  const prevFrom = isoDay(addDays(now, -(2 * days - 1)));
  const [rows, media, fc] = await Promise.all([costAndUsage(prevFrom, end), mediaUsage(days), forecast()]);

  const cur = summarize(rows, from);
  const prev = summarize(rows.filter((r) => r.TimePeriod.Start < from), prevFrom);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
  const total = sum(cur.byService), prevTotal = sum(prev.byService);

  const monthStart = `${isoDay(now).slice(0, 7)}-01`;
  const monthToDate = round(sum(summarize(rows, monthStart).byService));

  const services = Object.entries(cur.byService)
    .map(([service, cost]) => ({
      service, cost: round(cost), pct: total ? round((cost / total) * 100) : 0,
      prevCost: round(prev.byService[service] ?? 0),
    }))
    .sort((a, b) => b.cost - a.cost);

  const top = services.slice(0, 8).map((s) => s.service);
  const daily = Object.keys(cur.byDay).sort().map((date) => {
    const row: Record<string, number | string> = { date, Other: 0 };
    let other = 0, all = 0;
    for (const [svc, c] of Object.entries(cur.byDay[date])) {
      all += c;
      if (top.includes(svc)) row[svc] = round(c); else other += c;
    }
    row.Other = round(other); row.total = round(all);
    return row;
  });

  return {
    env: getCurrentEnv(), days, from, to: isoDay(now), generatedAt: now.toISOString(),
    note: 'Cost Explorer es account-wide (prod + staging + test). Los datos del último día pueden estar incompletos (~24h de retraso).',
    summary: {
      total: round(total), prevTotal: round(prevTotal),
      changePct: prevTotal ? round(((total - prevTotal) / prevTotal) * 100) : null,
      avgPerDay: round(total / days), monthToDate, forecastRestOfMonth: fc,
    },
    topServices: top,
    services,
    daily,
    usageTypes: cur.usage.map((u) => ({ ...u, cost: round(u.cost) })).filter((u) => u.cost >= 0.01)
      .sort((a, b) => b.cost - a.cost).slice(0, 40),
    envUsage: media, // this env's own counters (test/staging); empty in prod
  };
}

export async function handleCosts(ctx: AdminCtx): Promise<any | null> {
  const { method, path, event } = ctx;
  if (!(method === 'GET' && path === '/admin/costs')) return null;

  if (event.requestContext.authorizer?.lambda?.role !== 'SUPER_ADMIN') {
    return forbidden('Solo SUPER_ADMIN puede ver los costos');
  }

  const days = Math.min(90, Math.max(7, parseInt(event.queryStringParameters?.days ?? '30', 10) || 30));
  const key = `${getCurrentEnv()}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS && event.queryStringParameters?.refresh !== '1') {
    return ok({ ...hit.data, cached: true });
  }
  const data = await build(days);
  cache.set(key, { at: Date.now(), data });
  return ok({ ...data, cached: false });
}
