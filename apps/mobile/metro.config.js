const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// MathJax reaches its font through a package.json "imports" alias (#default-font/*), which Metro doesn't resolve.
const FONT_ALIAS = "#default-font/";
config.resolver.resolveRequest = (context, name, platform) =>
  context.resolveRequest(context, name.startsWith(FONT_ALIAS) ? `@mathjax/mathjax-newcm-font/mjs/${name.slice(FONT_ALIAS.length)}` : name, platform);

module.exports = config;
