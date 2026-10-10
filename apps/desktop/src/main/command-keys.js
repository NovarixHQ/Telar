"use strict";

const COMMANDS = [
  { id: "new-conversation", label: "New session", group: "Session", icon: "message-square-plus", defaultChord: "CommandOrControl+N", menu: "file" },

  { id: "new-conversation-in", label: "New session in…", group: "Session", icon: "messages-square", defaultChord: "" },
  { id: "new-tab", label: "New tab", group: "Session", icon: "square-plus", defaultChord: "CommandOrControl+T", menu: "file" },
  { id: "new-window", label: "New window", group: "Session", icon: "app-window", defaultChord: "CommandOrControl+Shift+N", menu: "file" },
  { id: "focus-composer", label: "Focus composer", group: "Session", icon: "text-cursor", defaultChord: "CommandOrControl+L" },
  { id: "send", label: "Send", group: "Session", icon: "send", defaultChord: "CommandOrControl+Return" },
  { id: "stop-turn", label: "Stop turn", group: "Session", icon: "square", defaultChord: "CommandOrControl+." },

  { id: "toggle-dictation", label: "Dictate", group: "Session", icon: "mic", defaultChord: "CommandOrControl+D" },

  { id: "open-in-app", label: "Open in preferred app", group: "Session", icon: "external-link", defaultChord: "CommandOrControl+O", menu: "file" },
  { id: "reveal-in-finder", label: "Reveal in Finder", group: "Session", icon: "folder-open", defaultChord: "CommandOrControl+Alt+O", menu: "file" },

  { id: "toggle-workspace", label: "Toggle workspace", group: "Session", icon: "folder-git-2", defaultChord: "CommandOrControl+Alt+W" },

  { id: "pin-session", label: "Pin session", altLabel: "Unpin session", group: "Session", icon: "pin", defaultChord: "CommandOrControl+P", menu: "file" },

  { id: "search-sessions", label: "Command palette", group: "Rail", icon: "search", defaultChord: "CommandOrControl+K" },

  { id: "add-project", label: "Add project…", group: "Rail", icon: "folder-plus", defaultChord: "" },
  { id: "toggle-rail", label: "Toggle rail", group: "Rail", icon: "panel-left", defaultChord: "CommandOrControl+B" },

  ...Array.from({ length: 9 }, (_, index) => {
    const n = index + 1;
    return {
      id: `jump-${n}`,
      label: `Jump to ${n}`,
      group: "Rail",

      icon: "hash",
      defaultChord: `CommandOrControl+${n}`,
      menu: "file",
      jump: n,
    };
  }),
  { id: "previous-session", label: "Previous Session", group: "Rail", icon: "arrow-up", defaultChord: "CommandOrControl+Shift+[" },
  { id: "next-session", label: "Next Session", group: "Rail", icon: "arrow-down", defaultChord: "CommandOrControl+Shift+]" },

  { id: "toggle-panel", label: "Toggle right panel", group: "Panel", icon: "panel-right", defaultChord: "CommandOrControl+\\", menu: "panel" },
  { id: "panel-next-tab", label: "Next panel tab", group: "Panel", icon: "arrow-right", defaultChord: "CommandOrControl+Alt+Right", menu: "panel" },
  { id: "panel-previous-tab", label: "Previous panel tab", group: "Panel", icon: "arrow-left", defaultChord: "CommandOrControl+Alt+Left", menu: "panel" },
  { id: "panel-fullscreen", label: "Fill the window", group: "Panel", icon: "maximize", defaultChord: "CommandOrControl+Alt+F", menu: "panel" },
  { id: "open-browser", label: "Open browser", group: "Panel", icon: "globe", defaultChord: "CommandOrControl+Shift+B", menu: "panel" },
  { id: "open-terminal", label: "Open terminal", group: "Panel", icon: "square-terminal", defaultChord: "CommandOrControl+Shift+T", menu: "panel" },
  { id: "open-diff", label: "Open diff", group: "Panel", icon: "git-compare", defaultChord: "CommandOrControl+Shift+D", menu: "panel" },
  { id: "open-editor", label: "Open editor", group: "Panel", icon: "file-code", defaultChord: "CommandOrControl+Shift+E", menu: "panel" },
  { id: "open-simulator", label: "Open simulator", group: "Panel", icon: "smartphone", defaultChord: "CommandOrControl+Shift+S", menu: "panel" },
  { id: "open-issues", label: "Open issues", group: "Panel", icon: "circle-dot", defaultChord: "CommandOrControl+Shift+I", menu: "panel" },
  { id: "open-pulls", label: "Open pull requests", group: "Panel", icon: "git-pull-request", defaultChord: "CommandOrControl+Shift+U", menu: "panel" },
  { id: "open-data", label: "Open data", group: "Panel", icon: "table", defaultChord: "CommandOrControl+Shift+A", menu: "panel" },
  { id: "open-plugin-panels", label: "Open plugin panels", group: "Panel", icon: "blocks", defaultChord: "CommandOrControl+Shift+X", menu: "panel" },

  { id: "float-browser", label: "Float browser on top", group: "Panel", icon: "picture-in-picture-2", defaultChord: "CommandOrControl+Alt+P", menu: "window" },

  { id: "toggle-devtools", label: "Developer tools", group: "Panel", icon: "bug", defaultChord: "CommandOrControl+Alt+I", menu: "view" },

  { id: "go-to-file", label: "Go to file…", group: "Panel", icon: "file-search", defaultChord: "CommandOrControl+Shift+P" },

  { id: "search-project-contents", label: "Search in project…", group: "Panel", icon: "text-search", defaultChord: "CommandOrControl+Shift+F" },

  { id: "quick-composer", label: "Quick composer", group: "Application", icon: "square-pen", defaultChord: "Alt+Shift+Space", global: true },
  { id: "settings", label: "Settings…", group: "Application", icon: "settings", defaultChord: "CommandOrControl+,", menu: "file" },
  { id: "search-settings", label: "Search settings…", group: "Application", icon: "settings-2", defaultChord: "CommandOrControl+Shift+,", menu: "file" },

  { id: "appearance", label: "Appearance…", group: "Application", icon: "palette", defaultChord: "" },

  { id: "project-settings", label: "Project settings…", group: "Application", icon: "folder-cog", defaultChord: "" },
  { id: "open-usage", label: "Usage…", group: "Application", icon: "gauge", defaultChord: "" },
  { id: "open-plugins", label: "Plugins…", group: "Application", icon: "puzzle", defaultChord: "" },
  { id: "check-for-updates", label: "Check for updates…", group: "Application", icon: "refresh-cw", defaultChord: "" },
];

