import { memo } from 'react';
import {
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from '@xyflow/react';

export type EdgeExecutionStatus = 'idle' | 'waiting' | 'flowing' | 'success' | 'failure' | 'skipped';

interface ExecutionEdgeData extends Record<string, unknown> {
  executionStatus?: EdgeExecutionStatus;
  label?: string;
}

// ── Colour palette ──────────────────────────────────────────────────────────
const COLORS = {
  idle:    '#94a3b8',   // slate-400
  waiting: '#64748b',   // slate-500
  flowing: '#3b82f6',   // blue-500
  success: '#22c55e',   // green-500
  failure: '#ef4444',   // red-500
  skipped: '#64748b',   // slate-500
} satisfies Record<EdgeExecutionStatus, string>;

// ── Base-line opacity per status ──────────────────────────────────────────────
const BASE_OPACITY: Record<EdgeExecutionStatus, number> = {
  idle:    0.70,
  waiting: 0.35,
  flowing: 0.15,   // near-invisible — the sweep is the focal element
  success: 1,
  failure: 1,
  skipped: 0.45,
};

// ── Stroke widths — noticeably thicker than before ───────────────────────────
const BASE_WIDTH: Record<EdgeExecutionStatus, number> = {
  idle:    2.5,
  waiting: 2,
  flowing: 2.5,
  success: 3.5,
  failure: 3.5,
  skipped: 2,
};

// ── Arrow marker dimensions (absolute user-space units) ──────────────────────
const MARKER_W  = 11;  // width  of the arrowhead triangle
const MARKER_H  = 8;   // height of the arrowhead triangle
const MARKER_REF_X = MARKER_W;  // tip of the triangle aligns with path endpoint
const MARKER_REF_Y = MARKER_H / 2;

export const ExecutionEdge = memo(function ExecutionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const d = data as ExecutionEdgeData | undefined;
  const status: EdgeExecutionStatus = d?.executionStatus ?? 'idle';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const color       = COLORS[status];
  const baseOpacity = BASE_OPACITY[status];
  const baseWidth   = BASE_WIDTH[status];
  const isFlowing   = status === 'flowing';
  const isSuccess   = status === 'success';
  const isFailure   = status === 'failure';

  // Per-status marker IDs — shared across all edges with the same status,
  // so we only ever define 6 markers regardless of edge count.
  const markerId = `wap-arrow-${status}`;
  // Flowing edges hide the arrowhead (the sweep is the visual focus)
  const arrowOpacity = isFlowing ? 0 : baseOpacity;

  return (
    <>
      {/*
        ── SVG marker defs ───────────────────────────────────────────────────────
        Placed inline — browsers accept <defs> anywhere inside an SVG document.
        All edges sharing the same status redefine the same marker ID (identical
        content), which is harmless and avoids duplicate DOM nodes piling up.
      */}
      <defs>
        <marker
          id={markerId}
          markerWidth={MARKER_W}
          markerHeight={MARKER_H}
          refX={MARKER_REF_X}
          refY={MARKER_REF_Y}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <polygon
            points={`0,0 ${MARKER_W},${MARKER_REF_Y} 0,${MARKER_H}`}
            fill={color}
            fillOpacity={arrowOpacity}
          />
        </marker>
      </defs>

      {/*
        ── 1. Base path ─────────────────────────────────────────────────────────
        CSS transitions smoothly shift colour/opacity between statuses.
      */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={baseWidth}
        strokeOpacity={baseOpacity}
        markerEnd={`url(#${markerId})`}
        style={{
          transition: 'stroke 0.55s ease, stroke-opacity 0.55s ease, stroke-width 0.3s ease',
        }}
      />

      {/*
        ── 2. Progress-bar sweep (flowing only) ─────────────────────────────────
        pathLength="1" normalises dashoffset to [0,1] regardless of curve length.
      */}
      {isFlowing && (
        <>
          {/* Soft glow halo behind the sweep */}
          <path
            d={edgePath}
            fill="none"
            stroke={COLORS.flowing}
            strokeWidth={14}
            strokeOpacity={0.10}
            style={{ pointerEvents: 'none' }}
          />
          {/* The animated progress bar itself */}
          <path
            d={edgePath}
            fill="none"
            stroke={COLORS.flowing}
            strokeWidth={3.5}
            strokeLinecap="round"
            pathLength={1}
            className="edge-progress-sweep"
            style={{ pointerEvents: 'none' }}
          />
        </>
      )}

      {/*
        ── 3. Completion glow (success / failure) ────────────────────────────────
      */}
      {(isSuccess || isFailure) && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeOpacity={0.10}
          style={{
            pointerEvents: 'none',
            transition: 'stroke 0.55s ease, stroke-opacity 0.55s ease',
          }}
        />
      )}

      {/* ── 4. Optional mid-edge label ──────────────────────────────────────── */}
      {d?.label && (
        <EdgeLabelRenderer>
          <span
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 10,
              fontWeight: 600,
              color,
              background: 'color-mix(in srgb, var(--body-bg, #0f172a) 88%, transparent)',
              padding: '2px 6px',
              borderRadius: 4,
              border: `1px solid ${color}55`,
              pointerEvents: 'none',
              transition: 'color 0.55s ease',
            }}
            className="nodrag nopan"
          >
            {String(d.label)}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
