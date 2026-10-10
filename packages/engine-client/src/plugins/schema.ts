import { z } from "zod";
import { composerVerbs, PluginComposer } from "./composer";

export const PLUGIN_API_VERSION = 1;

export const PluginId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "a plugin id is lowercase letters, digits and dashes, starting with a letter");
export type PluginId = z.infer<typeof PluginId>;

export const PluginEventName = z.string().regex(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/, "an event name is lowercase, dot-separated").max(64);

export const PluginToolPrefix = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9]*$/, "a tool prefix is lowercase letters and digits, starting with a letter");

export const PluginSettingsScope = z.enum(["project", "machine"]);
export type PluginSettingsScope = z.infer<typeof PluginSettingsScope>;

export const PluginSettingsSection = z.object({
  /** Unique within the plugin. Becomes part of the surface's key. */
  id: z.string().min(1).max(64),
  scope: PluginSettingsScope,
  label: z.string().min(1).max(80),
  /** One line under the label. */
  blurb: z.string().max(200).optional(),
  /** Lucide icon name, resolved by the web registry. Unknown names fall back. */
  icon: z.string().min(1).max(64).optional(),
  /** A GET route in the section's scope that answers a `PluginPanelView`; its actions POST to that scope. */
  view: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64).optional(),
});
export type PluginSettingsSection = z.infer<typeof PluginSettingsSection>;

/** A session verb, as the generic door spells it: `status`, `jobs-refresh`. */
const PluginSessionVerb = z.string().regex(/^[a-z][a-z0-9-]*$/, "a verb is lowercase letters, digits and dashes");

export const PluginPanel = z.strictObject({
  /** Unique within the plugin. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64),
  label: z.string().min(1).max(40),
  /** The session verb that answers with a `PluginPanelView`. */
  verb: PluginSessionVerb,
  refreshOn: z.array(PluginEventName).max(16).optional(),
});
export type PluginPanel = z.infer<typeof PluginPanel>;

const Cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const Tone = z.enum(["ok", "error", "warning", "neutral"]);

/** A text box whose value is sent under `name` with the action it sits beside. */
const PluginField = z.strictObject({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/).max(64),
  placeholder: z.string().max(200).optional(),
  value: z.string().max(2000).optional(),
});

const PluginAction = z.strictObject({
  label: z.string().min(1).max(40),
  verb: PluginSessionVerb,
  input: z.record(z.string(), z.unknown()).optional(),
  confirm: z.string().min(1).max(200).optional(),
});

export const PluginPanelBlock = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("heading"), text: z.string().min(1).max(200) }),
  /** Plain text, or Markdown when `markdown` is set. */
  z.strictObject({ type: z.literal("text"), text: z.string().max(20_000), markdown: z.boolean().optional() }),
  z.strictObject({
    type: z.literal("keyValue"),
    items: z.array(z.strictObject({ key: z.string().min(1).max(200), value: Cell })).max(100),
  }),
  z.strictObject({
    type: z.literal("table"),
    columns: z.array(z.string().max(200)).min(1).max(20),
    rows: z.array(z.array(Cell).max(20)).max(500),
  }),
  /** The tail of something, oldest line first, drawn monospaced; `collapsed` hides it behind its title. */
  z.strictObject({
    type: z.literal("log"),
    lines: z.array(z.string().max(2000)).max(500),
    title: z.string().min(1).max(80).optional(),
    collapsed: z.boolean().optional(),
  }),
  /** Calls one of the plugin's verbs in the view's scope with `input` (and the field's text), then redraws. */
  PluginAction.extend({ type: z.literal("action"), field: PluginField.optional() }),
  z.strictObject({ type: z.literal("status"), text: z.string().min(1).max(80), tone: Tone.default("neutral") }),
  /** Problems found in files; a row with a `file` opens it in the cockpit. */
  z.strictObject({
    type: z.literal("issues"),
    items: z
      .array(
        z.strictObject({
          severity: z.enum(["error", "warning"]),
          message: z.string().min(1).max(2000),
          file: z.string().max(1000).optional(),
          line: z.number().int().optional(),
          detail: z.string().max(2000).optional(),
        }),
      )
      .max(200),
  }),
  /** A button that opens a file of the session's tree in the cockpit. */
  z.strictObject({ type: z.literal("file"), label: z.string().min(1).max(40), path: z.string().min(1).max(1000) }),
  /** A choice that calls `verb` with `{[name]: value}`; the empty value means "none". */
  z.strictObject({
    type: z.literal("select"),
    label: z.string().min(1).max(80),
    hint: z.string().max(300).optional(),
    name: PluginField.shape.name,
    value: z.string().max(1000).optional(),
    options: z.array(z.strictObject({ value: z.string().max(1000), label: z.string().min(1).max(120) })).max(100),
    verb: PluginSessionVerb,
  }),
  /** One choice among several, drawn as a card; `selected` marks the one in use. */
  z.strictObject({
    type: z.literal("option"),
    title: z.string().min(1).max(120),
    detail: z.string().max(500).optional(),
    badge: z.string().max(60).optional(),
    selected: z.boolean().optional(),
    action: PluginAction.optional(),
  }),
  /** Opens a new session's composer on the view's project with `text` drafted. */
  z.strictObject({ type: z.literal("prompt"), label: z.string().min(1).max(40), text: z.string().min(1).max(4000) }),
]);
export type PluginPanelBlock = z.infer<typeof PluginPanelBlock>;

