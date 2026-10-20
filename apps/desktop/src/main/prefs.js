const fs = require("node:fs");
const path = require("node:path");

function jsonPrefs(file, defaults, validate, label) {
  const userData = () => require("electron").app.getPath("userData");
  const filePath = () => path.join(userData(), file);
  return {
    path: filePath,
    read() {
      try {
        return validate(JSON.parse(fs.readFileSync(filePath(), "utf8")));
      } catch {
        return defaults && { ...defaults };
      }
    },
    write(value) {
      try {
        fs.mkdirSync(userData(), { recursive: true });
        fs.writeFileSync(filePath(), JSON.stringify(value), "utf8");
      } catch (err) {
        console.error(`[telar-desktop] failed to persist ${label}:`, err.message);
      }
    },
  };
}

module.exports = { jsonPrefs };
