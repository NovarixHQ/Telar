const ERR_ABORTED = -3;

function pageLoadError(errno, code, url) {
  if (typeof errno !== "number" || errno >= 0 || errno === ERR_ABORTED) return null;
  return { errno, code: /^ERR_[A-Z_]+$/.test(code || "") ? code : "ERR_FAILED", url: url || "" };
}

function isLoadFailure(error) {
  return typeof error?.errno === "number" && error.errno < 0;
}

module.exports = { isLoadFailure, pageLoadError };
