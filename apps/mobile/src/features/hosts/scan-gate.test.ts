import { expect, test } from "bun:test";
import { pinchZoom, scanGate, touchSpread } from "./scan-gate";

const LINK = "http://100.70.1.2:3000/pair#token=48129037";

test("the scanner takes the first pairing link and nothing after it", () => {
  const scan = scanGate();
  expect(scan(LINK)).toBe("accept");
  expect(scan(LINK)).toBe("ignore");
  expect(scan("http://other:3000/pair#token=11112222")).toBe("ignore");
});

test("a code that is not a pairing link warns once, then the scanner keeps looking", () => {
  const scan = scanGate();
  expect(scan("https://example.com/menu")).toBe("reject");
  expect(scan("https://example.com/menu")).toBe("ignore");
  expect(scan(LINK)).toBe("accept");
});

test("pinching out zooms in, pinching in stops at the wide lens, and the zoom is capped", () => {
  expect(pinchZoom(0, 2)).toBeGreaterThan(0);
  expect(pinchZoom(0.2, 0.1)).toBe(0);
  expect(pinchZoom(0, 1000)).toBe(0.45);
  expect(pinchZoom(0.2, 1)).toBe(0.2);
  expect(touchSpread([{ pageX: 0, pageY: 0 }, { pageX: 3, pageY: 4 }])).toBe(5);
  expect(touchSpread([{ pageX: 0, pageY: 0 }])).toBeUndefined();
});
