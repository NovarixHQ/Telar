import { Button, Divider, HStack, Host, ScrollView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, multilineTextAlignment, padding, shapes, strokeBorder } from "@expo/ui/swift-ui/modifiers";
import type { BrowserTab } from "@telar/engine-client";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView as Scroller, StyleSheet, TextInput, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Icon, Radius, Theme, Type } from "../../ui";
import { useBrowser } from "./use-browser";
import { pageLabel, pageNotice, pickPage, type BrowserView } from "./watch";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Chip({ page, selected, onPress }: { page: BrowserTab; selected: boolean; onPress: () => void }) {
  const chrome = selected
    ? [background(Theme.card, shapes.roundedRectangle({ cornerRadius: Radius.control, roundedCornerStyle: "continuous" })), strokeBorder({ color: Theme.border, style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.control })]
    : [];
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(pageLabel(page))]}>
      <HStack spacing={6} modifiers={[padding({ horizontal: 10 }), frame({ height: 28 }), frame({ maxWidth: 200 }), ...chrome, contentShape(shapes.rectangle())]}>
        <Icon name="globe" textStyle="caption" weight="medium" color={page.loading ? Theme.accent : Theme.textMuted} />
        <Text modifiers={[font({ textStyle: "footnote", weight: selected ? "semibold" : "medium" }), foregroundStyle(selected ? Theme.text : Theme.textMuted), lineLimit(1)]}>{pageLabel(page)}</Text>
      </HStack>
    </Button>
  );
}

function AddressBar({ page, onOpen }: { page: BrowserTab | undefined; onOpen: (typed: string) => Promise<unknown> }) {
  const [address, setAddress] = useState("");
  const submit = () => {
    if (!address.trim()) return;
    onOpen(address).then(() => setAddress(""), () => {});
  };
  return (
    <View style={styles.address}>
      <Host matchContents>
        <Icon name="globe" textStyle="footnote" weight="medium" color={page?.loading ? Theme.accent : Theme.textMuted} />
      </Host>
      <TextInput
        style={styles.field}
        value={address}
        onChangeText={setAddress}
        onSubmitEditing={submit}
        placeholder={page?.url || "Open an address"}
        placeholderTextColor={Theme.textMuted}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="go"
      />
    </View>
  );
}

function Notice({ title, detail, failed, action }: { title: string; detail: string; failed: boolean; action?: () => void }) {
  return (
    <Host style={styles.fill}>
      <VStack spacing={6} modifiers={[frame({ maxWidth: 300 }), padding({ all: 24 })]}>
        <Icon name="globe" size={15} weight="medium" color={Theme.textMuted} modifiers={[frame({ width: 36, height: 36 }), background(Theme.fill, shapes.circle())]} />
        <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(Theme.text), lineLimit(2)]}>{title}</Text>
        <Text modifiers={[Type.slim, foregroundStyle(failed ? Theme.red : Theme.textMuted), multilineTextAlignment("center")]}>{detail}</Text>
        {action ? <Button label="Open a page" systemImage="plus" onPress={action} modifiers={[padding({ top: 6 })]} /> : null}
      </VStack>
    </Host>
  );
}

function Screenshot({ uri, label }: { uri: string; label: string }) {
  const [ratio, setRatio] = useState<number>();
  return (
    <Scroller style={styles.sheet} contentContainerStyle={styles.shot}>
      <Image
        source={{ uri }}
        onLoad={({ nativeEvent: { source } }) => source.width > 0 && setRatio(source.width / source.height)}
        style={[styles.image, { aspectRatio: ratio ?? 16 / 10 }]}
        resizeMode="contain"
        accessibilityLabel={`Screenshot of ${label}`}
      />
    </Scroller>
  );
}

function Content({ view, page, onLaunch }: { view: BrowserView; page: BrowserTab | undefined; onLaunch: () => void }) {
  const pages = view.snapshot?.tabs ?? [];
  if (pages.length === 0) return <Notice title="No pages open" detail={view.failure ?? "Open an address to watch it here."} failed={!!view.failure} action={onLaunch} />;
  if (page?.active && view.image?.pageId === page.id) return <Screenshot uri={view.image.uri} label={pageLabel(page)} />;
  return <Notice title={page ? pageLabel(page) : "This page is no longer open"} detail={pageNotice(view, page)} failed={!!view.failure} />;
}

/** The pages this session's browser has open on the computer, the focused one photographed live. */
export function BrowserSurface({ host, sessionId }: { host: HostConnection; sessionId: string }) {
  const [wanted, setWanted] = useState<string>();
  const [photograph, setPhotograph] = useState(true);
  const { view, open } = useBrowser(host, sessionId, photograph);
  const pages = view.snapshot?.tabs ?? [];
  const page = pickPage(pages, wanted);
  const focused = page?.active === true && view.snapshot?.running === true;
  useEffect(() => {
    if (view.snapshot) setPhotograph(focused);
  }, [view.snapshot, focused]);

  const openPage = (typed: string) =>
    open(typed).then(
      (opened) => opened && setWanted(opened.id),
      (error) => Alert.alert("Couldn't open it", message(error)),
    );
  const launch = () =>
    Alert.prompt(
      "Open a page",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open", isPreferred: true, onPress: (typed?: string) => void (typed?.trim() && openPage(typed)) },
      ],
      "plain-text",
      "",
      "url",
    );

  if (!view.snapshot) return view.failure ? <Notice title="Browser" detail={view.failure} failed /> : <ActivityIndicator style={styles.fill} color={Theme.textMuted} />;
  return (
    <View style={styles.fill}>
      <Host matchContents={{ vertical: true }}>
        <VStack spacing={0}>
          <HStack spacing={2} modifiers={[padding({ horizontal: 8, vertical: 4 })]}>
            <ScrollView axes="horizontal" showsIndicators={false}>
              <HStack spacing={2}>
                {pages.map((other) => (
                  <Chip key={other.id} page={other} selected={other.id === page?.id} onPress={() => setWanted(other.id)} />
                ))}
              </HStack>
            </ScrollView>
            <Spacer minLength={0} />
            <Button onPress={launch} modifiers={[buttonStyle("plain"), accessibilityLabel("Open a page")]}>
              <Icon name="plus" size={12} weight="semibold" color={Theme.textMuted} modifiers={[frame({ width: 30, height: 30 }), contentShape(shapes.rectangle())]} />
            </Button>
          </HStack>
          <Divider modifiers={[foregroundStyle(faded("border", 0.6))]} />
        </VStack>
      </Host>
      <AddressBar page={page} onOpen={openPage} />
      <Content view={view} page={page} onLaunch={launch} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  address: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.border },
  field: { flex: 1, fontFamily: "ui-monospace", fontSize: 12, color: Theme.text, paddingVertical: 2 },
  sheet: { flex: 1, backgroundColor: Theme.sheet },
  shot: { padding: 10 },
  image: { width: "100%", borderRadius: Radius.control, borderWidth: 1, borderColor: Theme.border },
});
