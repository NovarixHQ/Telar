const { requestEngine } = require("./engine-child");

const clip = (text, max) => {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const busy = (terminals) => (Array.isArray(terminals) ? terminals : []).filter((terminal) => terminal && terminal.active);

function decideQuit(terminals) {
  const list = Array.isArray(terminals) ? terminals : [];
  const running = busy(list);
  if (running.length === 0) return { action: "quit", closing: list.length };
  const shown = running.slice(0, 5).map((terminal) => `• ${clip(terminal.command || "a command", 80)}`);
  if (running.length > shown.length) shown.push(`…and ${running.length - shown.length} more`);
  return {
    action: "confirm",
    count: running.length,
    closing: list.length,
    dialog: {
      type: "warning",
      message: running.length === 1 ? "1 process is still running in Telar's terminals" : `${running.length} processes are still running in Telar's terminals`,
      detail: `${shown.join("\n")}\n\nQuitting Telar closes its terminals and ends everything running in them. Work they have not saved or finished will be lost.`,
      buttons: ["End them and quit", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    },
  };
}

function busyTerminals(terminals) {
  const running = busy(terminals);
  return { count: running.length, commands: running.slice(0, 5).map((terminal) => clip(terminal.command || "a command", 80)) };
}

async function heldTerminals(home) {
  try {
    const answer = await requestEngine(home, "POST", "/v2/terminals/active", {});
    return Array.isArray(answer?.terminals) ? answer.terminals : [];
  } catch {
    return [];
  }
}

module.exports = { busyTerminals, decideQuit, heldTerminals };
