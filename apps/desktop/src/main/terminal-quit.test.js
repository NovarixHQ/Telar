const { describe, expect, test } = require("bun:test");
const { busyTerminals, decideQuit } = require("./terminal-quit");

describe("deciding whether quitting has to ask", () => {
  test("nothing active: quit, and say how many idle terminals will close", () => {
    expect(decideQuit([])).toEqual({ action: "quit", closing: 0 });
    expect(decideQuit([{ active: false }, { active: false }])).toEqual({ action: "quit", closing: 2 });
  });

  test("anything active: ONE question, counting only what is running", () => {
    const plan = decideQuit([
      { active: true, command: "bun run dev" },
      { active: false },
      { active: true, command: "pytest -x" },
    ]);
    expect(plan.action).toBe("confirm");
    expect(plan.count).toBe(2);
    expect(plan.closing).toBe(3);
    expect(plan.dialog.message).toBe("2 processes are still running in Telar's terminals");
    expect(plan.dialog.detail).toContain("• bun run dev");
    expect(plan.dialog.detail).toContain("• pytest -x");
    expect(plan.dialog.detail).toContain("ends everything running in them");
    expect(plan.dialog.buttons).toEqual(["End them and quit", "Cancel"]);
    expect(plan.dialog.defaultId).toBe(0);
    expect(plan.dialog.cancelId).toBe(1);
  });

  test("one process reads as one, and a long list is cut with a count", () => {
    expect(decideQuit([{ active: true, command: "x" }]).dialog.message).toBe("1 process is still running in Telar's terminals");
    const many = Array.from({ length: 8 }, (_, index) => ({ active: true, command: `job ${index}` }));
    const detail = decideQuit(many).dialog.detail;
    expect(detail).toContain("• job 4");
    expect(detail).not.toContain("• job 5");
    expect(detail).toContain("…and 3 more");
  });

  test("a command with no name still reads as something", () => {
    expect(decideQuit([{ active: true }]).dialog.detail).toContain("• a command");
  });

  test("names no other product", () => {
    const plan = decideQuit([{ active: true, command: "bun run dev" }]);
    const copy = [plan.dialog.message, plan.dialog.detail.replace("bun run dev", ""), ...plan.dialog.buttons].join(" ");
    expect(copy).not.toMatch(/claude|codex|opencode|electron|node-pty|macos/i);
  });
});

describe("busyTerminals — what the restart-to-update dialog prints", () => {
  test("counts only the busy ones, and names at most five commands", () => {
    expect(busyTerminals([])).toEqual({ count: 0, commands: [] });
    const many = Array.from({ length: 7 }, (_, index) => ({ active: true, command: `job ${index}` }));
    expect(busyTerminals([{ active: false, command: "zsh" }, ...many])).toEqual({ count: 7, commands: ["job 0", "job 1", "job 2", "job 3", "job 4"] });
    expect(busyTerminals([{ active: true }]).commands).toEqual(["a command"]);
  });
});
