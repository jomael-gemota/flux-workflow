import { useState, useRef, useCallback, useEffect } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { X, Palette } from 'lucide-react';
import { useWorkflowStore, type CanvasNodeData } from '../../store/workflowStore';

// ── Color palette ─────────────────────────────────────────────────────────────

export const STICKY_COLORS = [
  { id: 'yellow', light: '#fef9c3', dark: '#3d2800', border: { light: '#fde047', dark: '#854d0e' } },
  { id: 'pink',   light: '#fce7f3', dark: '#3d0026', border: { light: '#f9a8d4', dark: '#831843' } },
  { id: 'blue',   light: '#dbeafe', dark: '#0f2040', border: { light: '#93c5fd', dark: '#1e40af' } },
  { id: 'green',  light: '#dcfce7', dark: '#052e16', border: { light: '#86efac', dark: '#14532d' } },
  { id: 'purple', light: '#f3e8ff', dark: '#2d0057', border: { light: '#d8b4fe', dark: '#6b21a8' } },
  { id: 'orange', light: '#ffedd5', dark: '#431407', border: { light: '#fdba74', dark: '#c2410c' } },
  { id: 'white',  light: '#ffffff', dark: '#1e293b', border: { light: '#cbd5e1', dark: '#334155' } },
];

function getColorDef(colorId: string) {
  return STICKY_COLORS.find((c) => c.id === colorId) ?? STICKY_COLORS[0];
}

// ── Color swatches ────────────────────────────────────────────────────────────

// The default text color for each theme. Text using these values will be
// automatically swapped when the theme toggles so it stays readable.
const LIGHT_DEFAULT_TEXT_COLOR = '#1e293b';
const DARK_DEFAULT_TEXT_COLOR  = '#e2e8f0';

// '__inherit__' is a sentinel meaning "strip inline color → inherit from container"
const TEXT_COLORS = [
  { hex: '__inherit__', label: 'Default' },
  { hex: '#000000', label: 'Black' },
  { hex: '#ef4444', label: 'Red' },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#eab308', label: 'Yellow' },
  { hex: '#22c55e', label: 'Green' },
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#8b5cf6', label: 'Purple' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#ffffff', label: 'White' },
];

const HIGHLIGHT_COLORS = [
  { hex: '#fef08a', label: 'Yellow' },
  { hex: '#bbf7d0', label: 'Green' },
  { hex: '#bfdbfe', label: 'Blue' },
  { hex: '#e9d5ff', label: 'Purple' },
  { hex: '#fecaca', label: 'Red' },
  { hex: '#fed7aa', label: 'Orange' },
  { hex: 'transparent', label: 'Remove' },
];

// ── Rich-text toolbar ─────────────────────────────────────────────────────────

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

interface ToolbarProps {
  /** Runs a formatting command with the saved selection properly restored first */
  execCmd: (cmd: string, value?: string) => void;
  /** Applies a pixel font size to the current selection */
  applyFontSize: (px: number) => void;
  /** Strips inline color from the current selection so it inherits the theme color */
  onRemoveTextColor: () => void;
  onClose: () => void;
  isDark: boolean;
}

