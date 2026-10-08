import { Picker, Text } from "@expo/ui/swift-ui";
import { fixedSize, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { SidebarMode } from "@telar/engine-client";
import { useState } from "react";
import { hosts, useHosts } from "../hosts";
import { appSettings, useAppSettings } from "./app-settings";
import { saveGroupBy } from "./group-by";
import { CardRow, SettingsGroup, SettingsPage } from "./kit";
import { layoutHosts } from "./layout-hosts";
import { chatWidthLabel, chatWidths, groupByLabel, type ChatWidth } from "./store";

const modes: SidebarMode[] = ["grouped", "flat"];

export function GeneralPage() {
  const { groupBy } = useAppSettings();
  const rows = useHosts(hosts);
  const [failed, setFailed] = useState(false);
  const choose = async (mode: SidebarMode) => setFailed(!(await saveGroupBy(appSettings, layoutHosts(rows), mode)));
  return (
    <SettingsPage title="General">
      <SettingsGroup
        label="Session list"
        footer="Applies on every computer you are paired with."
        {...(failed ? { error: "Couldn't save on every computer. Try again when they are connected." } : {})}
      >
        <CardRow icon="list.bullet.indent" title="Group by">
          <Picker<string> selection={groupBy} onSelectionChange={(mode) => void choose(mode as SidebarMode)} modifiers={[pickerStyle("segmented"), fixedSize()]}>
            {modes.map((mode) => (
              <Text key={mode} modifiers={[tag(mode)]}>
                {groupByLabel[mode]}
              </Text>
            ))}
          </Picker>
        </CardRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

export function AppearancePage() {
  const { chatWidth } = useAppSettings();
  return (
    <SettingsPage title="Appearance">
      <SettingsGroup label="Session" footer="How wide the session and the composer can grow.">
        <CardRow icon="arrow.left.and.right" title="Chat width">
          <Picker<string> selection={chatWidth} onSelectionChange={(width) => appSettings.set("chatWidth", width as ChatWidth)} modifiers={[pickerStyle("segmented"), fixedSize()]}>
            {chatWidths.map((width) => (
              <Text key={width} modifiers={[tag(width)]}>
                {chatWidthLabel[width]}
              </Text>
            ))}
          </Picker>
        </CardRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
