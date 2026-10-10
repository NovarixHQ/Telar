import { ARTIFACT_BASE_CSS, PluginAssetPath, VIEW_SDK_SOURCE } from "@telar/engine-client";

/** No `allow-same-origin`: the frame's origin is opaque, so it holds no cookie, storage or route of the cockpit's. */
export const VIEW_SANDBOX = "allow-scripts";

const SDK_NAME = "telar-view.js";

const viewCsp = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;

export function newNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const ORIGIN = "https://plugin.invalid/";

/** A reference from `entry` to another file of the same `views/` folder, or `undefined` for anything else. */
export function assetReference(entry: string, reference: string): string | undefined {
  let url: URL;
  try {
    url = new URL(reference, ORIGIN + entry);
  } catch {
    return undefined;
  }
  if (url.origin + "/" !== ORIGIN || url.search || url.hash) return undefined;
  const asset = decodeURIComponent(url.pathname.slice(1));
  return PluginAssetPath.safeParse(asset).success ? asset : undefined;
}

/**
 * The frame's whole document: the plugin's page with its own scripts and stylesheets inlined, every script it ships
 * carrying the nonce, under a CSP that runs nothing else. The SDK loads first as `window.telar`.
 */
export async function viewDocument(entry: string, html: string, load: (asset: string) => Promise<string>, nonce: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const meta of doc.querySelectorAll('meta[http-equiv], base')) meta.remove();
  for (const script of doc.querySelectorAll("script")) {
    const src = script.getAttribute("src");
    if (src === null) {
      script.setAttribute("nonce", nonce);
      continue;
    }
    const asset = assetReference(entry, src);
    if (!asset || asset === SDK_NAME) {
      script.remove();
      continue;
    }
    const inline = doc.createElement("script");
    inline.setAttribute("nonce", nonce);
    if (script.getAttribute("type") === "module") inline.setAttribute("type", "module");
    inline.textContent = (await load(asset)).replaceAll("</script", "<\\/script");
    script.replaceWith(inline);
  }
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"]')) {
    const asset = assetReference(entry, link.getAttribute("href") ?? "");
    if (!asset) {
      link.remove();
      continue;
    }
    const style = doc.createElement("style");
    style.textContent = (await load(asset)).replaceAll("</style", "<\\/style");
    link.replaceWith(style);
  }
  for (const link of doc.querySelectorAll("link")) link.remove();
  const head = doc.head;
  const sdk = doc.createElement("script");
  sdk.setAttribute("nonce", nonce);
  sdk.textContent = VIEW_SDK_SOURCE;
  const base = doc.createElement("style");
  base.textContent = ARTIFACT_BASE_CSS;
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", viewCsp(nonce));
  head.prepend(policy, charset, base, sdk);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
