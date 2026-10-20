function updateMode({ platform = process.platform, env = process.env } = {}) {
  if (platform !== "linux") return "app";
  return env.APPIMAGE ? "appimage" : "package";
}

module.exports = { updateMode };
