'use client';

import { ChevronRight } from 'lucide-react';

interface Props {
  folder: string;
}

export function FolderBreadcrumb({ folder }: Props) {
  const parts = folder.split('/').filter(Boolean);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1 text-xs text-indigo-600">
          {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300" />}
          <span className={`${i === parts.length - 1 ? 'bg-indigo-50 px-2 py-0.5 rounded-full font-medium' : 'text-gray-400'}`}>
            {i === 0 && '📂 '}{part}
          </span>
        </span>
      ))}
    </div>
  );
}