const MODIFIER_ORDER = ["CommandOrControl", "Alt", "Shift"];

const MODIFIER_ALIASES = {
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  command: "CommandOrControl",
  cmd: "CommandOrControl",
  meta: "CommandOrControl",
  super: "CommandOrControl",
  control: "CommandOrControl",
  ctrl: "CommandOrControl",
  alt: "Alt",
  option: "Alt",
  altgr: "Alt",
  shift: "Shift",
};

const KEY_ALIASES = {
  enter: "Return",
  return: "Return",
  numpadenter: "Return",
  esc: "Escape",
  escape: "Escape",
  " ": "Space",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  backquote: "`",
  minus: "-",
  equal: "=",
  semicolon: ";",
  quote: "'",
  bracketleft: "[",
  bracketright: "]",
};

function normalizeKeyToken(token) {
  if (typeof token !== "string" || token === "") return "";
  const lower = token.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  const digit = /^digit([0-9])$/.exec(lower);
  if (digit) return digit[1];
  const letter = /^key([a-z])$/.exec(lower);
  if (letter) return letter[1].toUpperCase();
  const numpad = /^numpad([0-9])$/.exec(lower);
  if (numpad) return numpad[1];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  return token.length === 1 ? token.toUpperCase() : token;
}

function isModifierKey(token) {
  const lower = String(token ?? "").toLowerCase();
  return lower === "meta" || lower === "control" || lower === "shift" || lower === "alt" || lower === "altgraph" || lower === "os";
}

