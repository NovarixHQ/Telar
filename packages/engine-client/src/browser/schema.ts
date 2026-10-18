import { z } from "zod";
import { BrowserTab } from "../protocol/common";

const modifiers = z.number().int().min(0).max(15).default(0);
const point = { x: z.number(), y: z.number() };

export const BrowserInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mouse"), action: z.enum(["move", "down", "up"]), ...point, button: z.enum(["left", "middle", "right"]).default("left"), clickCount: z.number().int().min(1).max(3).default(1), modifiers }),
  z.object({ type: z.literal("wheel"), ...point, deltaX: z.number(), deltaY: z.number() }),
  z.object({ type: z.literal("key"), action: z.enum(["down", "up"]), key: z.string().min(1), code: z.string().default(""), text: z.string().optional(), keyCode: z.number().int().optional(), modifiers }),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(10_000) }),
  z.object({ type: z.literal("resize"), width: z.number().int().min(100).max(4096), height: z.number().int().min(100).max(4096) }),
  z.object({ type: z.literal("tab"), action: z.enum(["select", "new", "close"]), tabId: z.string().min(1).optional(), url: z.string().optional() }),
  z.object({ type: z.literal("navigate"), url: z.string().min(1) }),
  z.object({ type: z.literal("history"), action: z.enum(["back", "forward", "reload"]) }),
]);
export type BrowserInput = z.infer<typeof BrowserInput>;

export const BrowserStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("frame"), tabId: z.string(), data: z.string(), width: z.number(), height: z.number() }),
  z.object({ type: z.literal("tabs"), tabs: z.array(BrowserTab) }),
]);
export type BrowserStreamEvent = z.infer<typeof BrowserStreamEvent>;
