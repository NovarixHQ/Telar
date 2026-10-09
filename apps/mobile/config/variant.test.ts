import { describe, expect, test } from "bun:test";
import { appVariant } from "./variant";

describe("appVariant", () => {
  test("dev is Telar Dev with its own bundle id", () => {
    expect(appVariant("dev")).toEqual({
      name: "Telar Dev",
      bundleId: "io.github.novarix.telar.dev",
      icon: "./assets/icon-dev.png",
      apsEnvironment: "development",
    });
  });

  test("unset or unknown values build the release app", () => {
    for (const value of [undefined, "", "production", "Dev"]) {
      expect(appVariant(value).bundleId).toBe("io.github.novarix.telar");
      expect(appVariant(value).name).toBe("Telar");
      expect(appVariant(value).apsEnvironment).toBe("production");
    }
  });
});
