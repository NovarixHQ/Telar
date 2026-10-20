const { APP_URL } = require("./cockpit-scheme");

const APP = new URL(APP_URL);

function routeFromLink(arg) {
  let url;
  try {
    url = new URL(arg);
  } catch {
    return null;
  }
  if (url.protocol !== APP.protocol || url.host.toLowerCase() !== APP.host) return null;
  const pathname = url.pathname || "/";
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.startsWith("/\\")) return null;
  return `${pathname}${url.search}${url.hash}`;
}

function linkRouteFromArgv(argv) {
  for (const arg of argv ?? []) {
    if (typeof arg !== "string" || arg.startsWith("-")) continue;
    const route = routeFromLink(arg);
    if (route) return route;
  }
  return null;
}

function createLaunchLinks(open) {
  let pending = null;
  let loaded = false;
  const route = (next) => {
    if (loaded) open(next);
    else pending = next;
  };
  const ready = () => {
    loaded = true;
    const next = pending;
    pending = null;
    if (next) open(next);
  };
  return {
    take(argv) {
      const next = linkRouteFromArgv(argv);
      if (next) route(next);
      return next !== null;
    },
    loaded(webContents) {
      if (webContents.isLoading()) webContents.once("did-finish-load", ready);
      else ready();
    },
  };
}

module.exports = { createLaunchLinks, linkRouteFromArgv };
