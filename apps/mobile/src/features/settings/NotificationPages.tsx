import { Fragment } from "react";
import { Icon, Theme } from "../../ui";
import { appSettings, useAppSettings } from "./app-settings";
import { CardButtonRow, CardDivider, CardToggleRow, CardValueRow, SettingsGroup, SettingsPage } from "./kit";
import { notificationSounds, soundLabel } from "./store";

export function NotificationsPage({ onSound }: { onSound: () => void }) {
  const settings = useAppSettings();
  return (
    <SettingsPage title="Notifications">
      <SettingsGroup label="Alerts" footer="Mute a single session from its menu.">
        <CardToggleRow icon="bell" title="Notifications" isOn={settings.notifications} onChange={(on) => appSettings.set("notifications", on)} />
        {settings.notifications ? (
          <>
            <CardDivider />
            <CardToggleRow icon="checkmark.circle" title="Work completed" isOn={settings.completions} onChange={(on) => appSettings.set("completions", on)} />
            <CardDivider />
            <CardToggleRow icon="text.bubble" title="Show session titles" isOn={settings.previews} onChange={(on) => appSettings.set("previews", on)} />
            <CardDivider />
            <CardValueRow icon="speaker.wave.2" title="Sound" value={soundLabel[settings.sound]} onPress={onSound} />
          </>
        ) : null}
      </SettingsGroup>
      <SettingsGroup label="Lock screen" footer="One card for the work on all your Macs. It starts when you open Telar.">
        <CardToggleRow icon="rectangle.badge.checkmark" title="Live Activity" isOn={settings.liveActivity} onChange={(on) => appSettings.set("liveActivity", on)} />
      </SettingsGroup>
    </SettingsPage>
  );
}

export function SoundPage() {
  const { sound: chosen } = useAppSettings();
  return (
    <SettingsPage title="Sound">
      <SettingsGroup footer="Plays when work finishes, needs you or fails.">
        {notificationSounds.map((sound, index) => (
          <Fragment key={sound}>
            {index > 0 ? <CardDivider /> : null}
            <CardButtonRow icon={sound === "off" ? "speaker.slash" : "music.note"} title={soundLabel[sound]} onPress={() => appSettings.set("sound", sound)}>
              {chosen === sound ? <Icon name="checkmark" color={Theme.accent} /> : null}
            </CardButtonRow>
          </Fragment>
        ))}
      </SettingsGroup>
    </SettingsPage>
  );
}
