import { EngineClientError } from "@telar/engine-client";
import { useCallback, useEffect, useState } from "react";
import type { HostConnection } from "../../platform/connection";
import { hosts } from "../hosts";

export function failureText(error: unknown): string {
  if (error instanceof EngineClientError || error instanceof Error) return error.message;
  return String(error);
}

/** Loads something from one computer, with a reload for pull-to-refresh and after each change. */
export function useHostLoad<T>(hostId: string, load: (host: HostConnection) => Promise<T>) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    const host = hosts.get(hostId);
    if (!host) return setError("This computer is not paired.");
    try {
      setValue(await load(host));
      setError(undefined);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [hostId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { value, error, setError, reload, host: hosts.get(hostId) };
}
