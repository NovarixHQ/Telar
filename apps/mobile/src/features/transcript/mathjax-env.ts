// MathJax sniffs the OS from navigator.appVersion and userAgent, which React Native's navigator lacks.
const shim = globalThis.navigator as { appVersion?: string; userAgent?: string } | undefined;
if (shim) {
  shim.appVersion ??= "";
  shim.userAgent ??= "";
}
