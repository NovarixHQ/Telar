import { describe, expect, test } from "bun:test";
import { rowTime } from "./row-time";

const now = new Date(2026, 9, 8, 15, 0).getTime();
const at = (month: number, day: number, year = 2026) => new Date(year, month, day, 9, 5).getTime();

describe("a transcript row's time", () => {
  test("today is the clock alone", () => {
    expect(rowTime(at(9, 8), now).label).not.toMatch(/[A-Za-z]{3,}/);
  });

  test("yesterday says so", () => {
    expect(rowTime(at(9, 7), now).label).toStartWith("Yesterday ");
  });

  test("earlier this week names the weekday", () => {
    expect(rowTime(at(9, 5), now).label).toStartWith(new Date(at(9, 5)).toLocaleDateString(undefined, { weekday: "short" }));
  });

  test("older names the date, and the year only when it is not this one", () => {
    expect(rowTime(at(8, 1), now).label).not.toContain("2026");
    expect(rowTime(at(8, 1, 2025), now).label).toContain("2025");
  });

  test("the tooltip always carries the full date", () => {
    expect(rowTime(at(9, 8), now).full).toContain("2026");
  });
});
