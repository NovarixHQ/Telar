// The editable is a flat drawing of the draft: text, styled spans, chips and a <br> per newline.
// serialize() reads back exactly what will be sent; nothing drawn here is ever stored beside it.

import type { TelarReference } from "@telar/client/composer";
import { CHIP_CLASS, CHIP_ICON_CLASS, CHIP_LABEL_CLASS, chipTitle } from "../chip";
import { chipGlyphFor, glyphElement } from "../glyph-paths";
import { decorationBits, decorationRuns, decorationStyleOf, type ComposerDecoration, type DecorationRun } from "../decorations";
import { isLiteral, markdownStyles, styleNames, type MarkdownStyle } from "../markdown";
import type { PluginDecorationStyle } from "@telar/engine-client";
import { segmentDraft } from "../tokens";
import { cn } from "@/ui/utils";

export type Run = { start: number; end: number };

/** `data-chip-text` is the chip's serialization; the glyph, label and tooltip are never read back. */
function chipElement(reference: TelarReference): HTMLElement {
  const chip = document.createElement("span");
  chip.className = CHIP_CLASS;
  chip.contentEditable = "false";
  chip.spellcheck = false;
  chip.dataset.chipText = reference.text;
  chip.dataset.chipKind = reference.kind;
  chip.title = chipTitle(reference);
  const { markup, tint } = chipGlyphFor(reference);
  chip.append(glyphElement(markup, cn(CHIP_ICON_CLASS, tint)));
  const label = document.createElement("span");
  label.className = CHIP_LABEL_CLASS;
  label.textContent = reference.label;
  chip.append(label);
  return chip;
}

const STYLE_CLASS: Record<MarkdownStyle, string> = {
  mark: "text-muted-foreground",
  strong: "font-semibold",
  em: "italic",
  strike: "line-through",
  code: "rounded-sm bg-muted font-mono text-[0.875em]",
  link: "text-primary underline underline-offset-2",
  h1: "text-xl font-semibold",
  h2: "text-lg font-semibold",
  h3: "font-semibold",
  quote: "italic text-muted-foreground",
  codeBlock: "font-mono text-[0.875em]",
  rule: "tracking-widest",
};

const DECORATION_CLASS: Record<PluginDecorationStyle, string> = {
  math: "font-mono text-[0.875em] text-primary",
  code: "rounded-sm bg-muted font-mono text-[0.875em]",
  accent: "text-primary",
  muted: "text-muted-foreground",
};

/** Dictated words still being revised, drawn dimmer. */
const INTERIM = 1 << 15;
const INTERIM_ATTRIBUTE = "data-dictation-interim";

function leaf(text: string, bits: number): Node {
  if (bits === 0) return document.createTextNode(text);
  const span = document.createElement("span");
  const names = styleNames(bits);
  const decoration = decorationStyleOf(bits);
  if (names.length > 0) span.dataset.md = names.join(" ");
  if (decoration) span.dataset.decoration = decoration;
  if (bits & INTERIM) span.setAttribute(INTERIM_ATTRIBUTE, "");
  span.className = cn(decoration && DECORATION_CLASS[decoration], ...names.map((name) => STYLE_CLASS[name]), bits & INTERIM && "opacity-55");
  span.textContent = text;
  return span;
}

type Chip = Run & { node: HTMLElement };

const drawnRuns = new WeakMap<HTMLElement, DecorationRun[]>();

export const decorationsDrawn = (root: HTMLElement): readonly DecorationRun[] => drawnRuns.get(root) ?? [];

