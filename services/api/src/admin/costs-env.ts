import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';

// Per-environment attribution beyond AI/media (used by costs.ts):
//  1. Usage shares for Lambda (GB-seconds) and API Gateway (requests) from CloudWatch metrics. The
//     REAL Cost Explorer bill for those services is then split by share — never an invented price
//     (Lambda bills ~$0 under the free tier, so a list-price estimate would overstate it).
//  2. Real cost by the `lux-env` cost-allocation tag, once that tag is activated in Billing.

export type EnvKey = 'test' | 'staging' | 'prod';
export const ENV_KEYS: EnvKey[] = ['test', 'staging', 'prod'];
export const TAG_KEY = 'lux-env';

// HTTP API ids per environment (CLAUDE.md key identifiers; staging id from lib/api.ts).
const API_IDS: Record<EnvKey, string> = { prod: 'v4vabtmerb', test: 'hxnd6tzmce', staging: '1ohrw48nii' };

const region = process.env.AWS_REGION ?? 'us-east-1';
const cw = new CloudWatchClient({ region });
const lambda = new LambdaClient({ region });
const ce = new CostExplorerClient({ region: 'us-east-1' });

const envOfFn = (name: string): EnvKey => (name.endsWith('-test') ? 'test' : name.endsWith('-staging') ? 'staging' : 'prod');
const zero = (): Record<EnvKey, number> => ({ test: 0, staging: 0, prod: 0 });
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const shares = (v: Record<EnvKey, number>) => {
  const t = v.test + v.staging + v.prod;
  return { test: t ? v.test / t : 0, staging: t ? v.staging / t : 0, prod: t ? v.prod / t : 0 };
};

async function metricSums(queries: any[], start: Date, end: Date): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < queries.length; i += 400) {
    let token: string | undefined;
    do {
      const r = await cw.send(new GetMetricDataCommand({ MetricDataQueries: queries.slice(i, i + 400), StartTime: start, EndTime: end, NextToken: token }));
      for (const m of r.MetricDataResults ?? []) out[m.Id!] = (out[m.Id!] ?? 0) + (m.Values ?? []).reduce((s, v) => s + v, 0);
      token = r.NextToken;
    } while (token);
  }
  return out;
}

/** GB-seconds and invocations of every lux-* Lambda, summed per environment. */
export async function lambdaUsage(days: number) {
  const fns: { name: string; memMb: number }[] = [];
  let marker: string | undefined;
  do {
    const r = await lambda.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
    for (const f of r.Functions ?? []) if (f.FunctionName?.startsWith('lux-')) fns.push({ name: f.FunctionName, memMb: f.MemorySize ?? 128 });
    marker = r.NextMarker;
  } while (marker);

  const period = 86400;
  const queries = fns.flatMap((f, i) => ['Duration', 'Invocations'].map((m) => ({
    Id: `${m === 'Duration' ? 'd' : 'i'}${i}`,
    MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: m, Dimensions: [{ Name: 'FunctionName', Value: f.name }] }, Period: period, Stat: 'Sum' },
  })));
  const v = await metricSums(queries, new Date(Date.now() - days * 86_400_000), new Date());

  const gbSeconds = zero(), invocations = zero();
  fns.forEach((f, i) => {
    const env = envOfFn(f.name);
    gbSeconds[env] += ((v[`d${i}`] ?? 0) / 1000) * (f.memMb / 1024);
    invocations[env] += v[`i${i}`] ?? 0;
  });
  // Blend GB-seconds (dominant cost) and requests the way AWS prices them ($0.0000166667/GB-s vs $0.20/M req).
  const weighted = zero();
  for (const e of ENV_KEYS) weighted[e] = gbSeconds[e] * 0.0000166667 + (invocations[e] / 1e6) * 0.2;
  return {
    usage: Object.fromEntries(ENV_KEYS.map((e) => [e, { gbSeconds: round(gbSeconds[e], 0), invocations: Math.round(invocations[e]) }])) as Record<EnvKey, { gbSeconds: number; invocations: number }>,
    shares: shares(weighted),
    functions: fns.length,
  };
}

/** Request counts of each environment's HTTP API. */
export async function apiUsage(days: number) {
  const queries = ENV_KEYS.map((e) => ({
    Id: `a${e}`,
    MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: [{ Name: 'ApiId', Value: API_IDS[e] }] }, Period: 86400, Stat: 'Sum' },
  }));
  const v = await metricSums(queries, new Date(Date.now() - days * 86_400_000), new Date());
  const requests = zero();
  for (const e of ENV_KEYS) requests[e] = Math.round(v[`a${e}`] ?? 0);
  return { requests, shares: shares(requests) };
}

/** Real cost by the lux-env tag. `available` stays false until the tag is active in Billing and has data. */
export async function costByTag(start: string, end: string) {
  const empty = { available: false, key: TAG_KEY, byEnv: { ...zero(), untagged: 0 } as Record<EnvKey | 'untagged', number>, total: 0 };
  try {
    const byEnv = { ...zero(), untagged: 0 } as Record<EnvKey | 'untagged', number>;
    let token: string | undefined;
    do {
      const r = await ce.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: start, End: end }, Granularity: 'MONTHLY', Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'TAG', Key: TAG_KEY }], NextPageToken: token,
      }));
      for (const row of r.ResultsByTime ?? []) {
        for (const g of row.Groups ?? []) {
          const value = String(g.Keys?.[0] ?? '').replace(`${TAG_KEY}$`, '');
          const cost = Number(g.Metrics?.UnblendedCost?.Amount ?? 0);
          if ((ENV_KEYS as string[]).includes(value)) byEnv[value as EnvKey] += cost; else byEnv.untagged += cost;
        }
      }
      token = r.NextPageToken;
    } while (token);
    const tagged = byEnv.test + byEnv.staging + byEnv.prod;
    const total = tagged + byEnv.untagged;
    return {
      available: tagged > 0, key: TAG_KEY, total: round(total),
      byEnv: Object.fromEntries(Object.entries(byEnv).map(([k, x]) => [k, round(x)])) as Record<EnvKey | 'untagged', number>,
    };
  } catch (err: any) {
    console.warn('[costs] tag query failed (ignored):', err?.name);
    return empty;
  }
}
