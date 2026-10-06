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

export function EnvironmentSections({ data }: { data: any }) {
  const e = data.environments;
  const [open, setOpen] = useState<string | null>(null);
  const totals: Record<string, number> = { prod: e.prod.total, staging: e.staging.total, test: e.test.total };
  const max = Math.max(0.01, ...Object.values(totals));
  const cat = (env: string, c: 'text' | 'image' | 'polly') => (env === 'prod' ? e.prod.byCategory[c] : e[env].byCategory[c]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-800">Costos por ambiente (IA y media)</h2>
        <p className="text-xs text-gray-400 mt-0.5">{e.note}</p>
      </div>
      <div className="p-6 space-y-6">
        <div className="grid md:grid-cols-3 gap-4">
          {ENVS.map((env) => (
            <div key={env.key} className="rounded-xl border border-gray-100 p-4">
              <span className={`text-xs px-2 py-0.5 rounded-full ${env.badge}`}>{env.label}</span>
              <p className="text-2xl font-bold text-gray-900 mt-2">{usd(totals[env.key])}</p>
              <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(totals[env.key] / max) * 100}%`, background: env.color }} />
              </div>
              <ul className="mt-3 space-y-1 text-xs text-gray-600">
                {CATS.map(([c, label]) => (
                  <li key={c} className="flex justify-between"><span>{label}</span><span className="tabular-nums">{usd(cat(env.key, c))}</span></li>
                ))}
              </ul>
              {env.key !== 'prod' && (
                <button onClick={() => setOpen(open === env.key ? null : env.key)} className="mt-3 text-xs text-indigo-600 hover:underline">
                  {open === env.key ? 'Ocultar detalle' : 'Ver detalle por Lambda'}
                </button>
              )}
              {env.key === 'prod' && <p className="mt-3 text-xs text-gray-400">Residual: factura AWS − test − staging</p>}
            </div>
          ))}
        </div>

        <p className="text-sm text-gray-600">
          Factura AWS de IA/media en el periodo: <b>{usd(e.aiBillTotal)}</b> · Infraestructura compartida sin separar: <b>{usd(e.shared.total)}</b>
        </p>

        {(open === 'test' || open === 'staging') && (
          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">Detalle {open} · total estimado {usd(e[open].total)}</p>
            <EnvDetail env={open} d={e[open]} />
          </div>
        )}
      </div>
    </div>
  );
}
