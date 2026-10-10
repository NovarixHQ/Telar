# Plugins

- Every plugin declares itself with one manifest (`PluginManifest`): the fields of a `plugin.json`.
- **Module plugins** ship with the app under `apps/engine/plugins/<id>/`. A module exports its manifest and an engine module (`BundledPlugin`, from `plugins/sdk`). The engine loads it in-process, before anything installed. LaTeX is one.
- **External plugins** live in `<TELAR_HOME>/plugins/<id>/`. They have the same manifest plus a `command`, which the engine supervises as a child process. The child speaks JSON-RPC over stdio: MCP `initialize`/`tools/call`, plus `telar/route`, and it sends `telar/event` notifications and `telar/complete` requests.
- An installed plugin can't take a bundled plugin's id or tool prefix. It is refused and listed as failed.
- Data Science and the `hello` proof plugin still predate the manifest. They are wired in `domains/plugins/bundled.ts`, and their tool prefixes are listed in `BUNDLED_PLUGIN_TOOL_PREFIXES`.

## What a manifest declares

| Field | Where it shows |
| --- | --- |
| `tools`, `toolPrefix`, `briefing` | `telarWall`, under the plugin's prefix. A call travels through the session verb `tool`. |
| `routes.session` / `.project` / `.machine` | `/v2/sessions/:id/plugins/<id>/<verb>`, `/v2/projects/:id/plugins/…`, `/v2/plugins/…` |
| `settingsSchema`, `machineSettingsSchema` | generated rows in Settings ▸ Plugins and a project's page. A property with `widget: "view"` is left to the plugin's view. |
| `settings[].view` | a GET route in the section's scope. It answers blocks, which are drawn under the generated rows. |
| `panels` | the Plugins panel tab, drawn from blocks a session verb answers. `refreshOn` names events that make it read again. |
| `eventKinds` | the names of the `plugin.event`s it may emit. Anything else is refused. |
| `gitignore` | the rule written into a project when it turns the plugin on |
| `composer` | decorations and `/` commands in the composer of the plugin's projects |

The cockpit has no plugin-specific React for a manifest plugin: every surface it draws is blocks (`PluginPanelBlock`). A view may ask to be read again with `refreshMs` while something runs that emits no event.

## Events

- A plugin emits `{ scope, sessionId | projectId, name, data, note? }` (`PluginEventInput`): a module through `host.emit`, an external plugin as a `telar/event` notification. A refused event from a child process is written to its `log.txt`, since a notification has no answer.
- Events are gated like routes: the plugin must be on for that session's or that project's project.
- A session event is journaled as `plugin.event`, and a `note` on it becomes a transcript row. Project and machine events are live only.
- All of them travel whole on `/v2/sessions/stream`. The cockpit listens with `usePluginEvents`. There is no replay, so a view reads its state on mount and treats events only as a cue to read again.

## Composer extensions

- A decoration is a regular expression plus a style from a fixed set. It is matched one line at a time, or across the whole draft when `multiline` is set. It never matches inside code, links or chips, or where it would touch a word character. Earlier decorations win an overlap. Its preview is KaTeX or a session route's `{ text }`.
- `/name words` on the caret's line runs on Enter instead of sending. It posts `{ text }` to the command's session route, and the answer's `text` replaces the line as one undo step. Typed alone, the command takes the rest of the draft as its input and replaces the whole draft.
- Commands need a session, so a fresh canvas shows the decorations but not the commands.

## One-shot completion

- `host.complete()` lends a module plugin one short answer from the text generation policy's provider and cheap model, with no tools and no session. An installed plugin asks for the same thing by sending the engine a `telar/complete` request over stdio, and gets the same answer and errors.
- It is bounded by an 8,000-character prompt, a 4,000-character answer (at most 16,000 on request), a 30 s timeout (at most 60 s) that kills the child, and two calls in flight per plugin.
- These runs leave no provider transcript, so their cost is appended to `usage-one-shot.jsonl`, which the usage report merges. Only Claude reports tokens today.

## Gating

- A plugin runs only when the Mac allows it **and** the project enabled it. An unset machine entry counts as allowed.
- Routes refuse when the plugin is off. The exception is routes marked `beforeEnable`, which the settings panes need before the plugin is turned on.
- A bad manifest is refused and listed as failed with its reason. The engine still starts.
- A manifest plugin's tools are never treated as read-only; they always go through approvals.

## Not built yet

- Plugins that replace whole regions of the UI (the sidebar, the transcript).
- File viewers, which only Data Science has.
- Style plugins.
- Third-party sandboxing and signing.
