import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { loadClientId } from "./client-id";
import type { ThisDevice } from "./pairing";

const store = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
};

let clientId: Promise<string> | undefined;

export async function thisDevice(): Promise<ThisDevice> {
  clientId ??= loadClientId(store);
  const id = await clientId.catch(() => {
    clientId = undefined;
    return undefined;
  });
  return { name: Device.deviceName ?? undefined, tablet: Device.deviceType === Device.DeviceType.TABLET, ...(id ? { clientId: id } : {}) };
}
