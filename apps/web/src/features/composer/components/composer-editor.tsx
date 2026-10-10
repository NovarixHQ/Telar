"use client";

// The draft is a string and everything in the box is a drawing of it: serialize() returns exactly what will be sent.
// React owns nothing inside the editable. paint() patches only the nodes whose style changed, and the editor keeps its own undo stack.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ForwardedRef, type RefObject } from "react";
import { replaceTextRange } from "../tokens";
import { continueLine, indentLine, isLargePaste } from "../editor-keys";
import { editorHistory } from "../editor-history";
import { insertReference } from "@telar/client/composer";
import { runAt, type ComposerDecoration, type DecorationRun } from "../decorations";
import { decorationsDrawn, paint, placeCaret, selectionRange, serialize, type Run } from "./editor-dom";
import { cn } from "@/ui/utils";

/**
 * The caret's rect where the layout can answer: the collapsed range, else the
 * character before it (right edge), else the one after it (left edge), which is
 * a caret at the start of a line after a `<br>`.
 */
function measuredCaretRect(root: HTMLElement): DOMRect | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return undefined;

  const own = range.getBoundingClientRect();
  if (own.height > 0) return own;

  const measure = (node: Node, offset: number, side: "left" | "right"): DOMRect | undefined => {
    const one = document.createRange();
    one.setStart(node, offset);
    one.setEnd(node, offset + 1);
    const rect = one.getBoundingClientRect();
    return rect.height > 0 ? new DOMRect(rect[side], rect.top, 0, rect.height) : undefined;
  };

  const { startContainer: node, startOffset: offset } = range;
  if (node.nodeType === Node.TEXT_NODE) {
    if (offset > 0) {
      const previous = measure(node, offset - 1, "right");
      if (previous) return previous;
    }
    if (offset < (node.nodeValue ?? "").length) return measure(node, offset, "left");
    return undefined;
  }
  const next = node.childNodes[offset];
  if (next?.nodeType === Node.TEXT_NODE && (next.nodeValue ?? "").length > 0) return measure(next, 0, "left");
  return undefined;
}

/**
 * Keep the caret inside the box's own scroll area after any write: the browser
 * only scrolls for edits it made itself. `scrollTop` by hand because
 * `scrollIntoView` would also scroll the transcript and the page.
 */
function revealCaret(root: HTMLElement): void {
  if (root.scrollHeight <= root.clientHeight) return;
  const caret = measuredCaretRect(root);
  if (!caret) {
    const at = selectionRange(root);
    if (at && at.end >= serialize(root).length) root.scrollTop = root.scrollHeight;
    return;
  }
  const style = window.getComputedStyle(root);
  const box = root.getBoundingClientRect();
  const top = box.top + root.clientTop + (Number.parseFloat(style.paddingTop) || 0);
  const bottom = box.top + root.clientTop + root.clientHeight - (Number.parseFloat(style.paddingBottom) || 0);
  if (caret.bottom > bottom) root.scrollTop += caret.bottom - bottom;
  else if (caret.top < top) root.scrollTop -= top - caret.top;
}

/** Where the caret is, in viewport coordinates (the dictation pill is portalled to `body`). */
function caretRectIn(root: HTMLElement): DOMRect | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  if (!root.contains(selection.getRangeAt(0).startContainer)) return undefined;

  const measured = measuredCaretRect(root);
  if (measured) return measured;

  const box = root.getBoundingClientRect();
  if (box.height <= 0) return undefined;
  const line = Number.parseFloat(window.getComputedStyle(root).lineHeight);
  return new DOMRect(box.left, box.top, 0, Number.isFinite(line) && line > 0 ? line : box.height);
}

export type ComposerEditorHandle = {
  focus: () => void;
  /** Is the caret in this box right now? */
  focused: () => boolean;
  /** Where the caret is on the screen, or `undefined` when it is not in this box. */
  caretRect: () => DOMRect | undefined;
  /** `listening` tints the caret; `interim` is the run still being revised, drawn dimmer. */
  dictating: (state: { listening: boolean; interim?: Run }) => void;
  /** The caret's index in the draft, or the draft's length when unfocused. */
  caret: () => number;
  /** Swap a run of the draft and return the committed draft; `burst: false` makes it its own undo step. */
  replaceRange: (start: number, end: number, text: string, burst?: boolean) => string;
  /** Splice text in at the caret and return the committed draft, for callers that cannot wait for the render. */
  insertAtCaret: (text: string) => string;
};

