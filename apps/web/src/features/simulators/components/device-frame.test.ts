import { expect, test } from "bun:test";
import { deviceShape, fitDevice } from "./device-frame";

const phone = deviceShape({ name: "Pulso", version: "iOS 27.0" });

test("each simulator gets its family's frame", () => {
  expect(phone.kind).toBe("phone");
  expect(deviceShape({ name: "iPad Pro 13-inch (M5)", version: "iOS 27.0" }).kind).toBe("tablet");
  expect(deviceShape({ name: "Pulso Watch", version: "watchOS 27.0" }).kind).toBe("watch");
});

test("the device, bezel and buttons included, fills the room along one side and fits the other", () => {
  for (const room of [{ width: 400, height: 1200 }, { width: 1200, height: 500 }]) {
    const fit = fitDevice(phone, 9 / 19.5, room);
    const outer = (side: number) => side + 2 * (phone.bezel + Math.max(...phone.buttons.map((button) => button.depth))) * fit.unit;
    expect(fit.width / fit.height).toBeCloseTo(9 / 19.5);
    expect(outer(fit.width)).toBeLessThanOrEqual(room.width + 1e-9);
    expect(outer(fit.height)).toBeLessThanOrEqual(room.height + 1e-9);
    expect(Math.max(outer(fit.width) / room.width, outer(fit.height) / room.height)).toBeCloseTo(1);
  }
});

test("a landscape screen is laid out wide, and an empty room draws nothing", () => {
  const wide = fitDevice(phone, 19.5 / 9, { width: 1200, height: 600 });
  expect(wide.width).toBeGreaterThan(wide.height);
  expect(wide.unit).toBeCloseTo(wide.height);
  expect(fitDevice(phone, 9 / 19.5, { width: 0, height: 600 })).toEqual({ width: 0, height: 0, unit: 0 });
});
