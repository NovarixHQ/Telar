import { Alert, Button, ConfirmationDialog, HStack, Menu, ProgressView, Section, Text, TextField, useNativeState, VStack } from "@expo/ui/swift-ui";
import { background, clipShape, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, strokeBorder } from "@expo/ui/swift-ui/modifiers";
import type { DeviceRole, RemoteDevice } from "@telar/engine-client";
import { Fragment, useState, type ReactNode } from "react";
import { faded, Icon, Theme } from "../../ui";
import type { HostConnection } from "../../platform/connection";
import { deviceSubtitle, devicesView, platformSymbol, type RemoteStatus } from "./devices";
import { failureText, useHostLoad } from "./host-call";
import { CardButtonRow, CardDivider, Footnote, GlyphBox, SectionLabel, SettingsCard, SettingsGroup, SettingsPage, StatusBanner } from "./kit";

const loadStatus = (host: HostConnection) => host.request<RemoteStatus>("GET", "/v2/remote");
const devicePath = (id: string) => `/v2/remote/devices/${encodeURIComponent(id)}`;

function RoleChip({ role, canManage }: { role: DeviceRole; canManage: boolean }) {
  const observer = role === "observer";
  return (
    <HStack
      spacing={5}
      modifiers={[
        foregroundStyle(observer ? Theme.amber : Theme.text),
        padding({ horizontal: 12 }),
        frame({ height: 32 }),
        background(Theme.subtle),
        clipShape("capsule"),
        strokeBorder({ color: Theme.border, style: { lineWidth: 1 }, shape: "capsule" }),
      ]}
    >
      <Icon name={observer ? "eye" : "checkmark.shield"} textStyle="caption" weight="medium" />
      <Text modifiers={[font({ textStyle: "footnote", weight: "semibold" })]}>{observer ? "View only" : "Full"}</Text>
      {canManage ? <Icon name="chevron.down" textStyle="caption2" weight="medium" /> : null}
    </HStack>
  );
}

type Actions = { setRole: (device: RemoteDevice, role: DeviceRole) => void; rename: (device: RemoteDevice) => void; revoke: (device: RemoteDevice) => void };

function DeviceRow({ device, isSelf, canManage, actions }: { device: RemoteDevice; isSelf: boolean; canManage: boolean; actions: Actions }) {
  const chip = <RoleChip role={device.role} canManage={canManage} />;
  return (
    <HStack spacing={12} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
      <GlyphBox name={platformSymbol(device.platform)} />
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}>
        <HStack spacing={6}>
          <Text modifiers={[font({ textStyle: "callout", weight: "semibold" }), foregroundStyle(Theme.text), lineLimit(1)]}>{device.name}</Text>
          {isSelf ? (
            <Text modifiers={[font({ textStyle: "caption", weight: "medium" }), foregroundStyle(Theme.accent), padding({ horizontal: 7, vertical: 2 }), background(faded("accent", 0.12)), clipShape("capsule")]}>
              This iPhone
            </Text>
          ) : null}
        </HStack>
        <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.textMuted), monospacedDigit()]}>{deviceSubtitle(device, Date.now())}</Text>
      </VStack>
      {canManage ? (
        <Menu label={chip}>
          <Section title="Access">
            <Button label="Full access" systemImage={device.role === "full" ? "checkmark" : "hand.raised"} onPress={() => actions.setRole(device, "full")} />
            <Button label="View only" systemImage={device.role === "observer" ? "checkmark" : "eye"} onPress={() => actions.setRole(device, "observer")} />
          </Section>
          <Button label="Rename…" systemImage="pencil" onPress={() => actions.rename(device)} />
          {isSelf ? null : <Button label="Revoke" systemImage="xmark.circle" role="destructive" onPress={() => actions.revoke(device)} />}
        </Menu>
      ) : (
        chip
      )}
    </HStack>
  );
}

function DeviceList({ devices, isSelf, canManage, actions }: { devices: RemoteDevice[]; isSelf: boolean; canManage: boolean; actions: Actions }) {
  return devices.map((device, index) => (
    <Fragment key={device.id}>
      {index > 0 ? <CardDivider /> : null}
      <DeviceRow device={device} isSelf={isSelf} canManage={canManage} actions={actions} />
    </Fragment>
  ));
}

