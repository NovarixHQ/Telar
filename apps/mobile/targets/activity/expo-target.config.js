/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "TelarActivity",
  displayName: "Telar Activity",
  bundleIdentifier: ".activity",
  deploymentTarget: "18.0",
  frameworks: ["ActivityKit", "SwiftUI", "WidgetKit"],
};
