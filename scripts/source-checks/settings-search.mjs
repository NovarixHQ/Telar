import fs from "node:fs";
import path from "node:path";
import { INDEX_FILE, renderIndexModule } from "../settings-index.mjs";
import { ROOT } from "./files.mjs";

export const settingsSearchCheck = {
  name: "settings-search-is-generated",
  protects: "the settings search index is the one scripts/settings-index.mjs writes from the rows the panes render",
  run() {
    const committed = fs.readFileSync(path.join(ROOT, INDEX_FILE), "utf8");
    return committed === renderIndexModule() ? [] : [`${INDEX_FILE} is stale: run \`bun scripts/settings-index.mjs\``];
  },
};
