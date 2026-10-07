const MAIN_WINDOW_ID = "main";
const SESSION_KEY = "telar:window-id";

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

export function windowLayoutKey(key: string): string {
  const id = windowId();
  return id === MAIN_WINDOW_ID ? key : `${key}@${id}`;
}
