import { z } from "zod";
import type { CapabilityModel } from "@telar/engine-client";
import { err, failure, json, type ToolFactory } from "../../agent-tools";
import { CAPABILITIES, type SessionsCapability } from "./shared";

const PAGE_CHARS = 6_000;

const modelLine = (model: CapabilityModel): string => {
  const efforts = model.efforts.length ? `efforts ${model.efforts.join("/")}${model.defaultEffort ? ` (default ${model.defaultEffort})` : ""}` : "no effort";
  const parts = [model.id, model.label, efforts, ...(model.window ? [`${Math.round(model.window / 1000)}k window`] : []), ...(model.tier ? [`tier ${model.tier}`] : []), ...(model.default ? ["default"] : [])];
  return parts.join(" · ");
};

export function capabilitiesTool(tool: ToolFactory, capability: SessionsCapability): unknown {
  return tool(
    "sessions_capabilities",
    CAPABILITIES,
    {
      provider: z.string().min(1).optional().describe("Only this provider's models."),
      after: z.number().int().min(0).optional().describe("Continue from the `more.after` of the previous page."),
    },
    async (args) => {
      try {
        const { providers, ...rest } = await capability.capabilities();
        const chosen = typeof args.provider === "string" ? providers.filter((entry) => entry.instanceId === args.provider) : providers;
        if (chosen.length === 0) return err(`No provider "${String(args.provider)}" is offered. Offered: ${providers.map((entry) => entry.instanceId).join(", ")}.`);
        const rows = [...chosen].sort((a, b) => a.instanceId.localeCompare(b.instanceId)).flatMap((entry) => entry.models.map((model) => ({ entry, line: modelLine(model) })));
        const start = typeof args.after === "number" ? args.after : 0;
        let end = start;
        let chars = 0;
        while (end < rows.length && (end === start || chars + rows[end]!.line.length <= PAGE_CHARS)) chars += rows[end++]!.line.length + 1;
        const page = new Map<string, string[]>();
        for (const { entry, line } of rows.slice(start, end)) page.set(entry.instanceId, [...(page.get(entry.instanceId) ?? []), line]);
        const listed = [...chosen]
          .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
          .filter((entry) => page.has(entry.instanceId) || (start === 0 && entry.models.length === 0))
          .map((entry) => ({ instanceId: entry.instanceId, driver: entry.driver, ...(entry.name ? { name: entry.name } : {}), models: page.get(entry.instanceId) ?? [] }));
        return json({
          ...(start === 0 ? rest : {}),
          providers: listed,
          ...(end < rows.length ? { more: { after: end, of: rows.length, note: "Call again with after to see the rest; a provider filter narrows it." } } : {}),
        });
      } catch (error) {
        return err(`Could not read what this Mac offers: ${failure(error)}`);
      }
    },
  );
}