function Body({ status, error, actions, onRevokeOthers }: { status: RemoteStatus | undefined; error: string | undefined; actions: Actions; onRevokeOthers: () => void }) {
  if (!status) {
    if (error) return <SettingsCard><StatusBanner icon="xmark.circle" color={Theme.red} title={error} /></SettingsCard>;
    return <ProgressView modifiers={[frame({ maxWidth: Infinity }), padding({ top: 48 })]} />;
  }
  const view = devicesView(status);
  const banners: ReactNode[] = [];
  if (!status.requireAuth) {
    banners.push(
      <SettingsCard key="open">
        <StatusBanner icon="lock.open" color={Theme.amber} title="Pairing is off on the computer." detail="Anything that can reach the cockpit has full control. These credentials matter again when it's turned on." />
      </SettingsCard>,
    );
  }
  if (status.callerRole === "observer") {
    banners.push(
      <SettingsCard key="observer">
        <StatusBanner icon="eye" color={Theme.amber} title="This phone is view-only." detail="It can see the devices but not change them." />
      </SettingsCard>,
    );
  }
  return (
    <>
      {banners}
      {view.mine.length > 0 ? (
        <VStack spacing={0}>
          <SectionLabel text="This device" />
          <SettingsCard>
            <DeviceList devices={view.mine} isSelf canManage={view.canManage} actions={actions} />
          </SettingsCard>
        </VStack>
      ) : null}
      <SettingsGroup
        label={view.othersLabel}
        {...(view.canManage ? { footer: "Tap the role chip to rename, change access, or revoke. Revoking logs the device out on its next request." } : {})}
        {...(error ? { error } : {})}
      >
        {view.emptyTitle ? <StatusBanner icon="antenna.radiowaves.left.and.right" color={Theme.textMuted} title={view.emptyTitle} detail="Devices appear here as they pair from the computer's Connections settings." /> : null}
        <DeviceList devices={view.others} isSelf={false} canManage={view.canManage} actions={actions} />
      </SettingsGroup>
      {view.canRevokeOthers ? (
        <VStack spacing={0}>
          <SettingsCard>
            <CardButtonRow icon="person.crop.circle.badge.xmark" iconColor={Theme.red} title="Revoke all other devices" titleColor={Theme.red} onPress={onRevokeOthers} />
          </SettingsCard>
          <Footnote text="The lost-phone button: everything except this phone is logged out on its next request." />
        </VStack>
      ) : null}
    </>
  );
}

export function DevicesPage({ hostId }: { hostId: string }) {
  const { value: status, error, setError, reload, host } = useHostLoad(hostId, loadStatus);
  const [renaming, setRenaming] = useState<RemoteDevice>();
  const draft = useNativeState("");
  const [revoking, setRevoking] = useState<RemoteDevice>();
  const [revokingOthers, setRevokingOthers] = useState(false);

  const run = async (method: string, path: string, body?: unknown) => {
    try {
      await host?.request(method, path, body);
      setError(undefined);
    } catch (failure) {
      setError(failureText(failure));
    }
    await reload();
  };
  const actions: Actions = {
    setRole: (device, role) => void run("PATCH", devicePath(device.id), { role }),
    rename: (device) => {
      draft.set(device.name);
      setRenaming(device);
    },
    revoke: setRevoking,
  };

  return (
    <Alert title="Rename device" isPresented={renaming !== undefined} onIsPresentedChange={(shown) => !shown && setRenaming(undefined)}>
      <Alert.Trigger>
        <ConfirmationDialog title={`Revoke ${revoking?.name ?? "device"}?`} titleVisibility="visible" isPresented={revoking !== undefined} onIsPresentedChange={(shown) => !shown && setRevoking(undefined)}>
          <ConfirmationDialog.Trigger>
            <ConfirmationDialog title="Revoke all other devices?" titleVisibility="visible" isPresented={revokingOthers} onIsPresentedChange={setRevokingOthers}>
              <ConfirmationDialog.Trigger>
                <SettingsPage title="Devices" onRefresh={reload}>
                  <Body status={status} error={error} actions={actions} onRevokeOthers={() => setRevokingOthers(true)} />
                </SettingsPage>
              </ConfirmationDialog.Trigger>
              <ConfirmationDialog.Actions>
                <Button label="Revoke them" role="destructive" onPress={() => void run("DELETE", "/v2/remote/devices")} />
              </ConfirmationDialog.Actions>
              <ConfirmationDialog.Message>
                <Text>Every device except this one is logged out. They can pair again with a fresh code.</Text>
              </ConfirmationDialog.Message>
            </ConfirmationDialog>
          </ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            <Button label="Revoke" role="destructive" onPress={() => revoking && void run("DELETE", devicePath(revoking.id))} />
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>It is logged out on its next request and can pair again with a fresh code.</Text>
          </ConfirmationDialog.Message>
        </ConfirmationDialog>
      </Alert.Trigger>
      <Alert.Actions>
        <TextField placeholder="Name" text={draft} />
        <Button label="Rename" onPress={() => renaming && void run("PATCH", devicePath(renaming.id), { name: draft.get() })} />
        <Button label="Cancel" role="cancel" onPress={() => setRenaming(undefined)} />
      </Alert.Actions>
    </Alert>
  );
}
