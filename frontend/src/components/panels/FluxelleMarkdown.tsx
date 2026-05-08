import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';

// ── Copy button for code blocks ───────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-all"
    >
      {copied
        ? <><Check className="w-3 h-3 text-emerald-400" />Copied!</>
        : <><Copy className="w-3 h-3" />Copy</>}
    </button>
  );
}

// ── Syntax-highlighted code block ─────────────────────────────────────────────

function CodeBlock({ lang, raw }: { lang: string; raw: string }) {
  return (
    <div className="my-2.5 rounded-xl overflow-hidden border border-white/[0.08] shadow-md shadow-black/30">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#161616] border-b border-white/[0.07]">
        <span className="text-[9px] font-black uppercase tracking-[0.12em] text-violet-400">
          {lang || 'code'}
        </span>
        <CopyButton text={raw} />
      </div>
      <SyntaxHighlighter
        language={lang || 'text'}
        style={vscDarkPlus}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '14px 16px',
          fontSize: '10.5px',
          lineHeight: '1.7',
          background: '#1e1e1e',
          borderRadius: 0,
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
}

// ── Main markdown renderer ────────────────────────────────────────────────────

export function FluxelleMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // ── Transparent pre wrapper — let CodeBlock handle rendering ─────────
        pre({ children }) {
          return <>{children}</>;
        },

        // ── Code: block (fenced) vs inline ───────────────────────────────────
        code({ className, children }) {
          const match = /language-(\w+)/.exec(className ?? '');
          const lang = match?.[1] ?? '';
          const raw = String(children).replace(/\n$/, '');

          if (match || raw.includes('\n')) {
            return <CodeBlock lang={lang} raw={raw} />;
          }

          // Inline code
          return (
            <code className="px-1 py-[1px] mx-px rounded text-[10.5px] font-mono bg-violet-100/70 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200/60 dark:border-violet-700/40">
              {children}
            </code>
          );
        },

        // ── Headings ─────────────────────────────────────────────────────────
        h1({ children }) {
          return (
            <h1 className="text-[13.5px] font-bold text-gray-900 dark:text-white mt-3.5 mb-1.5 leading-snug first:mt-0">
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 className="text-[12.5px] font-bold text-gray-900 dark:text-white mt-3 mb-1 leading-snug first:mt-0">
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 className="text-[11.5px] font-bold text-gray-900 dark:text-white mt-2 mb-0.5 leading-snug first:mt-0">
              {children}
            </h3>
          );
        },

        // ── Paragraph ────────────────────────────────────────────────────────
        p({ children }) {
          return (
            <p className="text-[11.5px] leading-relaxed text-gray-800 dark:text-slate-200 mb-2 last:mb-0 first:mt-0">
              {children}
            </p>
          );
        },

        // ── Lists ─────────────────────────────────────────────────────────────
        ul({ children }) {
          return (
            <ul className="mb-2 last:mb-0 space-y-0.5 pl-4 list-none">
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="mb-2 last:mb-0 space-y-0.5 pl-4 list-decimal marker:text-violet-500 dark:marker:text-violet-400">
              {children}
            </ol>
          );
        },
        li({ children }) {
          return (
            <li className="flex items-start gap-2 text-[11.5px] leading-relaxed text-gray-800 dark:text-slate-200">
              <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400 shrink-0" />
              <span>{children}</span>
            </li>
          );
        },

        // ── Inline formatting ─────────────────────────────────────────────────
        strong({ children }) {
          return (
            <strong className="font-bold text-gray-900 dark:text-white">
              {children}
            </strong>
          );
        },
        em({ children }) {
          return (
            <em className="italic text-gray-700 dark:text-slate-300">{children}</em>
          );
        },

        // ── Blockquote ───────────────────────────────────────────────────────
        blockquote({ children }) {
          return (
            <blockquote className="pl-3 border-l-2 border-violet-400 dark:border-violet-600 text-slate-600 dark:text-slate-400 italic my-2">
              {children}
            </blockquote>
          );
        },

        // ── Horizontal rule ──────────────────────────────────────────────────
        hr() {
          return <hr className="border-slate-200 dark:border-slate-700/60 my-2.5" />;
        },

        // ── Links ────────────────────────────────────────────────────────────
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-500 transition-colors"
            >
              {children}
            </a>
          );
        },

        // ── Table ────────────────────────────────────────────────────────────
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700/60">
              <table className="w-full text-[11px] border-collapse">
                {children}
              </table>
            </div>
          );
        },
        thead({ children }) {
          return (
            <thead className="bg-slate-50 dark:bg-slate-800/80">
              {children}
            </thead>
          );
        },
        th({ children }) {
          return (
            <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700/60">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="px-3 py-1.5 text-gray-800 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 last:border-0">
              {children}
            </td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
