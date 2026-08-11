'use client';

import { useState } from 'react';
import { FolderOpen, FolderClosed, ChevronRight } from 'lucide-react';

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  count: number;
  total: number;
}

export interface Resource {
  folder?: string;
  [key: string]: any;
}

export function buildTree(resources: Resource[]): FolderNode[] {
  const map = new Map<string, FolderNode>();

  for (const r of resources) {
    if (!r.folder) continue;
    const parts = r.folder.split('/').map((p: string) => p.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      if (!map.has(path)) {
        map.set(path, { name: parts[i]!, path, children: [], count: 0, total: 0 });
      }
      if (i === parts.length - 1) {
        map.get(path)!.count++;
      }
    }
  }

  const roots: FolderNode[] = [];
  for (const [path, node] of map) {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
      roots.push(node);
    } else {
      const parentPath = path.slice(0, lastSlash);
      map.get(parentPath)?.children.push(node);
    }
  }

  function computeTotal(node: FolderNode): number {
    node.total = node.count + node.children.reduce((s, c) => s + computeTotal(c), 0);
    return node.total;
  }
  roots.forEach(computeTotal);

  function sortNode(node: FolderNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortNode);
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortNode);

  return roots;
}

interface Props {
  nodes: FolderNode[];
  selected: string | null;
  onSelect: (path: string | null) => void;
  depth?: number;
}

export function FolderTree({ nodes, selected, onSelect, depth = 0 }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setExpanded((prev) => { const s = new Set(prev); s.has(path) ? s.delete(path) : s.add(path); return s; });

  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const isSelected = selected === node.path;
        const isExpanded = expanded.has(node.path);
        const hasChildren = node.children.length > 0;
        return (
          <li key={node.path}>
            <div
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors select-none
                ${isSelected ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-surface'}`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {hasChildren ? (
                <button onClick={() => toggle(node.path)} className="shrink-0 text-gray-400 hover:text-gray-600">
                  {isExpanded
                    ? <ChevronRight className="w-3.5 h-3.5 rotate-90 transition-transform" />
                    : <ChevronRight className="w-3.5 h-3.5 transition-transform" />}
                </button>
              ) : (
                <span className="w-3.5 h-3.5 shrink-0" />
              )}
              <button
                onClick={() => onSelect(isSelected ? null : node.path)}
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
              >
                {isExpanded || isSelected
                  ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                  : <FolderClosed className="w-3.5 h-3.5 shrink-0 text-gray-400" />}
                <span className="truncate">{node.name}</span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{node.total}</span>
              </button>
            </div>
            {isExpanded && hasChildren && (
              <FolderTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
