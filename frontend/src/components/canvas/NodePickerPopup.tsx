import { useEffect, useRef, useState } from 'react';
import { Plus, Search, ChevronDown, ChevronRight, X, GripVertical } from 'lucide-react';
import { NodeIcon, nodeHeaderColor } from '../nodes/NodeIcons';
import type { NodeType } from '../../types/workflow';

// ── Catalogue ─────────────────────────────────────────────────────────────────

interface PaletteNode {
  type: NodeType;
  label: string;
  description: string;
}

interface PaletteCategory {
  id: string;
  label: string;
  nodes: PaletteNode[];
}

const CATEGORIES: PaletteCategory[] = [
  {
    id: 'triggers',
    label: 'Triggers',
    nodes: [
      { type: 'trigger', label: 'Trigger', description: 'Manual, webhook, schedule, app event, or email trigger' },
    ],
  },
  {
    id: 'api',
    label: 'REST API',
    nodes: [
      { type: 'http', label: 'HTTP Request', description: 'Call any REST endpoint' },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    nodes: [
      { type: 'llm', label: 'LLM', description: 'OpenAI language model' },
    ],
  },
  {
    id: 'flow',
    label: 'Flow Control',
    nodes: [
      { type: 'condition', label: 'Condition', description: 'If / else branch' },
      { type: 'switch',    label: 'Switch',    description: 'Multi-path routing' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    nodes: [
      { type: 'transform', label: 'Transform', description: 'Map & reshape values' },
      { type: 'output',    label: 'Output',    description: 'Final workflow result' },
    ],
  },
  {
    id: 'apps',
    label: 'Applications',
    nodes: [
      { type: 'gmail',   label: 'Gmail',         description: 'Send, list, read emails'               },
      { type: 'gdrive',  label: 'Google Drive',  description: 'Manage files & folders'                },
      { type: 'gdocs',   label: 'Google Docs',   description: 'Create & edit documents'               },
      { type: 'gsheets', label: 'Google Sheets', description: 'Read & write spreadsheets'             },
      { type: 'slack',   label: 'Slack',              description: 'Send messages, DMs, upload files, read channels' },
      { type: 'teams',   label: 'Microsoft Teams',     description: 'Send messages, DMs, read channel messages' },
      { type: 'basecamp', label: 'Basecamp',            description: 'To-dos, messages, comments, Campfire chat' },
    ],
  },
];

// ── Individual draggable + clickable node row ─────────────────────────────────

function NodeRow({
  node,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  node: PaletteNode;
  onSelect: (type: NodeType, label: string) => void;
  onDragStart: (e: React.DragEvent, type: NodeType, label: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, node.type, node.label)}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(node.type, node.label)}
      title={`Click to add · Drag to place on canvas`}
      className="flex items-center gap-3 rounded-lg px-2.5 py-2 cursor-grab active:cursor-grabbing select-none
                 hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/8 dark:active:bg-white/15 transition-colors group"
    >
      {/* Drag handle hint */}
      <GripVertical className="w-3 h-3 text-slate-300 dark:text-white/20 group-hover:text-slate-400 dark:group-hover:text-white/40 shrink-0 -mr-1 transition-colors" />

      {/* Icon — uses the node's brand color, matching canvas squares */}
      <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${nodeHeaderColor(node.type)}`}>
        <NodeIcon type={node.type} size={16} />
      </span>

      {/* Label + description */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-gray-800 dark:text-white/90 leading-none truncate">{node.label}</p>
        <p className="text-[10px] text-slate-400 dark:text-white/40 leading-none mt-1 truncate">{node.description}</p>
      </div>
    </div>
  );
}

// ── Collapsible category ──────────────────────────────────────────────────────

function CategorySection({
  category,
  query,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  category: PaletteCategory;
  query: string;
  onSelect: (type: NodeType, label: string) => void;
  onDragStart: (e: React.DragEvent, type: NodeType, label: string) => void;
  onDragEnd: () => void;
}) {
  const filtered = query
    ? category.nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(query) ||
          n.description.toLowerCase().includes(query)
      )
    : category.nodes;

  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (query && filtered.length > 0) setOpen(true);
  }, [query, filtered.length]);

  if (filtered.length === 0) return null;

  return (
    <div>
      {/* Category header */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
      >
        <span className="text-[10px] font-semibold text-slate-400 dark:text-white/30 uppercase tracking-widest group-hover:text-slate-500 dark:group-hover:text-white/50 transition-colors">
          {category.label}
        </span>
        {open
          ? <ChevronDown  className="w-3 h-3 text-slate-300 dark:text-white/20 group-hover:text-slate-400 dark:group-hover:text-white/40" />
          : <ChevronRight className="w-3 h-3 text-slate-300 dark:text-white/20 group-hover:text-slate-400 dark:group-hover:text-white/40" />
        }
      </button>

      {open && (
        <div className="px-1.5 pb-1.5 space-y-0.5">
          {filtered.map((node) => (
            <NodeRow
              key={node.type}
              node={node}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface NodePickerPopupProps {
  onSelect: (type: NodeType, label: string) => void;
}

export function NodePickerPopup({ onSelect }: NodePickerPopupProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click — but NOT during a drag (avoids accidental close)
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (isDragging) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, isDragging]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Auto-focus search when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
      setQuery('');
    }
  }, [open]);

  function handleSelect(type: NodeType, label: string) {
    onSelect(type, label);
    setOpen(false);
    setQuery('');
  }

  function handleDragStart(e: React.DragEvent, type: NodeType, label: string) {
    e.dataTransfer.setData('application/workflow-node-type', type);
    e.dataTransfer.setData('application/workflow-node-label', label);
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }

  function handleDragEnd() {
    setIsDragging(false);
    // Close the picker after a successful drag-drop onto the canvas
    setTimeout(() => setOpen(false), 150);
  }

  const q = query.toLowerCase().trim();
  const hasResults = CATEGORIES.some((c) =>
    c.nodes.some(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q)
    )
  );

  return (
    <div ref={panelRef} className="absolute top-3 left-3 z-10 flex flex-col items-start">

      {/* ── Trigger button ───────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        title="Add a node"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold shadow-lg transition-all duration-200 select-none border ${
          open
            ? 'bg-blue-600 border-blue-500 text-white shadow-blue-600/25'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-white shadow-black/10 dark:shadow-black/40'
        }`}
      >
        <Plus
          className={`w-4 h-4 transition-transform duration-300 ${open ? 'rotate-45' : ''}`}
        />
        Add Node
      </button>

      {/* ── Floating panel ───────────────────────────────────────────────── */}
      {open && (
        <div
          className="mt-2 w-72 flex flex-col rounded-2xl overflow-hidden
                     bg-white dark:bg-slate-900
                     border border-slate-200 dark:border-slate-700
                     shadow-2xl shadow-black/10 dark:shadow-black/60"
          style={{ maxHeight: 'calc(100vh - 130px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2 shrink-0">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 tracking-wide">Node Types</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2.5 shrink-0">
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 focus-within:border-blue-500 transition-all">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search nodes…"
                className="flex-1 bg-transparent text-slate-700 dark:text-slate-200 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-slate-200 dark:bg-slate-700/70 mx-3 shrink-0" />

          {/* Scrollable node list */}
          <div className="overflow-y-auto flex-1 py-2
                          scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent
                          hover:scrollbar-thumb-white/20">
            {CATEGORIES.map((cat) => (
              <CategorySection
                key={cat.id}
                category={cat}
                query={q}
                onSelect={handleSelect}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
            ))}

            {/* Empty state */}
            {q && !hasResults && (
              <div className="py-8 text-center">
                <p className="text-xs text-slate-400 dark:text-white/30">
                  No nodes match{' '}
                  <span className="text-slate-500 dark:text-white/50">"{query}"</span>
                </p>
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="shrink-0 px-4 py-2.5 border-t border-slate-100 dark:border-white/8 flex items-center gap-3">
            <span className="text-[10px] text-slate-400 dark:text-white/20">
              Click to add · Drag to place
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
