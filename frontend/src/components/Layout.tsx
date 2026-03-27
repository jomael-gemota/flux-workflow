import type { ReactNode } from 'react';
import { ScrollText, ChevronUp, ChevronDown } from 'lucide-react';
import { Toolbar } from './Toolbar';
import { WorkflowSidebar } from './WorkflowSidebar';
import { useWorkflowStore } from '../store/workflowStore';
import { useResizablePanel } from '../hooks/useResizablePanel';

// ── Persistence keys ──────────────────────────────────────────────────────────
const LS_CONFIG_W = 'wap_panel_config_width';
const LS_LOG_H    = 'wap_panel_log_height';

// ── Size constraints ──────────────────────────────────────────────────────────
const CONFIG_DEFAULT = 288;   // ≈ w-72
const CONFIG_MIN     = 200;
const CONFIG_MAX     = 560;

const LOG_DEFAULT    = 220;
const LOG_MIN        = 100;
const LOG_MAX        = 500;

// ── Layout ────────────────────────────────────────────────────────────────────

interface LayoutProps {
  canvas:       ReactNode;
  configPanel:  ReactNode;
  executionLog: ReactNode;
}

export function Layout({ canvas, configPanel, executionLog }: LayoutProps) {
  const { logOpen, setLogOpen, configOpen } = useWorkflowStore();

  const [configWidth, startConfigDrag] = useResizablePanel(
    LS_CONFIG_W, CONFIG_DEFAULT, CONFIG_MIN, CONFIG_MAX,
    'x', true,
  );

  const [logHeight, startLogDrag] = useResizablePanel(
    LS_LOG_H, LOG_DEFAULT, LOG_MIN, LOG_MAX,
    'y', true,
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden">
      <Toolbar />

      {/* ── Main row: sidebar | middle column | config panel ── */}
      <div className="flex flex-1 min-h-0">
        <WorkflowSidebar />

        {/* ── Middle column: canvas + log + bottom bar ────────── */}
        <div className="flex flex-1 min-w-0 flex-col">

          {/* Canvas — fills all remaining vertical space */}
          <div className="flex-1 min-h-0 relative">{canvas}</div>

          {/* Execution log panel (slides up above the bottom bar) */}
          {logOpen && (
            <>
              <div
                className="h-1 shrink-0 cursor-row-resize group relative"
                onMouseDown={startLogDrag}
                title="Drag to resize"
              >
                <div className="absolute inset-0 bg-slate-700 group-hover:bg-blue-500 transition-colors duration-150" />
                <div className="absolute inset-x-0 -inset-y-1" />
              </div>
              <div className="shrink-0 overflow-hidden" style={{ height: logHeight }}>
                {executionLog}
              </div>
            </>
          )}

          {/* Bottom bar — always visible */}
          <div className="h-8 shrink-0 bg-slate-900 border-t border-slate-700 flex items-stretch">
            <button
              onClick={() => setLogOpen(!logOpen)}
              className={`flex items-center gap-1.5 px-4 text-xs font-medium border-r border-slate-700 transition-colors ${
                logOpen
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
              title={logOpen ? 'Collapse execution log' : 'Open execution log'}
            >
              <ScrollText className="w-3.5 h-3.5" />
              Logs
              {logOpen
                ? <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />
                : <ChevronUp   className="w-3 h-3 ml-0.5 opacity-60" />
              }
            </button>
            <div className="flex-1" />
          </div>

        </div>

        {/* ── Config panel — full height, sibling of sidebar ─── */}
        {configOpen && (
          <>
            <div
              className="w-1 shrink-0 cursor-col-resize group relative"
              onMouseDown={startConfigDrag}
              title="Drag to resize"
            >
              <div className="absolute inset-0 bg-slate-700 group-hover:bg-blue-500 transition-colors duration-150" />
              <div className="absolute inset-y-0 -inset-x-1" />
            </div>
            {/*
              Outer shell: shrink-0 fixes the width, overflow-hidden clips any
              content that tries to escape the flex-row boundary.
              Inner layer: flex-1 + min-h-0 + overflow-y-auto gives us a true
              scrollable area that is bounded by the panel's available height.
            */}
            <div
              className="flex flex-col bg-slate-900 border-l border-slate-700 shrink-0 overflow-hidden"
              style={{ width: configWidth }}
            >
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                {configPanel}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
