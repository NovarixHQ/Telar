import type { JournalEntry } from "../../platform/kernel";

type Envelope = { pluginId: string; name: string; data: unknown };

/** Released iOS builds fold these core kinds for the kernel pill and plot refresh; remove by 2027-01-01. */
export function legacyKernelEvent({ pluginId, name, data }: Envelope): JournalEntry | undefined {
  if (pluginId !== "data-science" || !data || typeof data !== "object") return undefined;
  const body = data as Record<string, unknown>;
  if (name === "kernel.state") return { type: "kernel.state.changed", ...body } as JournalEntry;
  if (name === "cell.output") return { type: "notebook.cell.output", ...body } as JournalEntry;
  return undefined;
}
