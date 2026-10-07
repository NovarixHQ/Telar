const MAIN_WINDOW_ID = "main";
const SESSION_KEY = "telar:window-id";

// Client routing drops `?w=`, so sessionStorage, which a reload keeps, holds the id after the first read.
function windowId(): string {
  if (typeof window === "undefined") return MAIN_WINDOW_ID;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("w");
    if (!fromUrl) return window.sessionStorage.getItem(SESSION_KEY) || MAIN_WINDOW_ID;
    if (window.sessionStorage.getItem(SESSION_KEY) !== fromUrl) window.sessionStorage.setItem(SESSION_KEY, fromUrl);
    return fromUrl;
  } catch {
    return MAIN_WINDOW_ID;
  }
}

/** Scopes a layout key to this desktop window. The main window, a browser and the phone keep the bare key. */
export function windowLayoutKey(key: string): string {
  const id = windowId();
  return id === MAIN_WINDOW_ID ? key : `${key}@${id}`;
}
