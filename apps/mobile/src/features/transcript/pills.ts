import { segmentDraft, type TelarReference } from "@telar/client/composer";

const OPEN = "";
const CLOSE = "";
const FENCE = /^(```[^\n]*\n[\s\S]*?\n```[ \t]*$)/gm;
const SLOT = /(\d+)/;

/** Swaps each reference outside code fences for a private-use slot, so Markdown parses the prose around it. Bare URLs stay Markdown links. */
export function maskReferences(text: string): { masked: string; references: TelarReference[] } {
  const references: TelarReference[] = [];
  const masked = text
    .split(FENCE)
    .map((part, index) =>
      index % 2
        ? part
        : segmentDraft(part)
            .map((segment) => {
              if (segment.type === "text" || (segment.reference.kind === "page" && segment.reference.text.startsWith("http"))) {
                return segment.type === "text" ? segment.text : segment.reference.text;
              }
              return `${OPEN}${references.push(segment.reference) - 1}${CLOSE}`;
            })
            .join(""),
    )
    .join("");
  return { masked, references };
}

/** A string from the parsed Markdown as plain runs and the references that were masked in it. */
export function splitReferences(text: string, references: readonly TelarReference[]): (string | TelarReference)[] {
  if (!text.includes(OPEN)) return [text];
  return text.split(SLOT).flatMap((part, index): (string | TelarReference)[] => {
    if (index % 2 === 0) return part ? [part] : [];
    const reference = references[Number(part)];
    return reference ? [reference] : [];
  });
}
