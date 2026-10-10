import { describe, expect, test } from "bun:test";
import { isPluginSurface, pluginSurfaces, viewerAvailable } from "./registry";
import { panelTabForPath } from "@/features/panel";
import { editorFileForPath } from "@/features/files/editor-workspace";
import { defaultRightPanelWidth } from "@/features/panel";

describe("the web plugin registry, gated by the enabled ids", () => {
  test("Data Science contributes its tab only while on; LaTeX has none of its own", () => {
    expect(pluginSurfaces([]).map((surface) => surface.id)).toEqual([]);
    expect(pluginSurfaces(["data-science"]).map((surface) => surface.id)).toEqual(["data"]);
    expect(pluginSurfaces(["latex", "data-science"]).map((surface) => surface.id)).toEqual(["data"]);
    expect(pluginSurfaces(["latex"], true).map((surface) => surface.command)).toEqual(["open-plugin-panels"]);
  });

  test("a plugin with no web contributions draws nothing and breaks nothing", () => {
    // The proof plugin: enabled, known to the engine, and invisible here.
    expect(pluginSurfaces(["hello"])).toEqual([]);
    expect(panelTabForPath("analysis.ipynb", ["hello"])).toBe("file:analysis.ipynb");
    expect(editorFileForPath("data.csv", ["hello"]).view).toBe("code");
  });

  test("a plugin's viewers are gated; the PDF viewer is core", () => {
    expect(viewerAvailable("notebook", [])).toBe(false);
    expect(viewerAvailable("notebook", ["data-science"])).toBe(true);
    expect(viewerAvailable("table", ["latex"])).toBe(false);
    expect(viewerAvailable("pdf", [])).toBe(true);
    expect(panelTabForPath("paper.pdf", [])).toBe("pdf:paper.pdf");
  });

  test("a restored plugin tab still validates with the plugin off", () => {
    expect(isPluginSurface("data")).toBe(true);
    expect(isPluginSurface("plugin-panels")).toBe(true);
    expect(isPluginSurface("diff")).toBe(false);
  });

  test("a wide plugin surface widens the panel's default, as Data always did", () => {
    expect(defaultRightPanelWidth([{ kind: "data" }])).toBe(720);
    expect(defaultRightPanelWidth([{ kind: "plugin-panels" }])).toBe(480);
  });
});
