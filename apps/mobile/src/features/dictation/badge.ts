/** The caret pill's language: the code in capitals, or AUTO when the host detects it. */
export function languageBadge(code: string | undefined): string {
  const trimmed = (code ?? "").trim();
  return !trimmed || trimmed === "multi" ? "AUTO" : trimmed.toUpperCase();
}
