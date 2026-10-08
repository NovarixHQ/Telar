const FRAME_END = "\n\n";

export async function readEventStream(body: NonNullable<Response["body"]>, signal: AbortSignal, apply: (data: unknown) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done || signal.aborted) return;
    buffer += value;
    let boundary = buffer.indexOf(FRAME_END);
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + FRAME_END.length);
      boundary = buffer.indexOf(FRAME_END);
      if (!frame.startsWith("data:")) continue;
      let data: unknown;
      try {
        data = JSON.parse(frame.slice("data:".length).trim());
      } catch {
        continue;
      }
      apply(data);
    }
  }
}
