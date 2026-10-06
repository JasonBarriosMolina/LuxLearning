'use client';

import { useState } from 'react';

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString('en-US');
const th = 'text-left px-3 py-2 text-xs uppercase tracking-wide text-gray-500';
const tdr = 'px-3 py-2 text-right tabular-nums';

const ENVS = [
  { key: 'prod', label: 'Producción', color: '#ef4444', badge: 'bg-red-50 text-red-700' },
  { key: 'staging', label: 'Staging', color: '#f59e0b', badge: 'bg-amber-50 text-amber-700' },
  { key: 'test', label: 'Test', color: '#6366f1', badge: 'bg-indigo-50 text-indigo-700' },
] as const;

const CATS = [['text', 'IA texto (Bedrock Claude)'], ['image', 'Imágenes (Stability)'], ['polly', 'Audio (Polly)']] as const;

function EnvDetail({ env, d }: { env: 'test' | 'staging'; d: any }) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        {(['image', 'polly'] as const).map((k) => (
          <div key={k} className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="font-semibold text-gray-800">{k === 'image' ? 'Imágenes (Stability)' : 'Audio (Polly)'}</p>
            <p className="text-gray-600 mt-1">{num(d.media[k].calls)} llamadas · {num(d.media[k].units)} {k === 'image' ? 'imágenes' : 'caracteres'} · {usd(d.media[k].cost)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Cap mensual usado: {num(d.media[k].monthUsed)}</p>
          </div>
        ))}
      </div>
      {d.bedrock.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Lambda</th><th className={th}>Modelo</th><th className={`${th} text-right`}>Llamadas</th><th className={`${th} text-right`}>Tokens in</th><th className={`${th} text-right`}>Tokens out</th><th className={`${th} text-right`}>Costo est.</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {d.bedrock.map((b: any) => (
                <tr key={`${env}|${b.lambda}|${b.model}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-800">{b.lambda}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 truncate max-w-[220px]">{b.model}</td>
                  <td className={tdr}>{num(b.calls)}</td><td className={tdr}>{num(b.inTok)}</td><td className={tdr}>{num(b.outTok)}</td>
                  <td className={`${tdr} font-semibold`}>{usd(b.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-xs text-gray-400">Sin llamadas a Bedrock registradas en el periodo.</p>}
    </div>
  );
}

function TagPanel({ tag }: { tag: any }) {
  if (!tag.available) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
        <p className="font-semibold text-gray-800">Costo real por tag <code className="bg-gray-100 rounded px-1">{tag.key}</code> · pendiente</p>
        <p className="mt-1">Los recursos ya llevan el tag, pero Billing aún no lo reporta como tag de costo (hay que activarlo en Billing → Cost allocation tags y esperar hasta ~24 h). Cuando esté activo, aquí aparecerá el costo real por ambiente, sin estimaciones, solo desde esa fecha.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-green-200 bg-green-50/40 p-4 text-sm">
      <p className="font-semibold text-gray-800">Costo real por tag <code className="bg-gray-100 rounded px-1">{tag.key}</code> (solo recursos etiquetados, desde la activación)</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
        {ENVS.map((e) => <div key={e.key}><p className="text-xs text-gray-500">{e.label}</p><p className="font-bold tabular-nums">{usd(tag.byEnv[e.key])}</p></div>)}
        <div><p className="text-xs text-gray-500">Sin tag</p><p className="font-bold tabular-nums">{usd(tag.byEnv.untagged)}</p></div>
      </div>
    </div>
  );
}

export function EnvironmentSections({ data }: { data: any }) {
  const e = data.environments;
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(0.01, e.totals.prod, e.totals.staging, e.totals.test);
  const cat = (env: string, c: 'text' | 'image' | 'polly') => (env === 'prod' ? e.prod.byCategory[c] : e[env].byCategory[c]);
  const ai = (env: string) => (env === 'prod' ? e.prod.total : e[env].total);
  const cov = e.coverage;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-800">Atribución estimada por ambiente</h2>
        <p className="text-xs text-gray-400 mt-0.5">Reparto aproximado de la factura AWS entre test, staging y prod. No es la factura exacta de cada ambiente.</p>
      </div>
      <div className="p-6 space-y-6">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-700">Atribuido a un ambiente: <b>{usd(cov.attributed)}</b> de {usd(cov.bill)} ({cov.attributedPct}%)</span>
            <span className="text-gray-500">Sin atribuir: <b>{usd(cov.unattributed)}</b></span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden flex">
            {ENVS.map((env) => <div key={env.key} style={{ width: `${cov.bill ? (e.totals[env.key] / cov.bill) * 100 : 0}%`, background: env.color }} title={`${env.label} ${usd(e.totals[env.key])}`} />)}
          </div>
        </div>

        {cov.aiBeforeCounters > 0 && (
          <p className="text-xs rounded-lg bg-red-50 text-red-700 px-4 py-2">
            {usd(cov.aiBeforeCounters)} de IA/media es anterior a los contadores por ambiente
            {cov.countersSince ? ` (activos desde ${cov.countersSince})` : ' (aún no hay contadores)'} y no se puede asignar a test, staging o prod: queda en "sin atribuir".
          </p>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          {ENVS.map((env) => (
            <div key={env.key} className="rounded-xl border border-gray-100 p-4">
              <span className={`text-xs px-2 py-0.5 rounded-full ${env.badge}`}>{env.label}</span>
              <p className="text-2xl font-bold text-gray-900 mt-2">{usd(e.totals[env.key])}</p>
              <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(e.totals[env.key] / max) * 100}%`, background: env.color }} />
              </div>
              <ul className="mt-3 space-y-1 text-xs text-gray-600">
                <li className="flex justify-between font-medium text-gray-700"><span>IA y media (estimado)</span><span className="tabular-nums">{usd(ai(env.key))}</span></li>
                {CATS.map(([c, label]) => (
                  <li key={c} className="flex justify-between pl-3 text-gray-500"><span>{label}</span><span className="tabular-nums">{usd(cat(env.key, c))}</span></li>
                ))}
                <li className="flex justify-between"><span>Lambda (por uso)</span><span className="tabular-nums">{usd(e.infra.lambda.byEnv[env.key])}</span></li>
                <li className="flex justify-between"><span>API Gateway (por uso)</span><span className="tabular-nums">{usd(e.infra.api.byEnv[env.key])}</span></li>
              </ul>
              {env.key !== 'prod' && (
                <button onClick={() => setOpen(open === env.key ? null : env.key)} className="mt-3 text-xs text-indigo-600 hover:underline">
                  {open === env.key ? 'Ocultar detalle' : 'Ver detalle de IA por Lambda'}
                </button>
              )}
              {env.key === 'prod' && <p className="mt-3 text-xs text-gray-400">IA/media de prod = factura AWS − test − staging, solo desde que existen contadores (residual)</p>}
            </div>
          ))}
        </div>

        <div className="text-xs text-gray-500 space-y-1">
          <p>Uso medido (periodo): Lambda {ENVS.map((env) => `${env.label} ${num(e.infra.lambda.usage[env.key].invocations)} inv.`).join(' · ')} · API Gateway {ENVS.map((env) => `${env.label} ${num(e.infra.api.requests[env.key])} req.`).join(' · ')}</p>
          <p>Lambda y API Gateway usan la factura real repartida por uso; hoy esa factura es casi $0 por el free tier, por eso sus importes son pequeños.</p>
        </div>

        <TagPanel tag={e.tag} />

        <div className="rounded-lg bg-amber-50 text-amber-800 text-xs px-4 py-3 space-y-1">
          <p className="font-semibold">Qué NO está separado por ambiente ({usd(e.shared.total)} compartido)</p>
          <p>EC2, Security Hub, VPC/IPs, Secrets Manager, KMS, S3, DynamoDB, CloudWatch y similares. La cuenta AWS también contiene recursos ajenos a Lux. Neon, Vercel y Vapi no aparecen en esta factura.</p>
          <p>{e.note}</p>
        </div>

        {(open === 'test' || open === 'staging') && (
          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">Detalle de IA en {open} · total estimado {usd(e[open].total)}</p>
            <EnvDetail env={open} d={e[open]} />
          </div>
        )}
      </div>
    </div>
  );
}
