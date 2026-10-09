const { jsonPrefs } = require("./prefs");

const prefs = jsonPrefs(
  "notification-prefs.json",
  { enabled: true },
  (raw) => ({ enabled: typeof raw?.enabled === "boolean" ? raw.enabled : true }),
  "notification prefs",
);

module.exports = { readNotificationPrefs: prefs.read, writeNotificationPrefs: prefs.write };
