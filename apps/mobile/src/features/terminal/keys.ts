/** Keys a phone keyboard lacks, as the bytes a terminal expects. */
export const SPECIAL_KEYS = [
  { label: "esc", name: "Escape", data: "\u001b" },
  { label: "tab", name: "Tab", data: "\t" },
  { label: "⌃C", name: "Control C", data: "\u0003" },
  { label: "⌃D", name: "Control D", data: "\u0004" },
  { label: "↑", name: "Up arrow", data: "\u001b[A" },
  { label: "↓", name: "Down arrow", data: "\u001b[B" },
  { label: "←", name: "Left arrow", data: "\u001b[D" },
  { label: "→", name: "Right arrow", data: "\u001b[C" },
] as const;

/** What the send key writes: the line and a carriage return, which a shell reads as Enter. */
export const typedLine = (line: string) => `${line}\r`;