function RichTextToolbar({ execCmd, applyFontSize, onRemoveTextColor, onClose, isDark }: ToolbarProps) {
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [hlColorOpen, setHlColorOpen] = useState(false);
  const [fontSize, setFontSize] = useState(16);

  const btnCls =
    'h-9 min-w-[36px] px-2 rounded-lg text-sm font-semibold transition-colors ' +
    'hover:bg-black/10 dark:hover:bg-white/20 active:bg-black/20 ' +
    'text-slate-800 dark:text-slate-100 select-none flex items-center justify-center';

  const dividerCls = 'w-px h-5 bg-black/15 dark:bg-white/20 mx-0.5 self-center shrink-0';

  const decreaseFontSize = () => {
    const idx = FONT_SIZES.indexOf(fontSize);
    const next = idx > 0 ? FONT_SIZES[idx - 1] : FONT_SIZES[0];
    setFontSize(next);
    applyFontSize(next);
  };

  const increaseFontSize = () => {
    const idx = FONT_SIZES.indexOf(fontSize);
    const next = idx < FONT_SIZES.length - 1 ? FONT_SIZES[idx + 1] : FONT_SIZES[FONT_SIZES.length - 1];
    setFontSize(next);
    applyFontSize(next);
  };

  return (
    <div
      className="nodrag nopan flex items-center gap-0.5 flex-wrap px-2 py-1.5 shrink-0
                 border-b-2 border-black/10 dark:border-white/15
                 bg-black/5 dark:bg-white/5"
      // onMouseDown on the wrapper prevents focus-steal from every child element
      // as a belt-and-suspenders safeguard on top of per-button prevention.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Bold */}
      <button
        className={btnCls}
        title="Bold (Ctrl+B)"
        onMouseDown={(e) => { e.preventDefault(); execCmd('bold'); }}
      >
        <strong style={{ fontSize: 15 }}>B</strong>
      </button>

      {/* Italic */}
      <button
        className={`${btnCls} italic`}
        title="Italic (Ctrl+I)"
        onMouseDown={(e) => { e.preventDefault(); execCmd('italic'); }}
      >
        <em style={{ fontSize: 15 }}>I</em>
      </button>

      {/* Underline */}
      <button
        className={`${btnCls} underline underline-offset-2`}
        title="Underline (Ctrl+U)"
        onMouseDown={(e) => { e.preventDefault(); execCmd('underline'); }}
        style={{ textDecorationLine: 'underline' }}
      >
        <span style={{ fontSize: 15 }}>U</span>
      </button>

      {/* Strikethrough */}
      <button
        className={btnCls}
        title="Strikethrough"
        onMouseDown={(e) => { e.preventDefault(); execCmd('strikeThrough'); }}
      >
        <span style={{ fontSize: 15, textDecoration: 'line-through' }}>S</span>
      </button>

      <span className={dividerCls} />

      {/* Font size */}
      <div className="flex items-center gap-0.5">
        <button
          className={btnCls}
          title="Decrease font size"
          onMouseDown={(e) => { e.preventDefault(); decreaseFontSize(); }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>−</span>
        </button>
        <span
          className="min-w-[30px] text-center text-xs font-semibold select-none
                     text-slate-700 dark:text-slate-200 tabular-nums"
        >
          {fontSize}
        </span>
        <button
          className={btnCls}
          title="Increase font size"
          onMouseDown={(e) => { e.preventDefault(); increaseFontSize(); }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>+</span>
        </button>
      </div>

      <span className={dividerCls} />

      {/* Text color */}
      <div className="relative">
        <button
          className={`${btnCls} flex-col gap-0`}
          title="Text color"
          onMouseDown={(e) => {
            e.preventDefault();
            setTextColorOpen((v) => !v);
            setHlColorOpen(false);
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>A</span>
          <span
            style={{
              display: 'block',
              width: 18,
              height: 3,
              borderRadius: 2,
              background: '#ef4444',
              marginTop: 1,
            }}
          />
        </button>

        {textColorOpen && (
          <div
            className="absolute top-full left-0 mt-1 p-2 rounded-xl shadow-2xl
                       border border-slate-200 dark:border-slate-600
                       grid grid-cols-5 gap-1.5 z-[9999]"
            style={{ background: isDark ? '#1e293b' : '#ffffff', minWidth: 148 }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            {TEXT_COLORS.map(({ hex, label }) => {
              const isInherit = hex === '__inherit__';
              // "Default" swatch shows the current theme's default text color so
              // it always looks like "the normal color" regardless of theme.
              const swatchBg = isInherit
                ? (isDark ? DARK_DEFAULT_TEXT_COLOR : LIGHT_DEFAULT_TEXT_COLOR)
                : hex;
              const borderCol = isInherit
                ? (isDark ? '#475569' : '#94a3b8')
                : hex === '#ffffff' ? '#cbd5e1' : hex === '#000000' ? '#475569' : hex;
              return (
                <button
                  key={hex}
                  title={label}
                  className="w-6 h-6 rounded-md border-2 hover:scale-125 transition-transform"
                  style={{ background: swatchBg, borderColor: borderCol }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (isInherit) {
                      onRemoveTextColor();
                    } else {
                      execCmd('foreColor', hex);
                    }
                    setTextColorOpen(false);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Highlight color */}
      <div className="relative">
        <button
          className={btnCls}
          title="Highlight"
          onMouseDown={(e) => {
            e.preventDefault();
            setHlColorOpen((v) => !v);
            setTextColorOpen(false);
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 800,
              background: '#fef08a',
              color: '#713f12',
              padding: '1px 4px',
              borderRadius: 3,
              lineHeight: 1.4,
            }}
          >
            H
          </span>
        </button>

        {hlColorOpen && (
          <div
            className="absolute top-full left-0 mt-1 p-2 rounded-xl shadow-2xl
                       border border-slate-200 dark:border-slate-600
                       grid grid-cols-4 gap-1.5 z-[9999]"
            style={{ background: isDark ? '#1e293b' : '#ffffff', minWidth: 120 }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            {HIGHLIGHT_COLORS.map(({ hex, label }) => (
              <button
                key={hex}
                title={label}
                className="w-6 h-6 rounded-md border-2 border-slate-300 dark:border-slate-500
                           hover:scale-125 transition-transform flex items-center justify-center"
                style={{ background: hex === 'transparent' ? 'transparent' : hex }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd('hiliteColor', hex === 'transparent' ? 'transparent' : hex);
                  setHlColorOpen(false);
                }}
              >
                {hex === 'transparent' && (
                  <span className="text-slate-400 text-lg leading-none">×</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className={dividerCls} />

      {/* Clear formatting */}
      <button
        className={`${btnCls} text-slate-500 dark:text-slate-400`}
        title="Clear formatting"
        onMouseDown={(e) => { e.preventDefault(); execCmd('removeFormat'); }}
      >
        <span style={{ fontSize: 14 }}>T</span>
        <sub style={{ fontSize: 9 }}>x</sub>
      </button>

      <div className="flex-1" />

      {/* Done — onClick (not onMouseDown) so the contenteditable blurs first,
          flushing the content via onBlur, then this click confirms close. */}
      <button
        className="h-9 px-4 rounded-lg text-sm font-semibold
                   bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                   text-white transition-colors select-none"
        title="Done editing (Esc)"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        Done
      </button>
    </div>
  );
}

// ── Main sticky note component ────────────────────────────────────────────────

export function StickyNoteNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData;
  const [isEditing, setIsEditing] = useState(false);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  // Snapshot of the user's text selection — captured every time the selection
  // changes inside the contenteditable, then restored before execCommand runs.
  const savedRangeRef = useRef<Range | null>(null);

  const theme = useWorkflowStore((s) => s.theme);
  const updateContent = useWorkflowStore((s) => s.updateStickyNoteContent);
  const updateColor = useWorkflowStore((s) => s.updateStickyNoteColor);
  const setNodes = useWorkflowStore((s) => s.setNodes);
  const nodes = useWorkflowStore((s) => s.nodes);
  const isDark = theme === 'dark';

  const colorId = String(d.color ?? 'yellow');
  const colorDef = getColorDef(colorId);
  const bgColor = isDark ? colorDef.dark : colorDef.light;
  const borderColor = isDark ? colorDef.border.dark : colorDef.border.light;

  // ── Selection save/restore ──────────────────────────────────────────────────

  /** Snapshots the current browser selection IF it's inside our contenteditable. */
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (
      sel &&
      sel.rangeCount > 0 &&
      contentRef.current?.contains(sel.getRangeAt(0).commonAncestorContainer)
    ) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  /**
   * The KEY function for reliable toolbar formatting:
   * 1. Focus the contenteditable element
   * 2. Restore the saved Range into the browser Selection
   * 3. Run document.execCommand (which operates on the current selection)
   * 4. Re-save the new selection after the command
   */
  const execCmd = useCallback((cmd: string, value?: string) => {
    const el = contentRef.current;
    if (!el) return;

    // Step 1: give the contenteditable DOM focus
    el.focus();

    // Step 2: restore the user's saved selection
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    // Step 3: apply the formatting command
    document.execCommand(cmd, false, value ?? undefined);

    // Step 4: snapshot whatever the selection is now (after the command may have
    //         shifted boundaries, e.g. bold expands to include surrounding chars)
    requestAnimationFrame(() => {
      const newSel = window.getSelection();
      if (newSel && newSel.rangeCount > 0) {
        savedRangeRef.current = newSel.getRangeAt(0).cloneRange();
      }
    });
  }, []);

  /**
   * Applies a pixel-accurate font size to the selected text.
   *
   * execCommand('fontSize') only supports HTML size values 1–7, so the trick
   * is to mark the selection with size="7" as a unique placeholder, then
   * immediately post-process those <font> elements into <span style="font-size: Xpx">
   * before the browser paints, giving true pixel-level control.
   */
  const applyFontSize = useCallback((px: number) => {
    const el = contentRef.current;
    if (!el) return;

    el.focus();

    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    // Nothing to size if selection is collapsed (no text selected)
    if (!savedRangeRef.current || savedRangeRef.current.collapsed) return;

    // Step 1: wrap selection in a <font size="7"> placeholder
    document.execCommand('fontSize', false, '7');

    // Step 2: replace every <font size="7"> with a <span style="font-size: Xpx">.
    // Collect the new spans so we can re-establish the selection over them in step 3.
    const newSpans: HTMLElement[] = [];
    el.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      span.innerHTML = (font as HTMLElement).innerHTML;
      font.parentNode?.replaceChild(span, font);
      newSpans.push(span);
    });

    // Step 3: rebuild the browser selection to cover all newly created spans so
    // the highlight stays visible and consecutive ＋/− clicks keep working without
    // requiring the user to re-select the text each time.
    if (newSpans.length > 0) {
      const newRange = document.createRange();
      newRange.setStartBefore(newSpans[0]);
      newRange.setEndAfter(newSpans[newSpans.length - 1]);
      const newSel = window.getSelection();
      if (newSel) {
        newSel.removeAllRanges();
        newSel.addRange(newRange);
      }
      savedRangeRef.current = newRange.cloneRange();
    }
  }, []);

  /**
   * Strips explicit inline `color` attributes/styles from every element that
   * intersects the current saved selection, so the text falls back to inheriting
   * the container's theme-reactive color.
   */
  const removeInlineColor = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;

    el.focus();

    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    const sel2 = window.getSelection();
    if (!sel2 || sel2.rangeCount === 0) return;
    const range = sel2.getRangeAt(0);

    el.querySelectorAll('[color], [style]').forEach((elem) => {
      try {
        if (range.intersectsNode(elem)) {
          const htmlElem = elem as HTMLElement;
          if (htmlElem.hasAttribute('color')) htmlElem.removeAttribute('color');
          if (htmlElem.style.color) htmlElem.style.removeProperty('color');
        }
      } catch {
        // intersectsNode can throw in rare edge cases; safe to ignore
      }
    });

    requestAnimationFrame(() => {
      const newSel = window.getSelection();
      if (newSel && newSel.rangeCount > 0) {
        savedRangeRef.current = newSel.getRangeAt(0).cloneRange();
      }
    });
  }, []);

  // ── Edit mode ───────────────────────────────────────────────────────────────

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setTimeout(() => {
      const el = contentRef.current;
      if (!el) return;
      el.focus();
      // Place cursor at end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      savedRangeRef.current = range.cloneRange();
    }, 10);
  }, []);

  const exitEdit = useCallback(() => {
    setIsEditing(false);
    setShowColorMenu(false);
    savedRangeRef.current = null;
    if (contentRef.current) {
      updateContent(id, contentRef.current.innerHTML);
    }
  }, [id, updateContent]);

  // Sync content from store → DOM only when NOT editing (avoids clobbering user input)
  useEffect(() => {
    if (!isEditing && contentRef.current) {
      contentRef.current.innerHTML = String(d.content ?? '');
    }
  }, [d.content, isEditing]);

  // When the theme toggles, swap the two "auto-default" text colors in stored
  // content so existing notes stay readable without any user action.
  // We use a ref for isEditing so this effect only re-runs when isDark changes.
  const isEditingRef = useRef(isEditing);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  useEffect(() => {
    const el = contentRef.current;
    if (isEditingRef.current || !el) return;

    const currentContent = el.innerHTML;
    if (!currentContent) return;

    const fromColor = isDark ? LIGHT_DEFAULT_TEXT_COLOR : DARK_DEFAULT_TEXT_COLOR;
    const toColor   = isDark ? DARK_DEFAULT_TEXT_COLOR  : LIGHT_DEFAULT_TEXT_COLOR;

    const updated = currentContent.replace(new RegExp(fromColor, 'gi'), toColor);
    if (updated !== currentContent) {
      el.innerHTML = updated;
      updateContent(id, updated);
    }
  // Intentionally limited to isDark: id and updateContent are stable Zustand
  // references; including d.content would cause an update loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  // Close color swatch menu on outside click
  useEffect(() => {
    if (!showColorMenu) return;
    function onDown(e: MouseEvent) {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setShowColorMenu(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showColorMenu]);

  // Delete this sticky note
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes(nodes.filter((n) => n.id !== id));
  }, [id, nodes, setNodes]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={120}
        handleStyle={{ width: 12, height: 12, borderRadius: 4, background: '#3b82f6', border: '2px solid white' }}
        lineStyle={{ borderColor: '#3b82f6', borderWidth: 1.5 }}
      />

      <div
        ref={nodeRef}
        className="h-full w-full flex flex-col rounded-xl shadow-lg relative"
        style={{
          background: bgColor,
          border: `2px solid ${borderColor}`,
          fontFamily: 'Inter, sans-serif',
        }}
        onDoubleClick={handleDoubleClick}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-2 shrink-0 rounded-t-xl
                     cursor-grab active:cursor-grabbing"
          style={{ background: `${borderColor}55` }}
        >
          {/* Color swatch picker */}
          <div className="relative" ref={colorMenuRef}>
            <button
              className="w-6 h-6 rounded-full border-2 border-white/70 shadow
                         hover:scale-110 transition-transform shrink-0
                         flex items-center justify-center"
              style={{ background: borderColor }}
              onClick={(e) => { e.stopPropagation(); setShowColorMenu((v) => !v); }}
              title="Change note color"
            >
              {showColorMenu && <Palette className="w-3 h-3 text-white" />}
            </button>

            {showColorMenu && (
              <div
                className="absolute top-full left-0 mt-2 p-2.5 rounded-xl shadow-2xl
                           border border-slate-200 dark:border-slate-600 flex gap-2 z-[9999]"
                style={{ background: isDark ? '#1e293b' : '#ffffff' }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {STICKY_COLORS.map((c) => (
                  <button
                    key={c.id}
                    className="w-6 h-6 rounded-full border-2 hover:scale-125 transition-transform"
                    style={{
                      background: isDark ? c.dark : c.light,
                      borderColor: colorId === c.id ? '#3b82f6' : (isDark ? c.border.dark : c.border.light),
                      boxShadow: colorId === c.id ? '0 0 0 2px #3b82f6' : undefined,
                    }}
                    onClick={(e) => { e.stopPropagation(); updateColor(id, c.id); setShowColorMenu(false); }}
                    title={c.id.charAt(0).toUpperCase() + c.id.slice(1)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Drag handle area */}
          <div className="flex-1 min-w-0" />

          {/* Delete (only while selected) */}
          {selected && (
            <button
              className="w-6 h-6 rounded-full flex items-center justify-center
                         hover:bg-red-500/25 transition-colors"
              onClick={handleDelete}
              title="Delete note"
            >
              <X className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
            </button>
          )}
        </div>

        {/* ── Rich-text toolbar (shown only while editing) ── */}
        {isEditing && (
          <RichTextToolbar
            execCmd={execCmd}
            applyFontSize={applyFontSize}
            onRemoveTextColor={removeInlineColor}
            onClose={exitEdit}
            isDark={isDark}
          />
        )}

        {/* ── Content area ── */}
        <div
          ref={contentRef}
          contentEditable={isEditing}
          suppressContentEditableWarning
          spellCheck={isEditing}
          className={`flex-1 px-3 py-2.5 outline-none${isEditing ? ' nodrag nopan' : ''}`}
          style={{
            /*
             * Match node label size: text-[16px] font-semibold (600)
             * from BaseNode.tsx label styling.
             */
            fontSize: 16,
            fontWeight: 600,
            color: isDark ? '#e2e8f0' : '#1e293b',
            cursor: isEditing ? 'text' : 'default',
            minHeight: 0,
            overflow: 'auto',
            wordBreak: 'break-word',
            lineHeight: 1.6,
          }}
          // ── Save selection on every pointer/key interaction ──────────────────
          // This is what makes the toolbar reliable: we always have an up-to-date
          // Range snapshot before the user ever clicks a toolbar button.
          onMouseUp={saveSelection}
          onKeyUp={saveSelection}
          onSelect={saveSelection}
          // ── Blur handling ────────────────────────────────────────────────────
          onBlur={(e) => {
            const rel = e.relatedTarget as Node | null;
            if (nodeRef.current?.contains(rel)) {
              // Focus moved to a toolbar element — save selection as safety net
              saveSelection();
            } else {
              exitEdit();
            }
          }}
          onClick={(e) => { if (isEditing) e.stopPropagation(); }}
          onMouseDown={(e) => { if (isEditing) e.stopPropagation(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              exitEdit();
              return;
            }
            // Ctrl+S / Cmd+S: flush content to store so the global Toolbar
            // handler picks up the latest text when it fires next.
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              exitEdit();
            }
          }}
        />

        {/* ── Empty-state hint ── */}
        {!isEditing && !d.content && (
          <div
            className="absolute pointer-events-none select-none"
            style={{
              top: 52,
              left: 14,
              right: 14,
              fontSize: 14,
              fontWeight: 400,
              color: isDark ? '#64748b' : '#94a3b8',
            }}
          >
            Double-click to add a note…
          </div>
        )}
      </div>
    </>
  );
}
