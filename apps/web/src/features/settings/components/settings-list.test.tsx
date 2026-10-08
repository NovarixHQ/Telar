import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsList } from "./settings-list";

const rows = (count: number) => Array.from({ length: count }, (_, index) => <div key={index}>Row {index}</div>);

test("a short list renders its rows in place", () => {
  const html = renderToStaticMarkup(<SettingsList label="Profiles">{rows(3)}</SettingsList>);
  expect(html).not.toContain('role="region"');
  expect(html).toContain("Row 2");
});

test("a long list scrolls in a labelled, focusable region", () => {
  const html = renderToStaticMarkup(<SettingsList label="Profiles">{rows(12)}</SettingsList>);
  expect(html).toContain('role="region"');
  expect(html).toContain('aria-label="Profiles"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain("Row 11");
});
