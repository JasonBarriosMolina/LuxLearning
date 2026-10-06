'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, TrendingUp, TrendingDown, CalendarDays, Gauge, Loader2, AlertCircle, RefreshCw, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { StackedBars, PALETTE } from './_components/StackedBars';

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString('en-US');

function Stat({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-indigo-50 rounded-lg"><Icon className="w-5 h-5 text-indigo-600" /></div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
          {sub && <p className={`text-xs mt-0.5 ${tone === 'up' ? 'text-red-500' : tone === 'down' ? 'text-green-600' : 'text-gray-400'}`}>{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

const th = 'text-left px-3 py-2 text-xs uppercase tracking-wide text-gray-500';
const tdr = 'px-3 py-2 text-right tabular-nums';

export default function CostDashboardPage() {
  const { role, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback((refresh = false) => {
    setLoading(true); setError('');
    api.admin.costs(days, refresh)
      .then(setData)
      .catch((e: any) => setError(e?.statusCode === 403 ? 'Solo SUPER_ADMIN puede ver los costos.' : (e?.message ?? 'No se pudieron cargar los costos')))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { if (role === 'SUPER_ADMIN') load(); }, [role, load]);
  useEffect(() => { if (!authLoading && role && role !== 'SUPER_ADMIN') router.replace('/'); }, [authLoading, role, router]);

  if (authLoading || role !== 'SUPER_ADMIN') {
    return <div className="flex justify-center py-24 text-gray-400"><Lock className="w-6 h-6" /></div>;
  }

  const s = data?.summary;
  const eu = data?.envUsage;
  const hasEnvUsage = eu && (eu.bedrock.length > 0 || eu.media.image.calls > 0 || eu.media.polly.calls > 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cost Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Costos AWS de la plataforma{data ? ` · ${data.from} → ${data.to} · ambiente ${data.env}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Últimos {d} días</option>)}
          </select>
          <button onClick={() => load(true)} disabled={loading}
            className="p-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50" title="Refrescar (consulta Cost Explorer, $0.01)">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}
      {loading && !data && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}

      {data && (
        <>
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-4 py-2">{data.note}{data.cached ? ' · (en caché, ≤30 min)' : ''}</p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat icon={DollarSign} label={`Total ${data.days} días`} value={usd(s.total)}
              sub={s.changePct === null ? undefined : `${s.changePct > 0 ? '+' : ''}${s.changePct}% vs periodo anterior (${usd(s.prevTotal)})`}
              tone={s.changePct === null ? undefined : s.changePct > 0 ? 'up' : 'down'} />
            <Stat icon={Gauge} label="Promedio diario" value={usd(s.avgPerDay)} />
            <Stat icon={CalendarDays} label="Mes en curso" value={usd(s.monthToDate)} sub="acumulado" />
            <Stat icon={s.changePct !== null && s.changePct < 0 ? TrendingDown : TrendingUp} label="Proyección resto del mes"
              value={s.forecastRestOfMonth === null ? '—' : usd(s.forecastRestOfMonth)}
              sub={s.forecastRestOfMonth === null ? 'sin forecast disponible' : `fin de mes ≈ ${usd(s.monthToDate + s.forecastRestOfMonth)}`} />
          </div>

          <Card title="Costo diario por servicio" sub="Top 8 servicios; el resto agrupado en Other">
            <StackedBars rows={data.daily} keys={[...data.topServices, 'Other']} />
          </Card>

          <Card title="Por servicio" sub="Ordenado por gasto en el periodo">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Servicio</th><th className={`${th} text-right`}>Costo</th><th className={`${th} text-right`}>%</th><th className={`${th} text-right`}>Periodo anterior</th><th className={th} style={{ width: '25%' }} /></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.services.map((r: any, i: number) => (
                    <tr key={r.service} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-800">{r.service}</td>
                      <td className={`${tdr} font-semibold text-gray-900`}>{usd(r.cost)}</td>
                      <td className={`${tdr} text-gray-500`}>{r.pct}%</td>
                      <td className={`${tdr} text-gray-400`}>{usd(r.prevCost)}</td>
                      <td className="px-3 py-2">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.pct)}%`, background: PALETTE[Math.min(i, 8)] }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Detalle por tipo de uso" sub="Dónde se va el dinero dentro de cada servicio (top 40, ≥ $0.01)">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white"><tr><th className={th}>Servicio</th><th className={th}>Usage type</th><th className={`${th} text-right`}>Costo</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.usageTypes.map((u: any) => (
                    <tr key={`${u.service}|${u.usageType}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{u.service}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{u.usageType}</td>
                      <td className={`${tdr} font-semibold`}>{usd(u.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {hasEnvUsage ? (
            <Card title={`Consumo IA / media — ambiente ${data.env}`}
              sub={`Estimado con precios de lista (Haiku $${eu.pricing.haikuInPerM}/$${eu.pricing.haikuOutPerM} por M tokens in/out, imagen $${eu.pricing.imageEach}, Polly $${eu.pricing.pollyPerMChars}/M chars). Total estimado: ${usd(eu.total)}`}>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                {(['image', 'polly'] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-gray-50 p-4 text-sm">
                    <p className="font-semibold text-gray-800">{k === 'image' ? 'Imágenes (Stability)' : 'Audio (Polly)'}</p>
                    <p className="text-gray-600 mt-1">{num(eu.media[k].calls)} llamadas · {num(eu.media[k].units)} {k === 'image' ? 'imágenes' : 'caracteres'} · {usd(eu.media[k].cost)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Cap mensual usado: {num(eu.media[k].monthUsed)}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>Lambda</th><th className={th}>Modelo</th><th className={`${th} text-right`}>Llamadas</th><th className={`${th} text-right`}>Tokens in</th><th className={`${th} text-right`}>Tokens out</th><th className={`${th} text-right`}>Costo est.</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {eu.bedrock.map((b: any) => (
                      <tr key={`${b.lambda}|${b.model}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-800">{b.lambda}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500 truncate max-w-[220px]">{b.model}</td>
                        <td className={tdr}>{num(b.calls)}</td><td className={tdr}>{num(b.inTok)}</td><td className={tdr}>{num(b.outTok)}</td>
                        <td className={`${tdr} font-semibold`}>{usd(b.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <p className="text-xs text-gray-400 text-center">
              Sin contadores por ambiente (en prod no se registran; Bedrock factura por modelo, no por ambiente).
            </p>
          )}
        </>
      )}
    </div>
  );
}