export type PluginPanelView = { blocks: PluginPanelBlock[]; skipped: number; refreshMs?: number };

/** `refreshMs` asks the cockpit to read the view again after that long, while something runs. */
export function parsePluginPanelView(value: unknown): PluginPanelView {
  const view = value as { blocks?: unknown; refreshMs?: unknown } | null;
  const raw = view?.blocks;
  if (!Array.isArray(raw)) return { blocks: [], skipped: 0 };
  const blocks: PluginPanelBlock[] = [];
  for (const candidate of raw.slice(0, 200)) {
    const parsed = PluginPanelBlock.safeParse(candidate);
    if (parsed.success) blocks.push(parsed.data);
  }
  const refreshMs = typeof view?.refreshMs === "number" && view.refreshMs >= 500 ? Math.min(view.refreshMs, 60_000) : undefined;
  return { blocks, skipped: raw.length - blocks.length, ...(refreshMs ? { refreshMs } : {}) };
}

export const PluginAssetPath = z
  .string()
  .max(200)
  .regex(/^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:html|js|css|svg|json)$/, "an asset is a relative path ending in .html, .js, .css, .svg or .json");

const FileExtension = z.string().regex(/^\.[a-z0-9]+$/, "an extension is a dot and lowercase letters or digits: .ipynb");

export const PluginViewer = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64),
  label: z.string().min(1).max(40),
  entry: PluginAssetPath,
  extensions: z.array(FileExtension).max(16).default([]),
  mimes: z.array(z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/)).max(16).default([]),
});
export type PluginViewer = z.infer<typeof PluginViewer>;

export const PluginRichView = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64),
  label: z.string().min(1).max(40),
  entry: PluginAssetPath,
});
export type PluginRichView = z.infer<typeof PluginRichView>;