type History = ReturnType<typeof editorHistory>;

type Decorations = RefObject<readonly ComposerDecoration[]>;

export type DecorationFocus = DecorationRun & { text: string };

function useDraftSync(
  value: string,
  root: RefObject<HTMLDivElement | null>,
  paintedRef: RefObject<string>,
  interimRef: RefObject<Run | null>,
  history: History,
  setEmpty: (empty: boolean) => void,
  decorations: Decorations,
) {
  const mounted = useRef(false);
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    if (!mounted.current) {
      mounted.current = true;
      paint(box, value, interimRef.current ?? undefined, false, decorations.current);
      paintedRef.current = value;
      history.reset(value);
      setEmpty(value.length === 0);
      return;
    }
    if (value === paintedRef.current) return;
    // The parent replaced the whole draft: the caret goes to the end, and the
    // interim run is dropped because its offsets no longer describe this text.
    interimRef.current = null;
    paint(box, value, undefined, false, decorations.current);
    paintedRef.current = value;
    history.reset(value);
    setEmpty(value.length === 0);
    if (document.activeElement !== box) return;
    placeCaret(box, value.length);
    revealCaret(box);
  }, [value, root, paintedRef, interimRef, history, setEmpty, decorations]);
}

function useEditorHandle(
  ref: ForwardedRef<ComposerEditorHandle>,
  {
    root,
    painted,
    interim,
    setListening,
    rewrite,
    decorations,
  }: {
    root: RefObject<HTMLDivElement | null>;
    painted: RefObject<string>;
    interim: RefObject<Run | null>;
    setListening: (listening: boolean) => void;
    rewrite: (text: string, caret: number, burst?: boolean) => void;
    decorations: Decorations;
  },
) {
  useImperativeHandle(
    ref,
    () => ({
      focus: () => root.current?.focus(),
      focused: () => Boolean(root.current) && document.activeElement === root.current,
      caretRect: () => {
        const box = root.current;
        return box ? caretRectIn(box) : undefined;
      },
      dictating: ({ listening: on, interim: run }) => {
        setListening(on);
        const was = interim.current;
        const same = was === null ? run === undefined : run !== undefined && was.start === run.start && was.end === run.end;
        interim.current = run ?? null;
        // Interim frames usually follow a replaceRange that already painted this span.
        if (same) return;
        const box = root.current;
        if (!box) return;
        const at = selectionRange(box)?.end ?? painted.current.length;
        paint(box, painted.current, interim.current ?? undefined, false, decorations.current);
        if (document.activeElement !== box) return;
        placeCaret(box, at);
        revealCaret(box);
      },
      caret: () => {
        const box = root.current;
        if (!box) return painted.current.length;
        const range = selectionRange(box);
        return range ? range.end : painted.current.length;
      },
      replaceRange: (start, end, text, burst = true) => {
        const next = replaceTextRange(painted.current, start, end, text);
        rewrite(next.text, next.cursor, burst);
        return next.text;
      },
      insertAtCaret: (text) => {
        const box = root.current;
        const range = box ? selectionRange(box) : undefined;
        const at = range ? range.end : painted.current.length;
        const next = insertReference(painted.current, text, at);
        rewrite(next.draft, next.caret);
        return next.draft;
      },
    }),
    [root, painted, interim, setListening, rewrite, decorations],
  );
}

function caretEdit(
  box: HTMLElement,
  text: string,
  edit: (text: string, caret: number) => { text: string; cursor: number } | undefined,
): { text: string; cursor: number } | undefined {
  const range = selectionRange(box);
  if (!range || range.start !== range.end) return undefined;
  return edit(text, range.start);
}

function historyStep(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): "undo" | "redo" | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.metaKey) return "redo";
  return undefined;
}

function useUndo(root: RefObject<HTMLDivElement | null>, show: (text: string, caret: number) => void) {
  const [history] = useState(editorHistory);
  const travel = useCallback(
    (step: "undo" | "redo") => {
      const target = history[step]();
      if (target) show(target.text, target.caret);
    },
    [history, show],
  );
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    // The app menu's Undo and Redo arrive as beforeinput, not as a key.
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
      event.preventDefault();
      travel(event.inputType === "historyUndo" ? "undo" : "redo");
    };
    box.addEventListener("beforeinput", onBeforeInput);
    return () => box.removeEventListener("beforeinput", onBeforeInput);
  }, [root, travel]);
  return { history, travel };
}

