export type ChatWidth = "comfortable" | "wide" | "full";

/** The NSUserDefaults key the Swift app keeps the Appearance → Chat width choice under; Settings writes it, the chat reads it. */
export const CHAT_WIDTH_KEY = "telar.chatWidth";

const MEASURE: Record<ChatWidth, number> = { comfortable: 680, wide: 980, full: Infinity };

/** A stored Chat width, with anything unknown read as Comfortable. */
export function chatWidthOf(value: unknown): ChatWidth {
  return value === "wide" || value === "full" ? value : "comfortable";
}

/** The widest the reading lane may grow, margins included. Only an iPad at regular width honours Wide and Full; everything else reads Comfortable. */
export function laneMaxWidth(setting: ChatWidth, margins: number, wideAllowed: boolean): number {
  return MEASURE[wideAllowed ? setting : "comfortable"] + 2 * margins;
}
