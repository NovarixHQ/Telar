// A .deb is updated by the package manager; only the AppImage and the macOS app update themselves.
function updateMode({ platform = process.platform, env = process.env } = {}) {
  if (platform !== "linux") return "app";
  return env.APPIMAGE ? "appimage" : "package";
}

module.exports = { updateMode };
