'use client';

import type { ReactNode } from 'react';

// Tiny Markdown subset (headings, lists, pipe tables, **bold**, `code`) rendered as React nodes —
// no HTML injection path. Enough for the cost chat's answers without adding a dependency.
function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${key}${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={`${key}${i}`} className="bg-gray-100 rounded px-1 text-[0.85em]">{p.slice(1, -1)}</code>;
    return <span key={`${key}${i}`}>{p}</span>;
  });
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const k = `b${i}`;
    if (!line.trim()) continue;

    if (line.includes('|') && lines[i + 1] && isSep(lines[i + 1]!)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      i--;
      out.push(
        <div key={k} className="overflow-x-auto my-2">
          <table className="text-xs border-collapse">
            <thead><tr>{head.map((h, j) => <th key={j} className="border-b border-gray-200 px-2 py-1 text-left font-semibold">{inline(h, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border-b border-gray-100 px-2 py-1">{inline(c, `${k}r${ri}c${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(<p key={k} className="font-semibold text-gray-900 mt-3 mb-1">{inline(h[2]!, k)}</p>); continue; }

    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+\.)\s+/, ''));
      i--;
      const Tag = ordered ? 'ol' : 'ul';
      out.push(<Tag key={k} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-1 space-y-0.5`}>{items.map((it, j) => <li key={j}>{inline(it, `${k}i${j}`)}</li>)}</Tag>);
      continue;
    }

    out.push(<p key={k} className="my-1">{inline(line, k)}</p>);
  }
  return <div className="text-sm text-gray-700 leading-relaxed">{out}</div>;
}
