import { RunStreamFrame } from "@telar/engine-client";

/** Splits event-stream text into its `data:` frames; `rest` is an unfinished last line to prepend to the next chunk. */
export function takeFrames(buffer: string): { frames: RunStreamFrame[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const frames: RunStreamFrame[] = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    try {
      const parsed = RunStreamFrame.safeParse(JSON.parse(line.slice(5)));
      if (parsed.success) frames.push(parsed.data);
    } catch {}
  }
  return { frames, rest };
}
