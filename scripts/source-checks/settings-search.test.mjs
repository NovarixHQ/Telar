import { expect, test } from "bun:test";
import { collectSettingsPages } from "../settings-index.mjs";

const pages = collectSettingsPages();
const group = (page, title) => pages.find((entry) => entry.id === page)?.groups.find((entry) => entry.title === title);

test("a row is indexed on the pane and under the group that render it", () => {
  expect(group("notifications", "Alerts")?.rows.map((row) => row.title)).toContain("Notify on");
  expect(group("general", "Rail")?.rows.map((row) => row.title)).toContain("Terminals settled sessions may keep open");
});

test("rows a component draws inside its own group's children take that group", () => {
  expect(group("connections", "Paired")?.rows.map((row) => row.title)).toEqual(["Pair a device", "Revoke all other devices", "Add a computer"]);
});

test("rows built from a list and plugin panes are found, and state rows are not", () => {
  expect(group("projects", "New worktrees")?.rows.map((row) => row.title)).toContain("Ports");
  expect(group("projects", "LaTeX")?.rows.map((row) => row.title)).toContain("LaTeX for this project");
  const titles = pages.flatMap((page) => page.groups.flatMap((entry) => entry.rows.map((row) => row.title)));
  expect(titles).not.toContain("Loading");
});
