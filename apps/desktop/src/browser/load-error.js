const ERR_ABORTED = -3;

/** The page state a failed main-frame load leaves behind, or null for a load that was only superseded or stopped. */
function pageLoadError(errno, code, url) {
  if (typeof errno !== "number" || errno >= 0 || errno === ERR_ABORTED) return null;
  return { errno, code: /^ERR_[A-Z_]+$/.test(code || "") ? code : "ERR_FAILED", url: url || "" };
}

/** A rejection from loading a page, as opposed to a failure of the action itself. */
function isLoadFailure(error) {
  return typeof error?.errno === "number" && error.errno < 0;
}

module.exports = { isLoadFailure, pageLoadError };
