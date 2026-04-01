/**
 * Shared node icon components used in the palette, canvas node headers, etc.
 */
import { Globe, Sparkles, GitBranch, Shuffle, Wand2, Flag, Zap, Tent } from 'lucide-react';
import type { NodeType } from '../../types/workflow';

// ── Brand SVGs ────────────────────────────────────────────────────────────────

/** Gmail — official multicolor M-envelope (4 Google brand colours) */
export function GmailIcon({ size = 14 }: { size?: number }) {
  // The M-envelope is divided by two fold diagonals meeting at the valley (12,12):
  //   Yellow top-left  : (0,3)→(12,3)→(12,12)  [upper-left triangle]
  //   Green  top-right : (12,3)→(24,3)→(12,12) [upper-right triangle]
  //   Red    left body : (0,3)→(12,12)→(12,21)→(0,21)
  //   Blue   right body: (12,12)→(24,3)→(24,21)→(12,21)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 3L12 3L12 12Z"             fill="#FBBC05" />
      <path d="M12 3L24 3L12 12Z"            fill="#34A853" />
      <path d="M0 3L12 12L12 21L0 21Z"       fill="#EA4335" />
      <path d="M12 12L24 3L24 21L12 21Z"     fill="#4285F4" />
      {/* White fold-line accent for the M shape */}
      <path d="M0 3L12 12L24 3" fill="none" stroke="white" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  );
}

/** Google Drive — official three-colour triangular logo */
export function GDriveIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87 78" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.1 66L29 25.7 51.9 66H6.1z"          fill="#4285F4" />
      <path d="M57.7 66L34.8 25.7l11.4-19.8L80 66H57.7z" fill="#FBBC05" />
      <path d="M46.2 5.9L23.3 46.2H0L23 5.9h23.2z"    fill="#34A853" />
    </svg>
  );
}

/** Google Docs — blue document with white lines */
export function GDocsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6l-8-6z" fill="#4285F4" />
      <path d="M14 0v6h6L14 0z"                                                    fill="#80ABFC" />
      <rect x="6" y="11" width="12" height="1.5" rx=".75" fill="white" opacity=".9" />
      <rect x="6" y="14" width="12" height="1.5" rx=".75" fill="white" opacity=".9" />
      <rect x="6" y="17" width="8"  height="1.5" rx=".75" fill="white" opacity=".9" />
    </svg>
  );
}

/** Google Sheets — green document with grid */
export function GSheetsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6l-8-6z" fill="#34A853" />
      <path d="M14 0v6h6L14 0z"                                                    fill="#7FD1A4" />
      <path d="M6 10h5v2H6zm7 0h5v2h-5zM6 14h5v2H6zm7 0h5v2h-5zM6 18h5v2H6zm7 0h5v2h-5z"
        fill="white" opacity=".9" />
    </svg>
  );
}

/** OpenAI — official flower/asterisk mark (uses currentColor = white on coloured squares) */
export function OpenAIIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 41 41" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M37.53 16.17a10.44 10.44 0 0 0-.9-8.58 10.57 10.57 0 0 0-11.36-5.07A10.44 10.44 0 0 0
           17.4.88 10.57 10.57 0 0 0 7.33 8.17a10.44 10.44 0 0 0-6.95 5.07 10.57 10.57 0 0 0 1.3
           12.34 10.44 10.44 0 0 0 .9 8.58 10.57 10.57 0 0 0 11.36 5.07 10.44 10.44 0 0 0 7.82
           3.47 10.57 10.57 0 0 0 10.08-7.32 10.44 10.44 0 0 0 6.95-5.07 10.57 10.57 0 0 0-1.26-12.13z"
        fill="currentColor"
      />
      <path
        d="M24.32 28.68l-3.97-6.87-3.97 6.87M16.38 12.32l3.97 6.87 3.97-6.87"
        stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/** Anthropic — stylised "A" lettermark (uses currentColor = white on coloured squares) */
export function AnthropicIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M13.6 4L20 20h-3.4l-1.3-3.4H8.7L7.4 20H4L10.4 4h3.2zm-1.6 4.4L9.7 14h4.6L12 8.4z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Slack — official 4-colour pinwheel logo
 * Paths sourced from Slack brand kit (viewBox 0 0 122.8 122.8)
 */
