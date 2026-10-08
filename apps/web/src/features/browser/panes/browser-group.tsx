"use client";

import { SettingsGroup } from "@/features/settings";
import { PasswordManagerToggles } from "./browser-logins-section";
import { BrowserProfilesRows } from "./browser-profiles-section";
import { LinksRow } from "./links-row";

export function BrowserGroup() {
  return (
    <SettingsGroup title="Browser" scope="mac">
      <LinksRow />
      <BrowserProfilesRows />
      <PasswordManagerToggles />
    </SettingsGroup>
  );
}
