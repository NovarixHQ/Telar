import { describe, expect, test } from "bun:test";
import { terminalEnv } from "./env";

describe("terminalEnv", () => {
  test("a bare environment gets a 256-colour xterm, truecolor and a UTF-8 locale", () => {
    const env = terminalEnv({ PATH: "/usr/bin" });
    expect(env).toEqual({ PATH: "/usr/bin", TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8" });
  });

  test("the person's colour and locale stay as they set them", () => {
    expect(terminalEnv({ COLORTERM: "24bit", LANG: "es_AR.UTF-8" })).toMatchObject({ COLORTERM: "24bit", LANG: "es_AR.UTF-8" });
    expect(terminalEnv({ LC_CTYPE: "UTF-8" }).LANG).toBeUndefined();
    expect(terminalEnv({ LC_ALL: "C" }).LANG).toBeUndefined();
  });

  test("an empty value counts as unset", () => {
    expect(terminalEnv({ COLORTERM: "", LANG: " " })).toMatchObject({ COLORTERM: "truecolor", LANG: "en_US.UTF-8" });
  });

  test("TERM is always the emulator's", () => {
    expect(terminalEnv({ TERM: "dumb" }).TERM).toBe("xterm-256color");
  });
});
