import { z } from "zod";
import type { PluginManifestInput } from "@telar/engine-client";
import { textAnswer, type PluginEngine, type PluginSession, type PluginToolAnswer } from "../sdk";
import type { LatexCapability, LatexDiagnostic } from "./types";

type Tool = {
  description: string;
  shape: z.ZodRawShape;
  run(capability: LatexCapability, args: Record<string, unknown>): Promise<PluginToolAnswer>;
};

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));
const json = (value: unknown) => textAnswer(JSON.stringify(value, null, 2));

function describeDiagnostics(diagnostics: LatexDiagnostic[]): string {
  return diagnostics
    .map((d) => {
      const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""} — ` : "";
      const hint = d.suggestion ? `\n    ${d.suggestion}` : "";
      return `${d.severity === "error" ? "ERROR" : "warn "} ${where}${d.message}${hint}`;
    })
    .join("\n");
}

const TOOLS: Record<string, Tool & { failed: string }> = {
  latex_compile: {
    description:
      "Compile the project's main .tex file (or the one you name) to PDF and wait. Returns structured errors and warnings with file:line, and the PDF's path on success. The first Tectonic compile may download packages. Prefer fixing the FIRST error — TeX errors cascade.",
    shape: {
      path: z.string().min(1).optional().describe("A .tex file relative to the session's tree. Default: the project's configured main file."),
      timeoutMs: z.number().int().min(10_000).max(3_600_000).optional().describe("Give up after this long. Default ten minutes."),
    },
    failed: "Could not compile",
    async run(capability, args) {
      const result = await capability.compile({
        ...(typeof args.path === "string" ? { path: args.path } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
      });
      const body = describeDiagnostics(result.diagnostics);
      if (result.ok) {
        const errors = result.diagnostics.filter((d) => d.severity === "error").length;
        return textAnswer(`Compiled ${result.path}${result.pdfPath ? ` → ${result.pdfPath}` : ""}${errors ? ` with ${errors} error(s) swallowed by nonstopmode` : ""}.${body ? `\n${body}` : ""}`);
      }
      return textAnswer(`Compile of ${result.path} failed${result.error ? ` (${result.error})` : ""}.\n${body || result.logTail.join("\n")}`, true);
    },
  },
  latex_status: {
    description: "The last compile: ok or failed, its diagnostics and the PDF path. Cheap — call it before recompiling blind.",
    shape: {},
    failed: "Could not read the compile status",
    async run(capability) {
      const status = await capability.status();
      return status.status === "never" ? textAnswer("Nothing has been compiled in this session yet.") : json(status);
    },
  },
  latex_log: {
    description:
      "A window of the raw compile log — the tail by default, around a line number, or around the first match of a string. For when the structured diagnostics are not enough.",
    shape: {
      tail: z.number().int().min(1).max(400).optional().describe("The last N lines. Default 40."),
      around: z.number().int().min(1).optional().describe("Twenty lines either side of this log line."),
      find: z.string().min(1).optional().describe("The lines around the first case-insensitive match."),
    },
    failed: "Could not read the log",
    async run(capability, args) {
      const result = await capability.log({
        ...(typeof args.tail === "number" ? { tail: args.tail } : {}),
        ...(typeof args.around === "number" ? { around: args.around } : {}),
        ...(typeof args.find === "string" ? { find: args.find } : {}),
      });
      return textAnswer(result.lines.length ? result.lines.join("\n") : "No compile log yet — compile first.");
    },
  },
  latex_toolchain: {
    description:
      "Which TeX distribution this project compiles with — kind, engine, version, whether tlmgr manages packages — and what else the machine carries. Cheap.",
    shape: {},
    failed: "Could not read the toolchain",
    run: async (capability) => json(await capability.toolchain()),
  },
  latex_packages: {
    description: "Installed TeX packages when this project's distribution is tlmgr-managed; otherwise the sentence explaining how packages arrive here.",
    shape: {},
    failed: "Could not list packages",
    async run(capability) {
      const answer = await capability.packages();
      if (answer.mode === "automatic") return textAnswer(answer.note);
      if (answer.mode === "unavailable") return textAnswer(answer.reason, true);
      if (!answer.packages.length) return textAnswer("No packages are installed beyond the distribution's core.");
      return textAnswer(answer.packages.map((p) => `${p.name}${p.revision ? ` (r${p.revision})` : ""}${p.description ? `  ${p.description}` : ""}`).join("\n"));
    },
  },
  latex_install: {
    description:
      "Install or remove TeX Live packages with tlmgr and wait for the result. Refused on Tectonic projects, which download packages automatically. Package names only — no flags, no versions.",
    shape: {
      add: z.array(z.string().min(1)).optional().describe("tlmgr package names to install."),
      remove: z.array(z.string().min(1)).optional().describe("tlmgr package names to remove."),
    },
    failed: "Could not change packages",
    async run(capability, args) {
      const result = await capability.install({
        ...(Array.isArray(args.add) ? { add: args.add.map(String) } : {}),
        ...(Array.isArray(args.remove) ? { remove: args.remove.map(String) } : {}),
      });
      if (!result.ok) return textAnswer(result.error ?? result.lines.slice(-10).join("\n"), true);
      return textAnswer(result.lines.slice(-20).join("\n") || "Done.");
    },
  },
  latex_clean: {
    description:
      "Remove the compile's aux directory (and with pdf: true, the copied PDF) — the answer to a compile behaving strangely after refactors.",
    shape: { pdf: z.boolean().optional().describe("Also remove the last compile's PDF.") },
    failed: "Could not clean",
    async run(capability, args) {
      const result = await capability.clean(typeof args.pdf === "boolean" ? { pdf: args.pdf } : {});
      return textAnswer(result.removed.length ? `Removed ${result.removed.join(", ")}.` : "Nothing to clean.");
    },
  },
};

export const latexToolDeclarations: NonNullable<PluginManifestInput["tools"]> = Object.entries(TOOLS).map(([name, tool]) => {
  const { $schema: _schema, ...inputSchema } = z.toJSONSchema(z.object(tool.shape)) as Record<string, unknown>;
  void _schema;
  return { name, description: tool.description, inputSchema };
});

/** Every tool answers a failure as a sentence, never a crash. */
export function latexToolHandlers(capability: (session: PluginSession) => Promise<LatexCapability>): NonNullable<PluginEngine["tools"]> {
  return Object.fromEntries(
    Object.entries(TOOLS).map(([name, tool]) => [
      name,
      async (args: Record<string, unknown>, session: PluginSession) => {
        try {
          return await tool.run(await capability(session), args);
        } catch (error) {
          return textAnswer(`${tool.failed}: ${failure(error)}`, true);
        }
      },
    ]),
  );
}