function normalizeChord(chord) {
  if (typeof chord !== "string") return "";
  const parts = chord
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return "";
  const modifiers = new Set();
  let key = "";
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }

    key = normalizeKeyToken(part);
  }
  if (key === "") return "";
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function defaultKeymap() {
  const keymap = {};
  for (const command of COMMANDS) keymap[command.id] = normalizeChord(command.defaultChord);
  return keymap;
}

function mergeKeymap(overrides) {
  const keymap = defaultKeymap();
  if (!overrides || typeof overrides !== "object") return keymap;
  for (const command of COMMANDS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, command.id)) continue;
    const stored = overrides[command.id];

    if (typeof stored !== "string") continue;
    keymap[command.id] = normalizeChord(stored);
  }
  return keymap;
}

function keymapOverrides(keymap) {
  const defaults = defaultKeymap();
  const overrides = {};
  for (const command of COMMANDS) {
    const chord = normalizeChord(keymap?.[command.id] ?? defaults[command.id]);
    if (chord !== defaults[command.id]) overrides[command.id] = chord;
  }
  return overrides;
}

function keymapConflicts(keymap) {
  const byChord = new Map();
  for (const command of COMMANDS) {
    const chord = normalizeChord(keymap?.[command.id]);
    if (chord === "") continue;
    const sharing = byChord.get(chord) ?? [];
    sharing.push(command.id);
    byChord.set(chord, sharing);
  }
  const conflicts = {};
  for (const sharing of byChord.values()) {
    if (sharing.length < 2) continue;
    for (const id of sharing) conflicts[id] = sharing.filter((other) => other !== id);
  }
  return conflicts;
}

function chordsForEvent(event) {
  if (!event || isModifierKey(event.key)) return [];
  const modifiers = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  const tokens = [];
  for (const raw of [event.key, event.code]) {
    const token = normalizeKeyToken(typeof raw === "string" ? raw : "");
    if (token !== "" && !tokens.includes(token)) tokens.push(token);
  }
  return tokens.map((token) => [...MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier)), token].join("+"));
}

function chordForEvent(event) {
  const candidates = chordsForEvent(event);
  return candidates[candidates.length - 1] ?? "";
}

function resolveCommandForEvent(keymap, event) {
  const candidates = chordsForEvent(event);
  if (candidates.length === 0) return null;
  for (const command of COMMANDS) {
    const chord = normalizeChord(keymap?.[command.id]);
    if (chord !== "" && candidates.includes(chord)) return command.id;
  }
  return null;
}

function claimedCommandIds(keymap, chords) {
  const claimed = new Set();
  for (const chord of chords ?? []) {
    const normalized = normalizeChord(chord);
    if (normalized !== "") claimed.add(normalized);
  }
  if (claimed.size === 0) return [];
  const ids = [];
  for (const command of COMMANDS) {
    const chord = normalizeChord(keymap?.[command.id]);
    if (chord !== "" && claimed.has(chord)) ids.push(command.id);
  }
  return ids;
}

function menuCommands(keymap, menu) {
  return COMMANDS.filter((command) => command.menu === menu).map((command) => ({
    ...command,
    accelerator: normalizeChord(keymap?.[command.id]),
  }));
}

module.exports = {
  COMMANDS,
  chordForEvent,
  claimedCommandIds,
  defaultKeymap,
  keymapConflicts,
  keymapOverrides,
  menuCommands,
  mergeKeymap,
  normalizeChord,
  resolveCommandForEvent,
};
