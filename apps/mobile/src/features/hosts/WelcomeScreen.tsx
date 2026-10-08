import { Button, Host, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { background, buttonStyle, font, foregroundStyle, frame, multilineTextAlignment, padding } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useLayoutEffect, useState } from "react";
import type { RootStack } from "../../platform/navigation/routes";
import { TelarLogo, Theme } from "../../ui";
import { PasteLinkAlert } from "./PasteLinkAlert";
import { QRScanner } from "./QRScanner";
import { PrimaryActionButton } from "./fields";
import { SettingsCard, StatusBanner } from "./settings-kit";
import { cameraUsable, usePairing } from "./use-pairing";

const footnote = font({ textStyle: "footnote" });
const muted = foregroundStyle(Theme.textMuted);

/** What the phone shows before any computer is paired: the mark, one line of promise, and the ways to pair. */
export function WelcomeScreen() {
  const navigation = useNavigation<NavigationProp<RootStack>>();
  const { busy, error, pair } = usePairing();
  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(false);
  const camera = cameraUsable();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
    return () => navigation.setOptions({ headerShown: true });
  }, [navigation]);

  return (
    <Host style={{ flex: 1 }}>
      <VStack spacing={0} modifiers={[padding({ horizontal: 24 }), frame({ maxWidth: 520 }), padding({ bottom: 16 }), frame({ maxWidth: Infinity, maxHeight: Infinity }), background(Theme.sheet)]}>
        <Spacer />
        <VStack modifiers={[padding({ bottom: 28 })]}>
          <TelarLogo size={112} />
        </VStack>
        <Text modifiers={[font({ size: 40, weight: "bold" }), foregroundStyle(Theme.text), padding({ bottom: 10 })]}>Telar</Text>
        <Text modifiers={[font({ textStyle: "body" }), muted, multilineTextAlignment("center"), padding({ bottom: 6 })]}>Your work, within reach.</Text>
        <Text modifiers={[footnote, muted, multilineTextAlignment("center")]}>{"Follow your agents. Review their work.\nPick up the conversation anywhere."}</Text>
        <Spacer />
        {busy ? <ProgressView modifiers={[padding({ bottom: 24 })]} /> : null}
        {error ? (
          <VStack modifiers={[padding({ bottom: 16 })]}>
            <SettingsCard>
              <StatusBanner icon="xmark.circle" color={Theme.red} title={error} />
            </SettingsCard>
          </VStack>
        ) : null}
        <VStack spacing={12}>
          {camera ? (
            <PrimaryActionButton title="Scan pairing code" busy={busy} onPress={() => setScanning(true)} />
          ) : (
            <PasteLinkAlert presented={pasting} onPresentedChange={setPasting} onPair={(link) => void pair(link)}>
              <PrimaryActionButton title="Paste pairing link" busy={busy} onPress={() => setPasting(true)} />
            </PasteLinkAlert>
          )}
          <Button onPress={() => navigation.navigate("Pair")} modifiers={[buttonStyle("plain")]}>
            <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), muted, frame({ maxWidth: Infinity, minHeight: 44, maxHeight: 44 })]}>Connect manually</Text>
          </Button>
        </VStack>
        <Text modifiers={[footnote, muted, padding({ top: 8 })]}>The code lives on the computer: Settings → Connections.</Text>
        <QRScanner visible={scanning} onPaired={(link) => void pair(link)} onClose={() => setScanning(false)} />
      </VStack>
    </Host>
  );
}
