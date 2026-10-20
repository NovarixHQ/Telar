"use strict";

const QUICK_COMPOSER_FLAG = "--quick-composer";

function asksForQuickComposer(argv) {
  return Array.isArray(argv) && argv.includes(QUICK_COMPOSER_FLAG);
}

/** The command a desktop shortcut runs to open the Quick Composer; Linux only, where an AppImage is run by its own path. */
function quickComposerCommand({ platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  if (platform !== "linux") return undefined;
  const program = env.APPIMAGE || execPath;
  return `${/\s/.test(program) ? `"${program}"` : program} ${QUICK_COMPOSER_FLAG}`;
}

module.exports = { asksForQuickComposer, quickComposerCommand };
