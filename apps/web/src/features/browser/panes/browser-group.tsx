"use client";

import { SettingsGroup } from "@/features/settings";
import { BrowserLoginsRows } from "./browser-logins-section";
import { BrowserProfilesRows, SitePermissionsRows } from "./browser-profiles-section";
import { LinksRow } from "./links-row";

export function BrowserGroup() {
  return (
    <SettingsGroup title="Browser" scope="mac">
      <LinksRow />
      <BrowserProfilesRows />
      <BrowserLoginsRows />
      <SitePermissionsRows />
    </SettingsGroup>
  );
}
