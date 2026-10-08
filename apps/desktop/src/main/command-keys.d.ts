// Types for command-keys.js, which apps/web imports; apps/desktop has no tsconfig of its own.

export type CommandKeyEventLike = {
  key: string;
  /** The physical key. Present on every real KeyboardEvent; optional so a test
   *  may hand in a plain object with only `key`. */
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type CommandMenu = "file" | "panel" | "view" | "window";

export type Command = {
  id: string;
  label: string;
  /** What a TOGGLE is called when pressing it would undo itself. See the
   *  registry's typedef: `label` stays the command's name everywhere the
   *  state is not known. */
  altLabel?: string;
  group: string;
  /** A lucide icon NAME, resolved to a component by the web's one map in
   *  `lib/command-icons.ts`. A string and not a glyph because this table is
   *  required by Electron's main process and may not import React; the menu
   *  builder and the keybindings pane both ignore it. */
  icon: string;
  defaultChord: string;
  menu?: CommandMenu;
  jump?: number;
  global?: boolean;
};

/** A command id → its chord. "" means deliberately unbound. */
export type Keymap = Record<string, string>;

export const COMMANDS: Command[];

export function normalizeChord(chord: string): string;
export function defaultKeymap(): Keymap;
export function mergeKeymap(overrides: Readonly<Keymap> | undefined | null): Keymap;
export function keymapOverrides(keymap: Readonly<Keymap>): Keymap;
export function keymapConflicts(keymap: Readonly<Keymap>): Record<string, string[]>;
export function chordForEvent(event: CommandKeyEventLike): string;
export function resolveCommandForEvent(keymap: Readonly<Keymap>, event: CommandKeyEventLike): string | null;
/** Which commands a surface's chord claim suppresses under this keymap.
 *  Computed against the LIVE chords, so a rebind hands the chord back. */
export function claimedCommandIds(keymap: Readonly<Keymap>, chords: readonly string[] | undefined): string[];
export function menuCommands(keymap: Readonly<Keymap>, menu: CommandMenu): (Command & { accelerator: string })[];
