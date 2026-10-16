const QUIT = 0;
const CANCEL = 1;
const QUIT_ALWAYS = 2;

function quitDialog(count, resume) {
  return {
    type: "warning",
    message: count === 1 ? "Quit Telar while a session is still working?" : `Quit Telar while ${count} sessions are still working?`,
    buttons: ["Quit", "Cancel", "Quit and Don't Ask Again"],
    defaultId: CANCEL,
    cancelId: CANCEL,
    noLink: true,
    checkboxLabel: "Continue this work next time Telar opens",
    checkboxChecked: resume,
  };
}

/**
 * Holds a normal quit while the engine has sessions working and asks first. `bypass` covers quits that must not wait,
 * like an update install; a system logout or shutdown, or a second quit while asking, goes ahead.
 */
function createQuitGate({ ask, confirm, save, bypass = () => false, onCancel = () => {}, power }) {
  let allowed = false;
  let asking = null;
  let systemEnding = false;
  power?.on("shutdown", () => {
    systemEnding = true;
    asking?.abort();
  });

  async function decide(signal) {
    const [count, defaults] = await ask().catch(() => [0, {}]);
    if (signal.aborted || !(count > 0) || defaults?.askBeforeQuit === false) return true;
    const resume = defaults?.resumeAfterRestart === true;
    const { response, checkboxChecked } = await confirm(quitDialog(count, resume), signal);
    if (signal.aborted) return true;
    if (response !== QUIT && response !== QUIT_ALWAYS) return false;
    const patch = {
      ...(checkboxChecked === resume ? {} : { resumeAfterRestart: checkboxChecked }),
      ...(response === QUIT_ALWAYS ? { askBeforeQuit: false } : {}),
    };
    if (Object.keys(patch).length > 0) await save(patch).catch(() => {});
    return true;
  }

  return {
    /** Call from `before-quit`; true while the gate holds this quit, and `quit` is called once it may go ahead. */
    hold(event, quit) {
      if (allowed || systemEnding || bypass()) return false;
      event.preventDefault();
      if (asking) {
        asking.abort();
        return true;
      }
      const controller = new AbortController();
      asking = controller;
      void decide(controller.signal).catch(() => true).then((go) => {
        asking = null;
        if (!go) return onCancel();
        allowed = true;
        quit();
      });
      return true;
    },
    systemEnding: () => systemEnding,
    reset() {
      allowed = false;
    },
  };
}

module.exports = { createQuitGate, QUIT, CANCEL, QUIT_ALWAYS };
