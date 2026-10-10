import { expect, test } from "bun:test";
import { LatexMachineSettingsWrite, resolveLatex } from "./settings";

const ECHO = "/bin/echo";
const LS = "/bin/ls";

test("with nothing chosen and nothing installed, LaTeX does not resolve", () => {
  expect(resolveLatex({}, {}, undefined)).toBeUndefined();
});

test("Telar's own Tectonic compiles a project that chose nothing", () => {
  expect(resolveLatex({ mainFile: "paper.tex" }, {}, LS)).toEqual({ kind: "tectonic", binPath: LS, mainFile: "paper.tex" });
});

test("project, then this Mac, then the managed copy; a choice whose binary is gone falls through", () => {
  expect(resolveLatex({}, { toolchain: { kind: "texlive", path: ECHO } }, LS)).toMatchObject({ kind: "texlive", binPath: ECHO });
  expect(resolveLatex({ toolchain: { kind: "tectonic", path: LS } }, { toolchain: { kind: "texlive", path: ECHO } }, undefined)).toMatchObject({ kind: "tectonic", binPath: LS });
  expect(resolveLatex({}, { toolchain: { kind: "texlive", path: "/nowhere/that/exists" } }, LS)).toMatchObject({ kind: "tectonic", binPath: LS });
});

test("`managed` names an intent and resolves to today's binary", () => {
  expect(resolveLatex({}, { toolchain: { kind: "managed" } }, LS)).toMatchObject({ kind: "tectonic", binPath: LS });
});

test("the Mac's engine and auto-install reach the compile; a project's own engine wins", () => {
  const machine = { toolchain: { kind: "texlive" as const, path: ECHO }, engine: "lualatex" as const };
  expect(resolveLatex({}, machine, undefined)).toMatchObject({ engine: "lualatex" });
  expect(resolveLatex({}, machine, undefined)?.autoInstallPackages).toBeUndefined();
  expect(resolveLatex({}, { ...machine, autoInstallPackages: true }, undefined)?.autoInstallPackages).toBe(true);
  expect(resolveLatex({ toolchain: { kind: "texlive", path: ECHO, engine: "xelatex" } }, machine, undefined)).toMatchObject({ engine: "xelatex" });
});

test("only `managed` may omit a path in a machine default, and project fields are refused there", () => {
  expect(LatexMachineSettingsWrite.safeParse({ toolchain: { kind: "texlive" } }).success).toBe(false);
  expect(LatexMachineSettingsWrite.safeParse({ toolchain: { kind: "managed" } }).success).toBe(true);
  expect(LatexMachineSettingsWrite.safeParse({ mainFile: "paper.tex" }).success).toBe(false);
});