function drawing(draft: string, chips: Chip[], interim: Run | undefined, decorations: readonly ComposerDecoration[]): { nodes: Node[]; runs: DecorationRun[] } {
  const bits = markdownStyles(draft, chips);
  const opaque = new Uint8Array(draft.length);
  for (const chip of chips) opaque.fill(1, chip.start, chip.end);
  const runs = decorationRuns(draft, decorations, (at) => opaque[at] === 1 || isLiteral(bits[at]!));
  for (const run of runs) for (let at = run.start; at < run.end; at += 1) bits[at]! |= decorationBits(run.decoration.style);
  if (interim)
    for (let at = Math.max(0, interim.start); at < Math.min(draft.length, interim.end); at += 1) bits[at]! |= INTERIM;
  const starts = new Map(chips.map((chip) => [chip.start, chip]));
  const nodes: Node[] = [];
  for (let at = 0; at < draft.length; ) {
    const chip = starts.get(at);
    if (chip) {
      nodes.push(chip.node);
      at = chip.end;
      continue;
    }
    if (draft[at] === "\n") {
      nodes.push(document.createElement("br"));
      at += 1;
      continue;
    }
    let end = at + 1;
    while (end < draft.length && bits[end] === bits[at] && draft[end] !== "\n" && !starts.has(end)) end += 1;
    nodes.push(leaf(draft.slice(at, end), bits[at]!));
    at = end;
  }
  // A final <br> gives a trailing empty line its height; serialize() reads it as nothing.
  if (draft.endsWith("\n")) nodes.push(document.createElement("br"));
  // An empty text node after a chip or styled span is somewhere the caret can stand.
  else if (nodes.at(-1)?.nodeType !== Node.TEXT_NODE) nodes.push(document.createTextNode(""));
  return { nodes, runs };
}

function chipsIn(root: HTMLElement, draft: string): Chip[] {
  const chips: Chip[] = [];
  const final = finalBreak(root);
  let at = 0;
  const walk = (node: Node) => {
    if (node instanceof HTMLElement && node.dataset.chipText !== undefined) {
      const end = at + node.dataset.chipText.length;
      if (draft.slice(at, end) === node.dataset.chipText) chips.push({ start: at, end, node });
      at = end;
    } else if (node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && node.tagName === "BR")) {
      at += lengthOf(node, final);
    } else node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return chips;
}

function sameNode(current: Node, next: Node): boolean {
  if (current === next) return true;
  if (current.nodeType !== next.nodeType) return false;
  if (current.nodeType === Node.TEXT_NODE) return current.nodeValue === next.nodeValue;
  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement) || current.tagName !== next.tagName) return false;
  if (next.tagName === "BR") return true;
  if (next.dataset.chipText !== undefined) return current.dataset.chipText === next.dataset.chipText && current.dataset.chipKind === next.dataset.chipKind;
  return (
    current.className === next.className &&
    current.dataset.md === next.dataset.md &&
    current.dataset.decoration === next.dataset.decoration &&
    current.hasAttribute(INTERIM_ATTRIBUTE) === next.hasAttribute(INTERIM_ATTRIBUTE) &&
    current.childNodes.length === 1 &&
    current.firstChild?.nodeType === Node.TEXT_NODE &&
    current.textContent === next.textContent
  );
}

/**
 * Draw a draft, touching only the nodes that differ from what is there, and
 * report whether anything changed. `keepChips` keeps the chips already drawn
 * and makes no new ones, so typing never turns a word into a chip under the caret.
 */
export function paint(root: HTMLElement, draft: string, interim?: Run, keepChips = false, decorations: readonly ComposerDecoration[] = []): boolean {
  const chips = keepChips
    ? chipsIn(root, draft)
    : segmentDraft(draft).flatMap((segment) => (segment.type === "chip" ? [{ start: segment.start, end: segment.end, node: chipElement(segment.reference) }] : []));
  const { nodes: next, runs } = drawing(draft, chips, interim, decorations);
  drawnRuns.set(root, runs);
  const current = [...root.childNodes];
  let head = 0;
  while (head < next.length && head < current.length && sameNode(current[head]!, next[head]!)) head += 1;
  let tail = 0;
  while (tail < next.length - head && tail < current.length - head && sameNode(current[current.length - 1 - tail]!, next[next.length - 1 - tail]!)) tail += 1;
  if (head === current.length && head === next.length) return false;
  const anchor = current[current.length - tail] ?? null;
  for (const node of current.slice(head, current.length - tail)) node.parentNode?.removeChild(node);
  for (const node of next.slice(head, next.length - tail)) root.insertBefore(node, anchor);
  return true;
}