function useDecorationFocus(
  root: RefObject<HTMLDivElement | null>,
  painted: RefObject<string>,
  decorations: readonly ComposerDecoration[],
  onDecorationFocus: ((focus: DecorationFocus | undefined) => void) | undefined,
) {
  const decorationsRef = useRef(decorations);
  const focusRef = useRef(onDecorationFocus);
  useEffect(() => {
    focusRef.current = onDecorationFocus;
  });
  const report = useCallback(() => {
    const box = root.current;
    if (!box || !focusRef.current) return;
    const at = document.activeElement === box ? selectionRange(box) : undefined;
    const run = at && at.start === at.end ? runAt(decorationsDrawn(box), at.end) : undefined;
    focusRef.current(run && { ...run, text: painted.current.slice(run.start, run.end) });
  }, [root, painted]);
  const leave = useCallback(() => focusRef.current?.(undefined), []);
  return { decorationsRef, report, leave };
}

type KeyActions = {
  painted: string;
  travel: (step: "undo" | "redo") => void;
  rewrite: (text: string, caret: number) => void;
  settle: () => void;
  lineBreak: (text: string, caret: number) => void;
};

function editorKey(event: React.KeyboardEvent<HTMLDivElement>, box: HTMLElement, { painted, travel, rewrite, settle, lineBreak }: KeyActions) {
  const step = historyStep(event);
  if (step) {
    event.preventDefault();
    travel(step);
  } else if (event.key === "Enter") {
    // Only a shifted Enter reaches here.
    event.preventDefault();
    const list = caretEdit(box, painted, (text, caret) => continueLine(text, caret));
    if (list) return rewrite(list.text, list.cursor);
    document.execCommand("insertLineBreak");
    const text = serialize(box);
    lineBreak(text, selectionRange(box)?.end ?? text.length);
    settle();
    revealCaret(box);
  } else if (event.key === "Tab" && !event.altKey && !event.metaKey && !event.ctrlKey) {
    const indented = caretEdit(box, painted, (text, caret) => indentLine(text, caret, event.shiftKey));
    if (!indented) return;
    event.preventDefault();
    rewrite(indented.text, indented.cursor);
  }
}

const COMPACT_MAX_HEIGHT = "calc(5lh + 1.25rem)";

const NO_DECORATIONS: readonly ComposerDecoration[] = [];

function EditorPlaceholder({ text, compact }: { text: string; compact: boolean | undefined }) {
  return (
    <span
      aria-hidden
      data-slot="composer-placeholder"
      className={cn(
        "pointer-events-none absolute left-3 z-10 select-none text-[0.9375rem] leading-6 text-muted-foreground",
        compact ? "top-2.5 right-3 truncate" : "top-3",
      )}
    >
      {text}
    </span>
  );
}

export const ComposerEditor = forwardRef<
  ComposerEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    /** Fires BEFORE this component's own handling, and a handler that calls
     *  `preventDefault` keeps the key. That is how the parent claims Enter. */
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    /** The caret moved without the text changing — arrow keys, a click. The
     *  completion menu needs it, because moving out of a `@word` closes it. */
    onSelectionChange?: () => void;
    onPasteFiles?: (files: File[]) => void;
    /** Text over the paste threshold, which the parent attaches as a file instead of inserting. */
    onPasteLargeText?: (text: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    disabled?: boolean;
    id?: string;
    "data-composer"?: "session";
    compact?: boolean;
    className?: string;
    decorations?: readonly ComposerDecoration[];
    onDecorationFocus?: (focus: DecorationFocus | undefined) => void;
  }
