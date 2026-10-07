import type { AcpConnection } from "./rpc";
import { record } from "./items";

type ConfigOption = { id: string; category: string | undefined; currentValue: unknown; values: string[] };

function valuesOf(options: unknown): string[] {
  return (Array.isArray(options) ? options : []).flatMap((entry) => {
    const option = record(entry);
    if (typeof option.value === "string") return [option.value];
    return Array.isArray(option.options) ? valuesOf(option.options) : [];
  });
}

export function configOptions(response: unknown): ConfigOption[] {
  const list = record(response).configOptions;
  return (Array.isArray(list) ? list : []).map(record).flatMap((option) =>
    typeof option.id === "string"
      ? [{ id: option.id, category: typeof option.category === "string" ? option.category : undefined, currentValue: option.currentValue, values: valuesOf(option.options) }]
      : [],
  );
}

export async function applyChoices(
  rpc: AcpConnection,
  session: { sessionId: string; options: ConfigOption[]; models: string[] },
  wanted: { model?: string | undefined; effort?: string | undefined },
): Promise<string[]> {
  const refused: string[] = [];
  for (const [category, value] of [["model", wanted.model], ["thought_level", wanted.effort]] as const) {
    if (!value) continue;
    const option = session.options.find((entry) => entry.category === category || entry.id === category);
    try {
      if (option) {
        if (option.currentValue === value) continue;
        if (option.values.length > 0 && !option.values.includes(value)) throw new Error(`${value} is not one it offers`);
        const next = configOptions(await rpc.request("session/set_config_option", { sessionId: session.sessionId, configId: option.id, value }));
        if (next.length > 0) session.options = next;
        else option.currentValue = value;
      } else if (category === "model" && session.models.includes(value)) {
        await rpc.request("session/set_model", { sessionId: session.sessionId, modelId: value });
      }
    } catch (error) {
      refused.push(`The agent refused ${category === "model" ? "model" : "effort"} ${value}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return refused;
}
