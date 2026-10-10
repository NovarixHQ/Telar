import type { PluginStatus } from "@telar/engine-client";

/** Data Science as the engine lists it, with the viewers it declares. */
export const DATA_SCIENCE_STATUS: PluginStatus = {
  meta: {
    id: "data-science",
    api: 1,
    name: "Data science",
    version: "1.0.0",
    toolPrefixes: ["ds", "notebook"],
    readTools: [],
    eventKinds: [],
    settings: [],
    viewers: [
      { id: "notebook", label: "Notebook", entry: "notebook.html", extensions: [".ipynb"], mimes: [] },
      { id: "table", label: "Table", entry: "table.html", extensions: [".csv", ".tsv", ".parquet"], mimes: [] },
    ],
  },
  state: "ready",
};
