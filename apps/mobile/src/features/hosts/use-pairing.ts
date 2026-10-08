import * as Device from "expo-device";
import { useState } from "react";
import { pair, type PairedHost } from "./pairing";
import { rememberHost } from "./registry";
import { thisDevice } from "./this-device";

/** The simulator has no camera, so it offers the pasted link first, as Swift does. */
export const cameraUsable = (): boolean => Device.isDevice;

/** Spends a pairing link for this phone and remembers the computer; the error is what the screen's banner says. */
export function usePairing() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (link: string): Promise<PairedHost | undefined> => {
    setBusy(true);
    const outcome = await pair(link, thisDevice());
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return undefined;
    }
    await rememberHost(outcome.host);
    setError(undefined);
    return outcome.host;
  };
  return { busy, error, setError, pair: run };
}
