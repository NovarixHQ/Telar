import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { BrowserGroup } from "@/features/browser/panes/browser-group";
import { LinksRow } from "@/features/browser/panes/links-row";
import { DictationMicrophoneRows } from "@/features/dictation/components/dictation-microphone-section";
import { RailSection } from "@/features/sessions/components/rail-section";
import { SECTIONS } from "../settings-sections";
import { Row, SettingsGroup, ToggleRow } from "./settings-shell";
import { TextGenSection } from "@/features/providers/components/textgen-section";
import { WorkspaceSection } from "@/features/projects/components/workspace-section";

test("a group's scope renders as a quiet label, with its meaning behind the ⓘ", () => {
  const html = renderToStaticMarkup(
    <SettingsGroup title="Links" scope="browser">
      <Row label="Something" />
    </SettingsGroup>,
  );
  expect(html).toContain('data-scope="browser"');
  expect(html).toContain("This browser");
  expect(html).toContain('aria-label="Scope: This browser"');
  expect(html).toContain("Kept in this window&#x27;s own storage.");
});

test("ToggleRow passes `info` through to Row's ⓘ", () => {
  const html = renderToStaticMarkup(<ToggleRow label="A switch" info="The fact nobody could infer." checked onCheckedChange={() => {}} />);
  expect(html).toContain('data-info="The fact nobody could infer."');
});

test("only panes kept somewhere other than this computer name their scope in the header", () => {
  expect(Object.fromEntries(SECTIONS.map((section) => [section.id, section.scope]))).toEqual({
    general: undefined,
    appearance: "browser",
    keybindings: "browser",
    providers: undefined,
    integrations: undefined,
    plugins: undefined,
    projects: "project",
    notifications: undefined,
    "source-control": undefined,
    storage: undefined,
    connections: undefined,
  });
});

test("the mixed panes mark each group by where it is stored", () => {
  const scopes = (Section: ComponentType) => [...new Set([...renderToStaticMarkup(<Section />).matchAll(/data-scope="(\w+)"/g)].map((match) => match[1]))];
  // Off the address bar's host this reads "host"; the local engine is this Mac.
  expect(scopes(RailSection)).toEqual(["mac"]);
  for (const Section of [WorkspaceSection, TextGenSection, BrowserGroup]) {
    expect(scopes(Section)).toEqual(["mac"]);
  }
});

test("a row kept in this browser inside a this-computer group says so behind its ⓘ", () => {
  for (const Rows of [LinksRow, DictationMicrophoneRows]) {
    expect(renderToStaticMarkup(<Rows />)).toContain('data-info="Kept in this browser only.');
  }
});
