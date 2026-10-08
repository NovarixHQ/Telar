import { VStack } from "@expo/ui/swift-ui";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { parsePairingUrl } from "@telar/engine-client";
import { useEffect, useRef, useState } from "react";
import type { RootStack } from "../../platform/navigation/routes";
import { Theme } from "../../ui";
import { addressFields, cockpitAddress, pairedBanner, probeBanner, testConnection, type ProbeResult } from "./connect";
import { QRScanner } from "./QRScanner";
import { forgetPairing, hosts, pairedHost, rememberHost } from "./registry";
import { CardButtonRow, CardDivider, CardField, PrimaryActionButton, SettingsCard, SettingsFootnote, SettingsPage, SettingsSectionLabel, StatusBanner, useField } from "./settings-kit";
import { cameraUsable, usePairing } from "./use-pairing";
import { useHosts } from "./use-hosts";

/** Swift's ConnectView: reach a cockpit by address, pair it by code or link, and test the link. */
export function ConnectScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Pair">>();
  useHosts(hosts);
  const [hostId, setHostId] = useState(params?.hostId);
  const target = hostId ? pairedHost(hostId) : undefined;
  const token = target?.token || undefined;
  const initial = addressFields(target?.paired[0]);
  const host = useField(initial.host);
  const port = useField(initial.port);
  const link = useField("");
  const pairing = usePairing();
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ProbeResult>();
  const [scanning, setScanning] = useState(false);
  const busy = probing || pairing.busy;

  const probe = async (address = cockpitAddress(host.value, port.value), credential = token) => {
    setProbing(true);
    pairing.setError(undefined);
    setResult(await testConnection(address, credential));
    setProbing(false);
  };

  const pair = async (text: string) => {
    const paired = await pairing.pair(text);
    if (!paired) return;
    link.set("");
    setHostId(paired.hostId);
    const fields = addressFields(paired.paired[0]);
    host.set(fields.host);
    port.set(fields.port);
    await probe(paired.paired[0], paired.token);
  };

  const seeded = useRef(false);
  useEffect(() => {
    if (!params?.link || seeded.current) return;
    seeded.current = true;
    link.set(params.link);
    void pair(params.link);
  });

  const adoptOpenCockpit = async (found: Extract<ProbeResult, { kind: "ok" }>) => {
    if (!found.identity) return;
    const address = cockpitAddress(host.value, port.value);
    await rememberHost({ hostId: found.identity.hostId, name: found.identity.name ?? new URL(address).hostname, token: "", deviceId: "", paired: [address] });
    setHostId(found.identity.hostId);
  };

  const shown = pairing.error ? ({ kind: "failed", message: pairing.error } as const) : result;

  return (
    <>
      <SettingsPage>
        <VStack spacing={0}>
          <SettingsSectionLabel text="Cockpit address" />
          <SettingsCard>
            <CardField label="Host" placeholder="Tailscale IP or hostname" field={host} keyboard="url" />
            <CardDivider />
            <CardField label="Port" placeholder="3000" field={port} keyboard="ascii-capable-number-pad" />
          </SettingsCard>
          <SettingsFootnote text="The computer must run the cockpit bound to its tailnet address (TELAR_WEB_HOST), and this phone must be on the same tailnet." />
        </VStack>

        <VStack spacing={0}>
          <SettingsSectionLabel text="Pairing" />
          <SettingsCard>
            {token ? (
              <>
                <StatusBanner {...pairedBanner(target?.name ?? "this computer")} />
                <CardDivider />
              </>
            ) : null}
            {cameraUsable() ? (
              <>
                <CardButtonRow icon="qrcode.viewfinder" iconColor={Theme.accent} title="Scan pairing code" titleColor={Theme.accent} enabled={!busy} onPress={() => setScanning(true)} />
                <CardDivider />
              </>
            ) : null}
            <CardField label="Or paste the pairing link" placeholder="http://…/pair#token=…" field={link} mono keyboard="url" />
            {parsePairingUrl(link.value) ? (
              <>
                <CardDivider />
                <CardButtonRow icon="link" iconColor={Theme.accent} title="Pair" titleColor={Theme.accent} enabled={!busy} onPress={() => void pair(link.value)} />
              </>
            ) : null}
            {target && token ? (
              <>
                <CardDivider />
                <CardButtonRow
                  icon="xmark.seal"
                  iconColor={Theme.red}
                  title="Forget pairing"
                  titleColor={Theme.red}
                  enabled={!busy}
                  onPress={() => {
                    void forgetPairing(target.hostId);
                    setResult(undefined);
                  }}
                />
              </>
            ) : null}
          </SettingsCard>
          <SettingsFootnote
            text={
              token
                ? "Forget removes the credential from this phone only — revoke the device on the computer to kill it everywhere."
                : "When the cockpit requires pairing: Settings → Connections → show the code, then copy the link under the QR."
            }
          />
        </VStack>

        <VStack spacing={12}>
          <PrimaryActionButton title="Test connection" busy={busy} enabled={host.value.trim() !== ""} onPress={() => void probe()} />
          {shown ? (
            <SettingsCard>
              <StatusBanner {...probeBanner(shown)} />
              {shown.kind === "ok" && shown.identity && !pairedHost(shown.identity.hostId) ? (
                <>
                  <CardDivider />
                  <CardButtonRow icon="arrow.right.circle.fill" iconColor={Theme.accent} title="Use this cockpit" titleColor={Theme.accent} onPress={() => void adoptOpenCockpit(shown)} />
                </>
              ) : null}
            </SettingsCard>
          ) : null}
        </VStack>
      </SettingsPage>
      <QRScanner
        visible={scanning}
        onPaired={(scanned) => {
          link.set(scanned);
          void pair(scanned);
        }}
        onClose={() => setScanning(false)}
      />
    </>
  );
}
