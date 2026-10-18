import type http from "node:http";
import type { DeviceRole, DeviceScope } from "@telar/engine-client";

export type Caller = { host: boolean; device?: { id: string; scopes: DeviceScope[]; role: DeviceRole } };

const callers = new WeakMap<http.IncomingMessage, Caller>();

export const setCaller = (request: http.IncomingMessage, caller: Caller): void => void callers.set(request, caller);

export const callerOf = (request: http.IncomingMessage): Caller => callers.get(request) ?? { host: false };
