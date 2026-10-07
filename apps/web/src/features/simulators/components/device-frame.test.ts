import { expect, test } from "bun:test";
import type { SimulatorChrome } from "@telar/engine-client";
import { fitDevice, uprightDevice } from "./device-frame";

const phone = { name: "Pulso", version: "iOS 27.0" };
const art = { src: "data:image/png;base64,", width: 110, height: 110 };
const chrome: SimulatorChrome = {
  screen: { width: 402, height: 874, cornerRadius: 62 },
  frame: {
    width: 438,
    height: 910,
    screen: { x: 18, y: 18 },
    slices: { topLeft: art, top: art, topRight: art, left: art, right: art, bottomLeft: art, bottom: art, bottomRight: art },
    buttons: [{ ...art, width: 16, height: 101, x: 425, y: 262, onTop: false }],
  },
};

test("with chrome, the screen sits where Simulator puts it and the buttons widen the device", () => {
  const device = uprightDevice(chrome, { width: 1206, height: 2622 }, phone);
  expect(device.screen).toEqual({ x: 18, y: 18, width: 402, height: 874 });
  expect(device.radius).toBe(62);
  expect(device.bounds).toEqual({ x: 0, y: 0, width: 441, height: 910 });
});

test("without chrome, a plain body wraps the stream's upright shape and keeps the real corner radius when known", () => {
  const plain = uprightDevice(null, { width: 2622, height: 1206 }, phone);
  expect(plain.frame).toBeNull();
  expect(plain.screen.width / plain.screen.height).toBeCloseTo(1206 / 2622);
  expect(plain.bounds).toEqual({ x: 0, y: 0, ...plain.body });
  expect(uprightDevice({ screen: chrome.screen, frame: null }, undefined, phone).radius).toBe(62);
});

test("the device fits the room upright, and turned sideways it fits the swapped room", () => {
  const device = uprightDevice(chrome, undefined, phone);
  expect(fitDevice(device, 0, { width: 441, height: 2000 })).toBeCloseTo(1);
  expect(fitDevice(device, 90, { width: 910, height: 441 })).toBeCloseTo(1);
  expect(fitDevice(device, -90, { width: 455, height: 441 })).toBeCloseTo(0.5);
  expect(fitDevice(device, 0, { width: 0, height: 600 })).toBe(0);
});