export function SlackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 122.8 122.8" xmlns="http://www.w3.org/2000/svg">
      {/* Pink / red */}
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9z"      fill="#E01E5A" />
      <path d="M32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A" />
      {/* Yellow */}
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2z"    fill="#ECB22E" />
      <path d="M45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9H45.2z" fill="#ECB22E" />
      {/* Green */}
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2z"    fill="#2EB67D" />
      <path d="M90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D" />
      {/* Blue */}
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9z"   fill="#36C5F0" />
      <path d="M77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#36C5F0" />
    </svg>
  );
}

/**
 * Microsoft Teams — official purple T tile logo
 */
export function TeamsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Main purple tile */}
      <rect x="2" y="5" width="15" height="14" rx="2.5" fill="#5059C9" />
      {/* White T letterform */}
      <path d="M6 9.5h7M9.5 9.5v6" stroke="white" strokeWidth="2" strokeLinecap="round" />
      {/* Overlapping person bubble (top-right, representing "Teams") */}
      <circle cx="18.5" cy="7" r="3.5" fill="#7B83EB" />
      {/* Visible part of the tile behind the bubble */}
      <path d="M15 10.5a5.5 5.5 0 0 1 7 0V18a1 1 0 0 1-1 1h-6V10.5z" fill="#4B53BC" />
      {/* T on the bubble portion */}
      <path d="M16.5 12.5h4M18.5 12.5v4" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ── Color maps ─────────────────────────────────────────────────────────────────

const NODE_HEADER_COLORS: Record<string, string> = {
  trigger:   'bg-purple-500',
  http:      'bg-sky-500',
  llm:       'bg-slate-700',
  anthropic: 'bg-[#c2410c]',   // Anthropic — warm terracotta
  condition: 'bg-amber-500',
  switch:    'bg-orange-500',
  transform: 'bg-cyan-500',
  output:    'bg-rose-500',
  gmail:     'bg-red-600',
  gdrive:    'bg-blue-500',
  gdocs:     'bg-blue-500',
  gsheets:   'bg-green-600',
  slack:     'bg-[#4A154B]',   // Slack — official aubergine
  teams:     'bg-[#5059C9]',   // Teams — official purple
  basecamp:  'bg-green-700',
};

/** Hex colour values matching NODE_HEADER_COLORS — used where CSS classes can't be applied (e.g. minimap) */
const NODE_ACCENT_HEX: Record<string, string> = {
  trigger:   '#a855f7',
  http:      '#0ea5e9',
  llm:       '#334155',
  anthropic: '#c2410c',
  condition: '#f59e0b',
  switch:    '#f97316',
  transform: '#06b6d4',
  output:    '#f43f5e',
  gmail:     '#dc2626',
  gdrive:    '#3b82f6',
  gdocs:     '#3b82f6',
  gsheets:   '#16a34a',
  slack:     '#4A154B',
  teams:     '#5059C9',
  basecamp:  '#15803d',
};

export function nodeHeaderColor(type: string): string {
  return NODE_HEADER_COLORS[type] ?? 'bg-slate-500';
}

export function nodeAccentColor(type: string): string {
  return NODE_ACCENT_HEX[type] ?? '#64748b';
}

// ── Unified NodeIcon dispatcher ────────────────────────────────────────────────

export function NodeIcon({ type, size = 13 }: { type: NodeType | string; size?: number }) {
  switch (type) {
    case 'trigger':   return <Zap         size={size} className="text-white" />;
    case 'http':      return <Globe       size={size} className="text-white" />;
    case 'llm':       return <OpenAIIcon  size={size} />;
    case 'anthropic': return <AnthropicIcon size={size} />;
    case 'condition': return <GitBranch   size={size} className="text-white" />;
    case 'switch':    return <Shuffle     size={size} className="text-white" />;
    case 'transform': return <Wand2       size={size} className="text-white" />;
    case 'output':    return <Flag        size={size} className="text-white" />;
    case 'gmail':     return <GmailIcon   size={size} />;
    case 'gdrive':    return <GDriveIcon  size={size} />;
    case 'gdocs':     return <GDocsIcon   size={size} />;
    case 'gsheets':   return <GSheetsIcon size={size} />;
    case 'slack':     return <SlackIcon   size={size} />;
    case 'teams':     return <TeamsIcon   size={size} />;
    case 'basecamp':  return <Tent        size={size} className="text-white" />;
    default:          return <Sparkles    size={size} className="text-white" />;
  }
}
