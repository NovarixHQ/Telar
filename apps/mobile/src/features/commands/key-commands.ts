import type { KeyModifier, NativeKeyCommand } from "../../../modules/key-commands";

/** The Swift app's hardware shortcuts, with the same keys and the titles its ⌘-hold overlay lists. */
const KEY_COMMANDS = {
  newSession: { input: "n", modifiers: ["command"], title: "New conversation" },
  settings: { input: ",", modifiers: ["command"], title: "Settings" },
  togglePanel: { input: "i", modifiers: ["command", "option"], title: "Show panel" },
  leaveFullScreen: { input: "escape", modifiers: [] },
} satisfies Record<string, { input: string; modifiers: KeyModifier[]; title?: string }>;

export type KeyCommandId = keyof typeof KEY_COMMANDS;

type Binding = { id: KeyCommandId; run: () => void; title?: string };

/** Commands bound by mounted screens; the latest binding of an id wins until it unbinds. */
export function createKeyCommands(apply: (commands: NativeKeyCommand[]) => void) {
  const bindings = new Map<object, Binding>();
  const winners = () => {
    const byId = new Map<KeyCommandId, Binding>();
    for (const binding of bindings.values()) byId.set(binding.id, binding);
    return byId;
  };
  const publish = () =>
    apply(
      [...winners().values()].map(({ id, title }) => {
        const { input, modifiers, ...entry } = KEY_COMMANDS[id];
        const shown = title ?? ("title" in entry ? entry.title : undefined);
        return { id, input, modifiers: [...modifiers], ...(shown ? { title: shown } : {}) };
      }),
    );
  return {
    bind(owner: object, binding: Binding) {
      bindings.set(owner, binding);
      publish();
    },
    unbind(owner: object) {
      if (bindings.delete(owner)) publish();
    },
    dispatch(id: string) {
      winners().get(id as KeyCommandId)?.run();
    },
  };
}
