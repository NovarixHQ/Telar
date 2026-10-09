const fs = require("node:fs");
const path = require("node:path");

function siteSlug(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "page";
  } catch {
    return "page";
  }
}

module.exports = {
  async saveScreenshot(scopeKey, options = {}) {
    const shot = await this.capture(scopeKey, { fullPage: Boolean(options.fullPage) });
    const directory = this.screenshotsPath();
    const file = path.join(directory, `screenshot-${siteSlug(shot.url)}-${this.now().toString(36)}.png`);
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(file, Buffer.from(shot.data, "base64"));
    return { path: file, url: shot.url };
  },

  // Only files this manager saved can be read back, so a renderer cannot use it to read arbitrary paths.
  copyScreenshot(file) {
    const resolved = path.resolve(String(file || ""));
    if (path.dirname(resolved) !== path.resolve(this.screenshotsPath())) throw new Error("That file is not a browser screenshot.");
    const { clipboard, nativeImage } = this.electron();
    const image = nativeImage.createFromPath(resolved);
    if (image.isEmpty()) throw new Error("That screenshot is no longer on this machine.");
    clipboard.writeImage(image);
    return { ok: true };
  },
};
