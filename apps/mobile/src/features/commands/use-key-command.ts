import { useEffect, useRef } from "react";
import { keyCommands } from "../../../modules/key-commands";
import { createKeyCommands, type KeyCommandId } from "./key-commands";

const registry = createKeyCommands((commands) => keyCommands?.setCommands(commands));
keyCommands?.addListener("onKeyCommand", ({ id }) => registry.dispatch(id));

/** Binds a hardware shortcut while the caller is mounted and `enabled`; without a hardware keyboard it never fires. */
export function useKeyCommand(id: KeyCommandId, run: () => void, options: { enabled?: boolean; title?: string } = {}) {
  const owner = useRef({}).current;
  const latest = useRef(run);
  latest.current = run;
  const { enabled = true, title } = options;
  useEffect(() => {
    if (enabled) registry.bind(owner, { id, run: () => latest.current(), ...(title ? { title } : {}) });
    else registry.unbind(owner);
  }, [id, enabled, title]);
  useEffect(() => () => registry.unbind(owner), []);
}
