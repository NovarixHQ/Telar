import * as Device from "expo-device";
import type { ThisDevice } from "./pairing";

export const thisDevice = (): ThisDevice => ({ name: Device.deviceName ?? undefined, tablet: Device.deviceType === Device.DeviceType.TABLET });
