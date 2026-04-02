/**
 * Shared node icon components used in the palette, canvas node headers, etc.
 */
import { Globe, Sparkles, GitBranch, Shuffle, Wand2, Flag, Zap } from 'lucide-react';
import type { NodeType } from '../../types/workflow';

// ── Logo image helper ─────────────────────────────────────────────────────────

/**
 * PNG logos have internal transparent padding that makes the visible mark
 * appear smaller than SVG icons that fill their viewBox edge-to-edge.
 * A 1.3× CSS transform closes that gap without affecting layout metrics.
 */
function LogoImg({ src, size, alt }: { src: string; size: number; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        transform: 'scale(1.3)',
        transformOrigin: 'center',
      }}
    />
  );
}

// ── Brand icons (real logos) ──────────────────────────────────────────────────

export function GmailIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/gmail-removebg-preview.png" size={size} alt="Gmail" />;
}

export function GDriveIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/gdrive-removebg-preview.png" size={size} alt="Google Drive" />;
}

export function GDocsIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/gdocs-removebg-preview.png" size={size} alt="Google Docs" />;
}

export function GSheetsIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/gsheets-removebg-preview.png" size={size} alt="Google Sheets" />;
}

export function OpenAIIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/open-ai-removebg-preview.png" size={size} alt="OpenAI" />;
}

export function AnthropicIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/anthropic.jpg" size={size} alt="Anthropic" />;
}

export function BasecampIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/basecamp.png" size={size} alt="Basecamp" />;
}

export function TeamsIcon({ size = 14 }: { size?: number }) {
  return <LogoImg src="/logos/ms-teams.png" size={size} alt="Microsoft Teams" />;
}

/**
 * Gemini — 4-pointed star with Google's blue-to-indigo gradient
 */
export function GeminiIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="geminiGrad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C11.72 8.04 8.04 11.72 2 12C8.04 12.28 11.72 15.96 12 22C12.28 15.96 15.96 12.28 22 12C15.96 11.72 12.28 8.04 12 2Z"
        fill="url(#geminiGrad)"
      />
    </svg>
  );
}

/**
 * Slack — official 4-colour pinwheel logo (no logo file provided; kept as SVG)
 */
export function SlackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 122.8 122.8" xmlns="http://www.w3.org/2000/svg">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9z"      fill="#E01E5A" />
      <path d="M32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A" />
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2z"    fill="#ECB22E" />
      <path d="M45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9H45.2z" fill="#ECB22E" />
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2z"    fill="#2EB67D" />
      <path d="M90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D" />
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9z"   fill="#36C5F0" />
      <path d="M77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#36C5F0" />
    </svg>
  );
}

// ── Color maps ─────────────────────────────────────────────────────────────────

// Uniform theme-aware background — logos carry their own brand identity
const UNIFORM_HEADER_COLOR = 'bg-white dark:bg-[#2B2B2B]';
const UNIFORM_ACCENT_HEX   = '#2B2B2B';

export function nodeHeaderColor(_type: string): string {
  return UNIFORM_HEADER_COLOR;
}

export function nodeAccentColor(_type: string): string {
  return UNIFORM_ACCENT_HEX;
}

// ── Unified NodeIcon dispatcher ────────────────────────────────────────────────

const LUCIDE_CLS = 'text-slate-700 dark:text-white';

export function NodeIcon({ type, size = 13 }: { type: NodeType | string; size?: number }) {
  switch (type) {
    case 'trigger':   return <Zap         size={size} className={LUCIDE_CLS} />;
    case 'http':      return <Globe       size={size} className={LUCIDE_CLS} />;
    case 'llm':       return <OpenAIIcon  size={size} />;
    case 'anthropic': return <AnthropicIcon size={size} />;
    case 'gemini':    return <GeminiIcon  size={size} />;
    case 'condition': return <GitBranch   size={size} className={LUCIDE_CLS} />;
    case 'switch':    return <Shuffle     size={size} className={LUCIDE_CLS} />;
    case 'transform': return <Wand2       size={size} className={LUCIDE_CLS} />;
    case 'output':    return <Flag        size={size} className={LUCIDE_CLS} />;
    case 'gmail':     return <GmailIcon   size={size} />;
    case 'gdrive':    return <GDriveIcon  size={size} />;
    case 'gdocs':     return <GDocsIcon   size={size} />;
    case 'gsheets':   return <GSheetsIcon size={size} />;
    case 'slack':     return <SlackIcon   size={size} />;
    case 'teams':     return <TeamsIcon   size={size} />;
    case 'basecamp':  return <BasecampIcon size={size} />;
    default:          return <Sparkles    size={size} className={LUCIDE_CLS} />;
  }
}
