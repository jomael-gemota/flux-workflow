import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Layers, PlusCircle, Save, Play, KeyRound, UserCircle } from 'lucide-react';
import { useTourStore } from '../../store/tourStore';

// ── Step definitions ──────────────────────────────────────────────────────────

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface TourStep {
  targetId: string;
  title: string;
  description: string;
  placement: Placement;
  icon: React.ReactNode;
}

const STEPS: TourStep[] = [
  {
    targetId: 'tour-sidebar',
    title: 'Workflows & Projects',
    description: 'Create and organise your workflows into projects. Drag to reorder, rename, or group them together.',
    placement: 'right',
    icon: <Layers className="w-4 h-4" />,
  },
  {
    targetId: 'tour-add-node-btn',
    title: 'Add Nodes',
    description: 'Click here to browse all available node types — triggers, AI models, REST API calls, Google apps, Slack, Teams, and more.',
    placement: 'right',
    icon: <PlusCircle className="w-4 h-4" />,
  },
  {
    targetId: 'tour-save-btn',
    title: 'Save Workflow',
    description: 'Save your workflow at any time. You can also press Ctrl+S (or Cmd+S on Mac) as a quick shortcut.',
    placement: 'bottom',
    icon: <Save className="w-4 h-4" />,
  },
  {
    targetId: 'tour-trigger-btn',
    title: 'Run Workflow',
    description: 'Trigger a manual execution. Watch each node run live and inspect the output in the Logs panel below.',
    placement: 'bottom',
    icon: <Play className="w-4 h-4" />,
  },
  {
    targetId: 'tour-credentials-btn',
    title: 'Credentials',
    description: 'Connect your Google Workspace, Slack, Microsoft Teams, and Basecamp accounts to use inside your workflows.',
    placement: 'bottom',
    icon: <KeyRound className="w-4 h-4" />,
  },
  {
    targetId: 'tour-avatar',
    title: 'Your Profile',
    description: 'View your account details, check your role, and sign out securely from here.',
    placement: 'left',
    icon: <UserCircle className="w-4 h-4" />,
  },
];

// ── Layout helpers ────────────────────────────────────────────────────────────

const TOOLTIP_W = 296;
const TOOLTIP_H = 190; // approximate — enough room to clamp
const SPOT_PAD = 8;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function tooltipPos(rect: DOMRect, placement: Placement) {
  const GAP = 18;
  let top = 0;
  let left = 0;

  switch (placement) {
    case 'right':
      top  = rect.top + rect.height / 2 - TOOLTIP_H / 2;
      left = rect.right + GAP;
      break;
    case 'left':
      top  = rect.top + rect.height / 2 - TOOLTIP_H / 2;
      left = rect.left - TOOLTIP_W - GAP;
      break;
    case 'bottom':
      top  = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
    case 'top':
      top  = rect.top - TOOLTIP_H - GAP;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
  }

  return {
    top:  clamp(top,  12, window.innerHeight - TOOLTIP_H - 12),
    left: clamp(left, 12, window.innerWidth  - TOOLTIP_W - 12),
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProductTour() {
  const { active, step, next, prev, end } = useTourStore();

  const [spot, setSpot] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [tip,  setTip]  = useState({ top: 0, left: 0 });

  const current = STEPS[step];

  const recalc = useCallback(() => {
    if (!active || !current) return;
    const el = document.getElementById(current.targetId);
    if (!el) { next(); return; }
    const r = el.getBoundingClientRect();
    setSpot({ top: r.top - SPOT_PAD, left: r.left - SPOT_PAD, width: r.width + SPOT_PAD * 2, height: r.height + SPOT_PAD * 2 });
    setTip(tooltipPos(r, current.placement));
  }, [active, current, next]);

  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(recalc);
    window.addEventListener('resize', recalc);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', recalc); };
  }, [active, recalc]);

  if (!active || !current || !spot) return null;

  const isDark = document.documentElement.classList.contains('dark');
  const arrowBorderColor = isDark ? '#1E293B' : 'white';
  const arrowStyles: Record<Placement, React.CSSProperties> = {
    right:  { top: '50%', left:  -8, transform: 'translateY(-50%)', borderWidth: '8px 8px 8px 0', borderRightColor: arrowBorderColor },
    left:   { top: '50%', right: -8, transform: 'translateY(-50%)', borderWidth: '8px 0 8px 8px', borderLeftColor:  arrowBorderColor },
    bottom: { top: -8,    left: '50%', transform: 'translateX(-50%)', borderWidth: '0 8px 8px', borderBottomColor: arrowBorderColor },
    top:    { bottom: -8, left: '50%', transform: 'translateX(-50%)', borderWidth: '8px 8px 0', borderTopColor: arrowBorderColor },
  };

  return createPortal(
    <>
      {/* Dark backdrop — click to close */}
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={end} />

      {/* Spotlight ring around target */}
      <div
        style={{
          position:  'fixed',
          top:       spot.top,
          left:      spot.left,
          width:     spot.width,
          height:    spot.height,
          borderRadius: 12,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.54)',
          outline:   '2px solid rgba(99,102,241,0.75)',
          outlineOffset: 1,
          zIndex:    9999,
          pointerEvents: 'none',
          transition: 'top 0.22s ease, left 0.22s ease, width 0.22s ease, height 0.22s ease',
        }}
      />

      {/* Pulse ring */}
      <div
        style={{
          position:  'fixed',
          top:       spot.top - 5,
          left:      spot.left - 5,
          width:     spot.width + 10,
          height:    spot.height + 10,
          borderRadius: 16,
          border:    '2px solid rgba(99,102,241,0.35)',
          zIndex:    9999,
          pointerEvents: 'none',
          animation: 'tourPulse 1.6s ease-out infinite',
        }}
      />

      {/* Tooltip card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top:      tip.top,
          left:     tip.left,
          width:    TOOLTIP_W,
          zIndex:   10000,
          transition: 'top 0.22s ease, left 0.22s ease',
        }}
        className="bg-white dark:bg-[#1E293B] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        {/* Coloured header stripe */}
        <div className="bg-gradient-to-r from-indigo-500 to-violet-500 px-4 pt-4 pb-3 flex items-center gap-2.5 text-white">
          <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
            {current.icon}
          </span>
          <p className="text-sm font-semibold leading-tight">{current.title}</p>
          <button onClick={end} className="ml-auto opacity-70 hover:opacity-100 transition-opacity">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-4">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
            {current.description}
          </p>

          {/* Progress pips */}
          <div className="flex items-center gap-1.5 mb-3">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step        ? 'w-5 bg-indigo-500'
                  : i < step        ? 'w-1.5 bg-indigo-300 dark:bg-indigo-700'
                  :                   'w-1.5 bg-slate-200 dark:bg-slate-600'
                }`}
              />
            ))}
            <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
              {step + 1} / {STEPS.length}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={end}
              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-1.5">
              {step > 0 && (
                <button
                  onClick={prev}
                  className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/8 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back
                </button>
              )}
              <button
                onClick={step === STEPS.length - 1 ? end : next}
                className="flex items-center gap-0.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
              >
                {step === STEPS.length - 1 ? 'Finish' : 'Next'}
                {step < STEPS.length - 1 && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Directional arrow */}
        <div
          className="absolute w-0 h-0 border-transparent"
          style={{ ...arrowStyles[current.placement] }}
        />
      </div>
    </>,
    document.body,
  );
}
