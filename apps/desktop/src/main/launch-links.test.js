const { describe, expect, test } = require("bun:test");
const { EventEmitter } = require("node:events");

const { createLaunchLinks, linkRouteFromArgv } = require("./launch-links");

describe("linkRouteFromArgv", () => {
  test("a .deb launch hands the link after the executable", () => {
    expect(linkRouteFromArgv(["/opt/Telar/telar", "telar://app/projects/p1/sessions/s1"])).toBe("/projects/p1/sessions/s1");
  });

  test("an AppImage launch puts --no-sandbox before the link", () => {
    expect(linkRouteFromArgv(["/tmp/.mount_TelarX/telar", "--no-sandbox", "telar://app/settings"])).toBe("/settings");
  });

  test("a second instance's argv carries Chromium switches and a separator, which are skipped", () => {
    const argv = ["/opt/Telar/telar", "--allow-file-access-from-files", "--ozone-platform-hint=auto", "--", "telar://app/usage?range=7d#top"];
    expect(linkRouteFromArgv(argv)).toBe("/usage?range=7d#top");
  });

  test("a dev launch's app path is not mistaken for a link", () => {
    expect(linkRouteFromArgv(["/usr/bin/electron", ".", "telar://app/"])).toBe("/");
  });

  test("the host is matched without regard to case, and a bare host opens the cockpit's root", () => {
    expect(linkRouteFromArgv(["telar", "telar://APP/settings"])).toBe("/settings");
    expect(linkRouteFromArgv(["telar", "telar://app"])).toBe("/");
  });

  test("no link, another host, another scheme or a protocol-relative path yields nothing", () => {
    expect(linkRouteFromArgv(["/opt/Telar/telar", "--no-sandbox"])).toBeNull();
    expect(linkRouteFromArgv(["telar", "telar://pair?link=x"])).toBeNull();
    expect(linkRouteFromArgv(["telar", "https://app/settings"])).toBeNull();
    expect(linkRouteFromArgv(["telar", "telar://app//evil.example/x"])).toBeNull();
    expect(linkRouteFromArgv(["telar", "--url=telar://app/settings"])).toBeNull();
    expect(linkRouteFromArgv(undefined)).toBeNull();
  });
});

function loadingContents() {
  const contents = new EventEmitter();
  contents.loading = true;
  contents.isLoading = () => contents.loading;
  contents.finish = () => {
    contents.loading = false;
    contents.emit("did-finish-load");
  };
  return contents;
}

describe("createLaunchLinks", () => {
  test("a cold-start link waits for the cockpit to load, then opens once", () => {
    const opened = [];
    const links = createLaunchLinks((route) => opened.push(route));
    expect(links.take(["/opt/Telar/telar", "telar://app/settings"])).toBe(true);
    const contents = loadingContents();
    links.loaded(contents);
    expect(opened).toEqual([]);
    contents.finish();
    expect(opened).toEqual(["/settings"]);
    contents.finish();
    expect(opened).toEqual(["/settings"]);
  });

  test("a link from a second instance during startup replaces the one still waiting", () => {
    const opened = [];
    const links = createLaunchLinks((route) => opened.push(route));
    links.take(["telar", "telar://app/settings"]);
    links.take(["telar", "telar://app/usage"]);
    const contents = loadingContents();
    links.loaded(contents);
    contents.finish();
    expect(opened).toEqual(["/usage"]);
  });

  test("once the cockpit has loaded, a second instance's link opens at once", () => {
    const opened = [];
    const links = createLaunchLinks((route) => opened.push(route));
    const contents = loadingContents();
    contents.loading = false;
    links.loaded(contents);
    expect(links.take(["telar", "telar://app/projects/p1"])).toBe(true);
    expect(opened).toEqual(["/projects/p1"]);
  });

  test("an argv without a link is not taken, so the caller just focuses the window", () => {
    const opened = [];
    const links = createLaunchLinks((route) => opened.push(route));
    expect(links.take(["/opt/Telar/telar", "--no-sandbox"])).toBe(false);
    links.loaded({ isLoading: () => false });
    expect(opened).toEqual([]);
  });
});
