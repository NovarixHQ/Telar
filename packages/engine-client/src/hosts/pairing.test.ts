import { describe, expect, test } from "bun:test";
import { normalizeBaseUrl, parsePairingUrl } from "./pairing";

describe("normalizeBaseUrl", () => {
  test("one Mac, however it is spelled", () => {
    expect(normalizeBaseUrl("HTTP://Mini.Tail:3000/")).toBe("http://mini.tail:3000");
    expect(normalizeBaseUrl("http://mini.tail:3000/pair")).toBe("http://mini.tail:3000");
    expect(normalizeBaseUrl("https://mini.tail")).toBe("https://mini.tail:443");
  });

  test("refuses anything that is not an http origin", () => {
    expect(normalizeBaseUrl("ftp://mini")).toBeUndefined();
    expect(normalizeBaseUrl("mini:3000")).toBeUndefined();
    expect(normalizeBaseUrl("")).toBeUndefined();
  });
});

describe("parsePairingUrl", () => {
  test("the cockpit's own pairing link — code in the fragment, /pair stripped", () => {
    expect(parsePairingUrl(" http://192.168.1.9:3000/pair#token=48129037 ")).toEqual({
      baseUrl: "http://192.168.1.9:3000",
      token: "48129037",
    });
  });

  test("an older cockpit's tlr_ token still rides", () => {
    expect(parsePairingUrl("http://192.168.1.9:3000/pair#token=tlr_abcDEF-_12")).toEqual({
      baseUrl: "http://192.168.1.9:3000",
      token: "tlr_abcDEF-_12",
    });
  });

  test("a token in the query string is refused", () => {
    expect(parsePairingUrl("http://mini:3000/pair?token=tlr_abc")).toBeUndefined();
  });

  test("a telar:// link carries the cockpit's link inside it", () => {
    expect(parsePairingUrl(`telar://pair?link=${encodeURIComponent("http://100.70.1.2:3000/pair#token=48129037")}`)).toEqual({
      baseUrl: "http://100.70.1.2:3000",
      token: "48129037",
    });
    expect(parsePairingUrl("telar://pair")).toBeUndefined();
    expect(parsePairingUrl(`telar://session?link=${encodeURIComponent("http://mini:3000/pair#token=48129037")}`)).toBeUndefined();
  });

  test("not a pairing link at all", () => {
    expect(parsePairingUrl("http://mini:3000/")).toBeUndefined();
    expect(parsePairingUrl("http://mini:3000/pair#token=nope")).toBeUndefined();
    expect(parsePairingUrl("http://mini:3000/pair#token=1234567")).toBeUndefined();
    expect(parsePairingUrl("http://mini:3000/pair#token=123456789")).toBeUndefined();
    expect(parsePairingUrl("garbage")).toBeUndefined();
  });
});

