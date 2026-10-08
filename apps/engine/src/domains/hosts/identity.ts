import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EngineIdentity } from "@telar/engine-client";
import { ok, type Route } from "../../platform/http/route";

const HOST_ID = /^host_[0-9a-f-]{36}$/;

export function readHostId(dir: string): string {
  const file = path.join(dir, "host-id");
  try {
    const stored = fs.readFileSync(file, "utf8").trim();
    if (HOST_ID.test(stored)) return stored;
  } catch {}
  const hostId = `host_${crypto.randomUUID()}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, hostId, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return hostId;
}

export function identityRoutes(identity: EngineIdentity): Route[] {
  return [{ method: "GET", path: "/v2/identity", auth: "engine", handle: () => ok(identity) }];
}
