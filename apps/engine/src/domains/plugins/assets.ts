import fs from "node:fs";
import path from "node:path";
import { machineAllows, PluginAssetPath } from "@telar/engine-client";
import { HttpError } from "../../platform/http/http";
import type { Route } from "../../platform/http/route";
import type { PluginHost } from "./host";
import type { EngineStore } from "../../state";

const ASSET_MAX_BYTES = 2 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export function readFolderAsset(dir: string, asset: string): string | undefined {
  if (!PluginAssetPath.safeParse(asset).success) return undefined;
  try {
    const root = fs.realpathSync(path.join(dir, "views"));
    const file = fs.realpathSync(path.join(root, asset));
    if (!file.startsWith(root + path.sep)) return undefined;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > ASSET_MAX_BYTES) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export function pluginAssetRoutes(store: EngineStore, host: PluginHost): Route[] {
  return [
    {
      method: "GET",
      path: /^\/v2\/plugin-assets\/([a-z][a-z0-9-]*)\/(.+)$/,
      auth: "engine",
      handle({ params: [pluginId, encoded] }) {
        const asset = encoded!.split("/").map(decodeURIComponent).join("/");
        const module = host.ready(pluginId!);
        if (!module || !machineAllows(store.toolchains.machine(), pluginId!)) throw new HttpError(404, "not_found", `no plugin ${pluginId}`);
        const text = PluginAssetPath.safeParse(asset).success ? module.assets?.(asset) : undefined;
        if (text === undefined) throw new HttpError(404, "not_found", `plugin ${pluginId} has no asset ${asset}`);
        return {
          status: 200,
          body: undefined,
          bytes: new TextEncoder().encode(text),
          headers: { "content-type": MEDIA_TYPES[path.extname(asset)]!, "cache-control": "no-store", "x-content-type-options": "nosniff" },
        };
      },
    },
  ];
}