>(function ComposerEditor(
  { value, onChange, onKeyDown, onSelectionChange, onPasteFiles, onPasteLargeText, onFocus, onBlur, placeholder, disabled, id, "data-composer": dataComposer, compact, className, decorations = NO_DECORATIONS, onDecorationFocus },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  /** The text the DOM currently shows; stops our own echo from repainting mid-keystroke. */
  const painted = useRef("");
  const [empty, setEmpty] = useState(true);
  /** The dictation run still being revised: a property of the drawing, so a ref, not state. */
  const interim = useRef<Run>(null);
  const [listening, setListening] = useState(false);
  const { decorationsRef, report, leave } = useDecorationFocus(root, painted, decorations, onDecorationFocus);

  const commit = useCallback(
    (text: string) => {
      painted.current = text;
      setEmpty(text.length === 0);
      onChange(text);
    },
    [onChange],
  );

  /** Draw a draft, report it, and put the caret where the gesture left it. */
  const show = useCallback(
    (text: string, caret: number) => {
      const box = root.current;
      if (!box) return;
      paint(box, text, interim.current ?? undefined, false, decorationsRef.current);
      commit(text);
      box.focus();
      placeCaret(box, caret);
      revealCaret(box);
      report();
    },
    [commit, report],
  );

  const { history, travel } = useUndo(root, show);

  const rewrite = useCallback(
    (text: string, caret: number, burst = false) => {
      show(text, caret);
      history.record(text, caret, burst);
    },
    [show, history],
  );

  /** Restyle what the browser just typed, keeping the chips it has and the caret where it is. */
  const settle = useCallback(() => {
    const box = root.current;
    if (!box) return;
    const at = selectionRange(box);
    if (paint(box, painted.current, interim.current ?? undefined, true, decorationsRef.current) && at) placeCaret(box, at.end);
    report();
  }, [report]);

  useEffect(() => {
    if (decorationsRef.current === decorations) return;
    decorationsRef.current = decorations;
    settle();
  }, [decorations, settle]);

  useDraftSync(value, root, painted, interim, history, setEmpty, decorationsRef);

  useEditorHandle(ref, { root, painted, interim, setListening, rewrite, decorations: decorationsRef });

  return (
    <div className={cn("relative w-full", className)}>
      <div
        ref={root}
        id={id}
        role="textbox"
        aria-multiline="true"
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        data-slot="composer-editor"
        data-composer={dataComposer}
        // The quiet sign that the microphone is open, which survives the caret pill scrolling away.
        data-dictating={listening ? "" : undefined}
        className={cn(
          "w-full whitespace-pre-wrap break-words px-3 text-[0.9375rem] leading-6 outline-none",
          compact ? "overflow-y-auto py-2.5" : "max-h-48 min-h-[76px] overflow-y-auto pt-3 pb-2",
          "data-dictating:caret-primary",
          disabled && "opacity-60",
        )}
        style={compact ? { maxHeight: COMPACT_MAX_HEIGHT } : undefined}
        onInput={(event) => {
          const box = root.current;
          if (!box) return;
          const text = serialize(box);
          commit(text);
          history.record(text, selectionRange(box)?.end ?? text.length, true);
          // Restyling mid-composition would break accented and IME input; compositionend does it.
          if (!(event.nativeEvent as InputEvent).isComposing) settle();
          revealCaret(box);
        }}
        onCompositionEnd={settle}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !root.current) return;
          editorKey(event, root.current, { painted: painted.current, travel, rewrite, settle, lineBreak: (text, caret) => (commit(text), history.record(text, caret, false)) });
        }}
        onFocus={() => onFocus?.()}
        onKeyUp={() => {
          onSelectionChange?.();
          report();
        }}
        onMouseUp={() => {
          onSelectionChange?.();
          report();
        }}
        onBlur={() => {
          onSelectionChange?.();
          onBlur?.();
          leave();
        }}
        onPaste={(event) => {
          // A pasted screenshot attaches.
          const files = [...event.clipboardData.files];
          if (files.length > 0 && onPasteFiles) {
            event.preventDefault();
            onPasteFiles(files);
            return;
          }
          // Text is pasted as plain text by us, so a pasted path draws as a chip on arrival.
          const text = event.clipboardData.getData("text/plain");
          if (!text) return;
          event.preventDefault();
          if (onPasteLargeText && isLargePaste(text)) return onPasteLargeText(text);
          const box = root.current;
          const range = box ? selectionRange(box) : undefined;
          const start = range?.start ?? painted.current.length;
          const end = range?.end ?? painted.current.length;
          const next = replaceTextRange(painted.current, Math.min(start, end), Math.max(start, end), text);
          rewrite(next.text, next.cursor);
        }}
      />
      {empty && placeholder ? <EditorPlaceholder text={placeholder} compact={compact} /> : null}
    </div>
  );
});
