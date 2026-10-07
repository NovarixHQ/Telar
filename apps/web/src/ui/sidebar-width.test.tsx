import { afterEach, describe, expect, test } from "bun:test";
import { installTestDom, mount } from "@/test/dom";
import { setSidebarCollapsed, setSidebarWidth, useSidebarPrefs } from "./sidebar-width";

installTestDom();

function Prefs() {
  const prefs = useSidebarPrefs("rail");
  return <p>{`${prefs.collapsed} ${prefs.width}`}</p>;
}

async function inWindow(search: string) {
  window.history.replaceState(null, "", `/${search}`);
  const { host } = await mount(<Prefs />);
  return host.textContent;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("each desktop window keeps its own layout", () => {
  test("collapsing the rail in one window leaves the other's alone", async () => {
    window.history.replaceState(null, "", "/?w=a");
    setSidebarCollapsed("rail", true);
    setSidebarWidth("rail", 300);
    expect(await inWindow("?w=b")).toBe("null null");
    expect(await inWindow("?w=a")).toBe("true 300");
  });

  test("the main window reads the layout saved before windows had ids", async () => {
    window.localStorage.setItem("telar-sidebar:rail", JSON.stringify({ width: 280, collapsed: true }));
    expect(await inWindow("?w=main")).toBe("true 280");
    expect(await inWindow("")).toBe("true 280");
  });

  test("a window keeps its id after client routing drops it from the address", async () => {
    window.history.replaceState(null, "", "/?w=c");
    setSidebarCollapsed("rail", true);
    expect(await inWindow("projects/p1")).toBe("true null");
    expect(await inWindow("?w=d")).toBe("null null");
  });
});