/** The browser's own trailing <br>, the last thing in the box: it gives the last line height and is not text. */
function finalBreak(root: HTMLElement): Node | null {
  let node: Node | null = root.lastChild;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE && !node.nodeValue) node = node.previousSibling;
    else if (node instanceof HTMLElement && node.tagName === "BR") return node;
    else if (node instanceof HTMLElement && node.dataset.chipText === undefined && node.lastChild) node = node.lastChild;
    else return null;
  }
  return null;
}

/** How much of the draft one node accounts for. */
function lengthOf(node: Node, final: Node | null): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? "").length;
  if (!(node instanceof HTMLElement)) return 0;
  if (node.dataset.chipText !== undefined) return node.dataset.chipText.length;
  if (node.tagName === "BR") return node === final ? 0 : 1;
  return [...node.childNodes].reduce((sum, child) => sum + lengthOf(child, final), 0);
}

const BLOCKS = new Set(["DIV", "P", "LI"]);

function textOf(node: Node, index: number, final: Node | null): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.chipText !== undefined) return node.dataset.chipText;
  if (node.tagName === "BR") return node === final ? "" : "\n";
  const inner = [...node.childNodes].map((child, at) => textOf(child, at, final)).join("");
  // A block the browser made anyway reads as a new line rather than a joined word.
  return BLOCKS.has(node.tagName) && index > 0 ? `\n${inner}` : inner;
}

/** The draft, exactly as it will be sent. */
export function serialize(root: HTMLElement): string {
  const final = finalBreak(root);
  return [...root.childNodes].map((child, at) => textOf(child, at, final)).join("");
}

function offsetOf(root: HTMLElement, target: Node, targetOffset: number): number {
  const final = finalBreak(root);
  let total = 0;
  let found = false;
  const walk = (node: Node): void => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) total += Math.min(targetOffset, (node.nodeValue ?? "").length);
      else total += [...node.childNodes].slice(0, targetOffset).reduce((sum, child) => sum + lengthOf(child, final), 0);
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && (node.dataset.chipText !== undefined || node.tagName === "BR"))) {
      total += lengthOf(node, final);
      return;
    }
    for (const child of node.childNodes) {
      walk(child);
      if (found) return;
    }
  };
  walk(root);
  return total;
}

/** The selection as draft offsets, or nothing when it is not in this box. */
export function selectionRange(root: HTMLElement): Run | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  return { start: offsetOf(root, range.startContainer, range.startOffset), end: offsetOf(root, range.endContainer, range.endOffset) };
}

/** Put the caret at a draft offset; an offset inside a chip resolves to its leading edge. */
export function placeCaret(root: HTMLElement, offset: number): void {
  const range = document.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;
  const before = (node: Node) => {
    if (!node.parentNode) return;
    range.setStart(node.parentNode, [...node.parentNode.childNodes].indexOf(node as ChildNode));
    placed = true;
  };

  const walk = (node: Node): void => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.nodeValue ?? "").length;
      if (remaining <= length) {
        range.setStart(node, remaining);
        placed = true;
        return;
      }
      remaining -= length;
      return;
    }
    if (node instanceof HTMLElement && node.dataset.chipText !== undefined) {
      const length = node.dataset.chipText.length;
      if (remaining < length) return before(node);
      remaining -= length;
      return;
    }
    if (node instanceof HTMLElement && node.tagName === "BR") {
      if (remaining < 1) return before(node);
      remaining -= 1;
      return;
    }
    for (const child of node.childNodes) {
      walk(child);
      if (placed) return;
    }
  };

  for (const child of root.childNodes) {
    walk(child);
    if (placed) break;
  }
  if (!placed) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