export const PluginMeta = z.object({
  id: PluginId,
  /** The contract revision this plugin is written against. */
  api: z.number().int().min(1),
  /** What a human calls it. */
  name: z.string().min(1).max(80),
  /** The plugin's own version, for display and for support questions. */
  version: z.string().min(1).max(32),
  blurb: z.string().max(300).optional(),
  icon: z.string().min(1).max(64).optional(),
  toolPrefixes: z.array(PluginToolPrefix),
  readTools: z.array(z.string().min(1)).default([]),
  briefing: z.string().min(1).max(2000).optional(),
  /** Names of the `plugin.event`s this plugin emits. */
  eventKinds: z.array(z.string().min(1)).default([]),
  sessionStateDir: z.string().min(1).max(64).optional(),
  /** A `.gitignore` rule the plugin wants in projects that enable it. */
  gitignore: z
    .object({
      rule: z.string().min(1),
      why: z.string().min(1),
      alreadyCovered: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  settings: z.array(PluginSettingsSection).default([]),
  /** Panel surfaces drawn from blocks. */
  panels: z.array(PluginPanel).optional(),
  composer: PluginComposer.optional(),
  viewers: z.array(PluginViewer).optional(),
  views: z.array(PluginRichView).optional(),
  fileScope: z.array(FileExtension).optional(),
});
export type PluginMeta = z.infer<typeof PluginMeta>;

export const PluginTool = z.strictObject({
  /** Must start with the manifest's `toolPrefix` and an underscore. */
  name: z.string().regex(/^[a-z][a-z0-9]*_[a-z0-9_]+$/, "a tool name is <prefix>_<name>, lowercase"),
  description: z.string().min(1).max(2000),
  /** The arguments, as a JSON Schema object. */
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object", properties: {} }),
});
export type PluginTool = z.infer<typeof PluginTool>;

/** A route key as the host's scoped tables spell it: `"GET status"`, `"POST jobs/:id"`. */
const RouteKey = z.string().regex(/^(GET|POST|DELETE) [a-z][a-z0-9-]*(\/(:?[a-z][a-z0-9-]*))*$/, "a route is '<METHOD> <path>'");

/**
 * What every plugin declares, bundled or installed. An installed plugin's `plugin.json` names the `command`
 * the engine runs it with; a bundled one has none, because its engine module is linked into the engine.
 */
export const PluginManifest = z
  .strictObject({
    id: PluginId,
    api: z.literal(PLUGIN_API_VERSION),
    name: z.string().min(1).max(80),
    version: z.string().min(1).max(32),
    description: z.string().max(300).optional(),
    icon: z.string().min(1).max(64).optional(),
    /** argv. A first element starting with `./` is resolved inside the plugin's folder. */
    command: z.array(z.string().min(1)).min(1).optional(),
    /** Required once the plugin declares a tool. */
    toolPrefix: PluginToolPrefix.optional(),
    tools: z.array(PluginTool).max(64).default([]),
    /** The paragraph a session is told while the plugin is on. */
    briefing: z.string().min(1).max(2000).optional(),
    settingsSchema: z.record(z.string(), z.unknown()).optional(),
    machineSettingsSchema: z.record(z.string(), z.unknown()).optional(),
    /** Settings sections; absent means one per schema the plugin declares. */
    settings: z.array(PluginSettingsSection).max(8).optional(),
    routes: z
      .strictObject({
        session: z.array(PluginSessionVerb).default([]),
        project: z.array(RouteKey).default([]),
        machine: z.array(RouteKey).default([]),
      })
      .default({ session: [], project: [], machine: [] }),
    /** Panel surfaces, each drawn from a declared session verb. */
    panels: z.array(PluginPanel).max(8).default([]),
    composer: PluginComposer.optional(),
    viewers: z.array(PluginViewer).max(16).default([]),
    views: z.array(PluginRichView).max(8).default([]),
    fileScope: z.array(FileExtension).max(32).default([]),
    /** Names of the `plugin.event`s the plugin emits; anything else it emits is refused. */
    eventKinds: z.array(PluginEventName).max(16).default([]),
    /** A `.gitignore` rule written into a project when it turns the plugin on. */
    gitignore: z
      .strictObject({ rule: z.string().min(1).max(200), why: z.string().min(1).max(200), alreadyCovered: z.array(z.string().min(1)).default([]) })
      .optional(),
  })
  .superRefine((manifest, context) => {
    if (manifest.tools.length > 0 && !manifest.toolPrefix) {
      context.addIssue({ code: "custom", path: ["toolPrefix"], message: "a plugin that declares tools needs a toolPrefix" });
    }
    for (const [index, tool] of manifest.tools.entries()) {
      if (manifest.toolPrefix && !tool.name.startsWith(`${manifest.toolPrefix}_`)) {
        context.addIssue({ code: "custom", path: ["tools", index, "name"], message: `must start with "${manifest.toolPrefix}_"` });
      }
    }
    if (new Set(manifest.tools.map((tool) => tool.name)).size !== manifest.tools.length) {
      context.addIssue({ code: "custom", path: ["tools"], message: "two tools share a name" });
    }
    // `tool` is the verb a tool call travels under; a route may not shadow it.
    if (manifest.routes.session.includes("tool")) {
      context.addIssue({ code: "custom", path: ["routes", "session"], message: '"tool" is reserved' });
    }
    for (const [index, panel] of manifest.panels.entries()) {
      if (!manifest.routes.session.includes(panel.verb)) {
        context.addIssue({ code: "custom", path: ["panels", index, "verb"], message: `"${panel.verb}" is not a declared session route` });
      }
    }
    if (new Set(manifest.panels.map((panel) => panel.id)).size !== manifest.panels.length) {
      context.addIssue({ code: "custom", path: ["panels"], message: "two panels share an id" });
    }
    for (const { path, verb } of manifest.composer ? composerVerbs(manifest.composer) : []) {
      if (!manifest.routes.session.includes(verb)) context.addIssue({ code: "custom", path: ["composer", ...path], message: `"${verb}" is not a declared session route` });
    }
    if (new Set(manifest.viewers.map((viewer) => viewer.id)).size !== manifest.viewers.length) {
      context.addIssue({ code: "custom", path: ["viewers"], message: "two viewers share an id" });
    }
    if (new Set(manifest.views.map((view) => view.id)).size !== manifest.views.length) {
      context.addIssue({ code: "custom", path: ["views"], message: "two views share an id" });
    }
    for (const [index, section] of (manifest.settings ?? []).entries()) {
      if (section.view && !manifest.routes[section.scope].includes(`GET ${section.view}`)) {
        context.addIssue({ code: "custom", path: ["settings", index, "view"], message: `"GET ${section.view}" is not a declared ${section.scope} route` });
      }
    }
  });
export type PluginManifest = z.infer<typeof PluginManifest>;
export type PluginManifestInput = z.input<typeof PluginManifest>;

/** What a plugin's runtime is doing, as the health document reports it. */
export const PluginRuntimeState = z.enum(["ready", "failed", "disposed"]);
export type PluginRuntimeState = z.infer<typeof PluginRuntimeState>;

export const PluginStatus = z.object({
  meta: PluginMeta,
  state: PluginRuntimeState,
  /** Present when `state` is `failed` — the sentence a human should read. */
  error: z.string().optional(),
  /** How long `init` took, so a slow plugin is visible before it is a bug report. */
  initMs: z.number().optional(),
  settingsSchema: z.record(z.string(), z.unknown()).optional(),
  machineSettingsSchema: z.record(z.string(), z.unknown()).optional(),
  installed: z.object({ linked: z.boolean() }).optional(),
});
export type PluginStatus = z.infer<typeof PluginStatus>;

/** Install a plugin from a folder on this Mac: copied in, or linked to where it is. */
export const PluginInstallInput = z.strictObject({
  path: z.string().min(1),
  mode: z.enum(["copy", "link"]).default("copy"),
});
export type PluginInstallInput = z.input<typeof PluginInstallInput>;

// ── per-project configuration ───────────────────────────────────────────────

export const PluginConfig = z.object({
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type PluginConfig = z.infer<typeof PluginConfig>;

export const PROJECT_PLUGINS_VERSION = 1;

export const ProjectPlugins = z.object({
  version: z.number().int().min(1),
  entries: z.record(PluginId, PluginConfig),
});
export type ProjectPlugins = z.infer<typeof ProjectPlugins>;

export const LEGACY_PLUGIN_KEYS = {
  latex: "latex",
  "data-science": "dataScience",
} as const satisfies Record<string, "latex" | "dataScience">;

export const BUNDLED_PLUGIN_TOOL_PREFIXES = ["ds", "notebook", "hello"] as const;

export function pluginConfigFromLegacy(legacy: Record<string, unknown>): PluginConfig {
  const { enabled, ...rest } = legacy;
  const settings = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  return {
    enabled: enabled === true,
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
  };
}

export function legacyFromPluginConfig(config: PluginConfig): Record<string, unknown> {
  return { enabled: config.enabled, ...config.settings };
}

export function readProjectPlugins(project: {
  plugins?: unknown;
  latex?: unknown;
  dataScience?: unknown;
}): { plugins: ProjectPlugins; migrated: boolean } {
  const parsed = ProjectPlugins.safeParse(project.plugins);
  if (parsed.success) return { plugins: parsed.data, migrated: true };

  const entries: Record<string, PluginConfig> = {};
  for (const [id, key] of Object.entries(LEGACY_PLUGIN_KEYS)) {
    const legacy = project[key];
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      entries[id] = pluginConfigFromLegacy(legacy as Record<string, unknown>);
    }
  }
  return { plugins: { version: PROJECT_PLUGINS_VERSION, entries }, migrated: false };
}

export function migrateLegacyPluginFields(project: Record<string, unknown>): { project: Record<string, unknown>; changed: boolean } {
  const legacyKeys = Object.values(LEGACY_PLUGIN_KEYS).filter((key) => project[key] !== undefined);
  if (legacyKeys.length === 0) return { project, changed: false };
  const current = ProjectPlugins.safeParse(project.plugins);
  const entries: Record<string, PluginConfig> = current.success ? { ...current.data.entries } : {};
  for (const [id, key] of Object.entries(LEGACY_PLUGIN_KEYS)) {
    const legacy = project[key];
    if (entries[id] !== undefined || !legacy || typeof legacy !== "object" || Array.isArray(legacy)) continue;
    entries[id] = pluginConfigFromLegacy(legacy as Record<string, unknown>);
  }
  const { latex: _latex, dataScience: _dataScience, ...rest } = project;
  void _latex;
  void _dataScience;
  return { project: { ...rest, plugins: { version: PROJECT_PLUGINS_VERSION, entries } }, changed: true };
}

/**
 * A plugin's entry as one flat block — `{enabled, ...settings}`, the shape the
 * Data Science and LaTeX settings panes and resolvers read. `undefined` when
 * the project has no entry for it (which means off).
 */
export function pluginBlock(project: { plugins?: unknown; latex?: unknown; dataScience?: unknown }, id: string): Record<string, unknown> | undefined {
  const config = readProjectPlugins(project).plugins.entries[id];
  return config ? legacyFromPluginConfig(config) : undefined;
}

/** Whether a project has a plugin switched on. The single question every gate asks. */
export function pluginEnabled(plugins: ProjectPlugins, id: string): boolean {
  return plugins.entries[id]?.enabled === true;
}

/** A plugin's settings blob, or `{}`. Still unvalidated — the host does that. */
export function pluginSettings(plugins: ProjectPlugins, id: string): Record<string, unknown> {
  return plugins.entries[id]?.settings ?? {};
}

export type PluginPatch = Record<string, PluginConfig | null>;

export function applyPluginPatch(plugins: ProjectPlugins, patch: PluginPatch): ProjectPlugins {
  const entries = { ...plugins.entries };
  for (const [id, config] of Object.entries(patch)) {
    if (config === null) delete entries[id];
    else entries[id] = config;
  }
  return { version: PROJECT_PLUGINS_VERSION, entries };
}

// ── machine-wide configuration ──────────────────────────────────────────────

export const MachinePlugins = ProjectPlugins;
export type MachinePlugins = ProjectPlugins;

export function machineAllows(machine: ProjectPlugins | undefined, id: string): boolean {
  const entry = machine?.entries[id];
  return entry === undefined ? true : entry.enabled;
}

/** What actually runs: the machine allows it and the project asked for it. */
export function pluginEffectivelyEnabled(
  machine: ProjectPlugins | undefined,
  project: ProjectPlugins,
  id: string,
): boolean {
  return machineAllows(machine, id) && pluginEnabled(project, id);
}

export function machineSettings(machine: ProjectPlugins | undefined, id: string): Record<string, unknown> {
  return machine?.entries[id]?.settings ?? {};
}

// ── Data Science's machine settings, for clients ──────────────────────────────

const dataScienceMachineFields = {
  python: z.string().min(1).optional().meta({
    title: "Default Python",
    description: "The interpreter a project with none of its own runs its kernel on.",
    info: "An absolute path: a default for the computer cannot be relative to a checkout.",
    widget: "path",
    icon: "flask-conical",
  }),
  packages: z.array(z.string().min(1).max(200)).max(200).optional(),
};

export const PLUGIN_PACKAGE_REQUIREMENT =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9._,\s-]+\])?\s*((?:[<>=!~]=?|===)\s*[A-Za-z0-9.*+!_-]+(?:\s*,\s*(?:[<>=!~]=?|===)\s*[A-Za-z0-9.*+!_-]+)*)?$/;

export const DataScienceMachineSettings = z.object(dataScienceMachineFields);
export type DataScienceMachineSettings = z.infer<typeof DataScienceMachineSettings>;

/** What a write is checked against. Strict, and per-kind about the path. */
export const DataScienceMachineSettingsWrite = z.strictObject({
  ...dataScienceMachineFields,
  packages: z.array(z.string().min(1).max(200).regex(PLUGIN_PACKAGE_REQUIREMENT, "not a package requirement")).max(200).optional(),
});

/** The data-science defaults this Mac carries, read out of the opaque blob. */
export function dataScienceMachineSettings(machine: ProjectPlugins | undefined): DataScienceMachineSettings {
  const parsed = DataScienceMachineSettings.safeParse(machineSettings(machine, "data-science"));
  return parsed.success ? parsed.data : {};
}
