'use client';

import { useState } from 'react';

export const PALETTE = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#9ca3af'];

type Row = Record<string, number | string>;

export function StackedBars({ rows, keys }: { rows: Row[]; keys: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800, H = 240, padL = 44, padB = 22, padT = 8;
  const max = Math.max(0.01, ...rows.map((r) => Number(r.total ?? 0)));
  const bw = (W - padL) / Math.max(rows.length, 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Costo diario por servicio">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#9ca3af">${t.toFixed(t < 10 ? 1 : 0)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          let acc = 0;
          return (
            <g key={String(r.date)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {keys.map((k, ki) => {
                const v = Number(r[k] ?? 0);
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return <rect key={k} x={padL + i * bw + 1} y={y1} width={Math.max(1, bw - 2)} height={Math.max(0, y0 - y1)}
                  fill={PALETTE[ki % PALETTE.length]} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })}
              {(i % Math.ceil(rows.length / 8) === 0) && (
                <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#9ca3af">{String(r.date).slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div className="absolute top-0 right-0 bg-white border border-gray-200 shadow-lg rounded-lg p-3 text-xs space-y-0.5 pointer-events-none">
          <p className="font-semibold text-gray-800">{String(rows[hover].date)} · ${Number(rows[hover].total).toFixed(2)}</p>
          {keys.filter((k) => Number(rows[hover][k] ?? 0) > 0).map((k) => (
            <p key={k} className="flex items-center gap-1.5 text-gray-600">
              <span className="w-2 h-2 rounded-sm" style={{ background: PALETTE[keys.indexOf(k) % PALETTE.length] }} />
              {k}: ${Number(rows[hover][k]).toFixed(2)}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {keys.map((k, i) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />{k}
          </span>
        ))}
      </div>
    </div>
  );
}
