function sandboxOffReason({ platform, packaged, hasSwitch, env }) {
  if (platform !== "linux" || !packaged) return null;
  if (hasSwitch("no-sandbox")) return "--no-sandbox";
  if (env.ELECTRON_DISABLE_SANDBOX) return "ELECTRON_DISABLE_SANDBOX";
  return null;
}

const SANDBOX_REFUSAL_TITLE = "Telar can't start without its sandbox";

function sandboxRefusal(reason) {
  return [
    `Telar was started with ${reason}, which turns off the sandbox that keeps web pages away from your files. Telar does not run that way.`,
    "",
    "This usually means the system blocks the unprivileged user namespaces the sandbox needs (Ubuntu 24.04 and newer do, through AppArmor).",
    "Install the .deb, which allows them for Telar alone, or allow them for the AppImage in your AppArmor settings.",
  ].join("\n");
}

module.exports = { SANDBOX_REFUSAL_TITLE, sandboxOffReason, sandboxRefusal };
