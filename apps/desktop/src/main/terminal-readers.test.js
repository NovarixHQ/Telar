const { describe, expect, test } = require("bun:test");
const { FakeWebContents } = require("../../test/fake-electron");
const { createTerminalReaders } = require("./terminal-readers");

describe("terminal readers", () => {
  test("a closed window gives up exactly the terminals it was reading", () => {
    const orphaned = [];
    const readers = createTerminalReaders({ onOrphaned: (id) => orphaned.push(id) });
    const a = new FakeWebContents();
    const b = new FakeWebContents();
    readers.attach("t1", a);
    readers.attach("t2", b);
    readers.attach("t3", a);

    a.emit("destroyed");

    expect(orphaned).toEqual(["t1", "t3"]);
    expect(readers.reads("t1", a)).toBe(false);
    expect(readers.reads("t2", b)).toBe(true);
  });

  test("output goes only to the window that reads the terminal", () => {
    const readers = createTerminalReaders({ onOrphaned() {} });
    const a = new FakeWebContents();
    const b = new FakeWebContents();
    readers.attach("t1", a);

    readers.deliver("t1", "telar:terminal:data", { id: "t1", data: "hi" });

    expect(a.sent).toEqual([{ channel: "telar:terminal:data", payload: { id: "t1", data: "hi" } }]);
    expect(b.sent).toEqual([]);
  });

  test("a window that stops reading a terminal does not orphan it later", () => {
    const orphaned = [];
    const readers = createTerminalReaders({ onOrphaned: (id) => orphaned.push(id) });
    const a = new FakeWebContents();
    readers.attach("t1", a);
    readers.detach("t1", a);

    a.emit("destroyed");

    expect(orphaned).toEqual([]);
  });
});
