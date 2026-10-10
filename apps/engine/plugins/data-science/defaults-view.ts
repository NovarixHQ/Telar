import type { PluginPanelBlock } from "@telar/engine-client";
import type { DataScienceOps } from "./operations";
import { machineDefaults } from "./settings";
import type { PluginEngine, PluginHost } from "../sdk";

/** This Mac's defaults: the Python a project without its own runs on, and the packages every new environment gets. */
export function defaultsRoutes(ops: DataScienceOps, host: Pick<PluginHost, "machineSettings" | "writeMachineSettings">): NonNullable<PluginEngine["machine"]> {
  const write = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...machineDefaults(host.machineSettings()), ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    host.writeMachineSettings(next);
  };
  return {
    "GET defaults": {
      handle: async () => {
        const defaults = machineDefaults(host.machineSettings());
        const found = (await ops.toolchain()).pythons.filter((python) => python.installed && python.path);
        const options = found.map((python) => ({ value: python.path!, label: `Python ${python.version} — ${python.path}` }));
        if (defaults.python && !options.some((option) => option.value === defaults.python)) options.unshift({ value: defaults.python, label: defaults.python });
        const blocks: PluginPanelBlock[] = [
          {
            type: "select",
            label: "Default Python",
            hint: "The interpreter a project with none of its own runs its kernel on.",
            name: "python",
            ...(defaults.python ? { value: defaults.python } : {}),
            options: [{ value: "", label: "None" }, ...options],
            verb: "default-python",
          },
          { type: "action", label: "Use this Python", verb: "default-python", field: { name: "python", placeholder: "/opt/homebrew/bin/python3.12" } },
          { type: "heading", text: "Default packages" },
          { type: "text", text: "Installed into environments Telar creates from here on. Nothing is installed into an environment that already exists." },
          { type: "action", label: "Save", verb: "default-packages", field: { name: "packages", placeholder: "pandas, matplotlib, numpy", ...(defaults.packages?.length ? { value: defaults.packages.join(", ") } : {}) } },
        ];
        return { blocks };
      },
    },
    "POST default-python": { handle: ({ input }) => write({ python: typeof input.python === "string" && input.python.trim() ? input.python.trim() : undefined }) },
    "POST default-packages": {
      handle: ({ input }) => {
        const packages = typeof input.packages === "string" ? input.packages.split(/[\n,]/).map((name) => name.trim()).filter(Boolean) : [];
        write({ packages: packages.length ? packages : undefined });
      },
    },
  };
}
