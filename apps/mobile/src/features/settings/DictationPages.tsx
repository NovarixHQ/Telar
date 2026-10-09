import { Button, HStack, Menu, SecureField, Text, TextField, useNativeState } from "@expo/ui/swift-ui";
import { disabled, font, foregroundStyle, multilineTextAlignment, onDisappear, onSubmit, padding, submitLabel, textFieldStyle } from "@expo/ui/swift-ui/modifiers";
import type { DictationAnswer, DictationProviderId } from "@telar/engine-client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { HostConnection } from "../../platform/connection";
import { Icon, Theme } from "../../ui";
import { failureText, useHostLoad } from "./host-call";
import { CardDivider, CardRow, CardValueRow, SettingsGroup, SettingsPage } from "./kit";

type Patch = { provider?: DictationProviderId; apiKey?: string; language?: string; vocabulary?: string[] };

const loadDictation = (host: HostConnection) => host.call(true, () => host.client.dictation());

function MenuLabel({ text }: { text: string }) {
  return (
    <HStack spacing={4}>
      <Text modifiers={[font({ textStyle: "callout" }), foregroundStyle(Theme.textMuted)]}>{text}</Text>
      <Icon name="chevron.up.chevron.down" textStyle="footnote" weight="medium" color={Theme.textMuted} />
    </HStack>
  );
}

const answers = new Map<string, DictationAnswer>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Shared between the Dictation page and its Vocabulary page, so a save shows on both. */
function publish(hostId: string, answer: DictationAnswer) {
  answers.set(hostId, answer);
  for (const listener of listeners) listener();
}

function useDictation(hostId: string) {
  const load = useHostLoad(hostId, loadDictation);
  const answer = useSyncExternalStore(subscribe, () => answers.get(hostId));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (load.value) publish(hostId, load.value);
  }, [hostId, load.value]);
  const save = async (patch: Patch) => {
    if (!load.host) return;
    const host = load.host;
    setSaving(true);
    load.setError(undefined);
    try {
      publish(hostId, await host.call(false, () => host.client.setDictation(patch)));
    } catch (failure) {
      load.setError(failureText(failure));
    }
    setSaving(false);
  };
  return { dictation: answer?.dictation, error: load.error, saving, save };
}

export function DictationPage({ hostId, onVocabulary }: { hostId: string; onVocabulary: () => void }) {
  const { dictation, error, saving, save } = useDictation(hostId);
  const key = useNativeState("");
  const provider = dictation?.provider ?? "off";
  const locked = !dictation || saving;
  const languageLabel = dictation?.languages.find((option) => option.code === dictation.language)?.label ?? dictation?.language ?? "";
  const terms = dictation?.vocabulary.length ?? 0;
  const submitKey = () => {
    const typed = key.get().trim();
    if (typed) void save({ apiKey: typed }).then(() => key.set(""));
  };

  return (
    <SettingsPage title="Dictation">
      <SettingsGroup label="Speech to text" footer={
          provider === "deepgram"
            ? "Set on this computer; every device that dictates through it uses it. Create a key at console.deepgram.com › API Keys."
            : "Set on this computer; every device that dictates through it uses it."
        } {...(error ? { error } : {})}>
        <CardRow icon={provider === "off" ? "mic.slash" : "waveform"} title="Provider">
          <Menu label={<MenuLabel text={provider === "deepgram" ? "Deepgram" : "Off"} />} modifiers={[disabled(locked)]}>
            <Button label="Off" onPress={() => void save({ provider: "off" })} />
            <Button label="Deepgram" onPress={() => void save({ provider: "deepgram" })} />
          </Menu>
        </CardRow>
        {provider === "deepgram" && dictation ? (
          <>
            <CardDivider />
            <CardRow icon="globe" title="Language">
              <Menu label={<MenuLabel text={languageLabel} />} modifiers={[disabled(locked || dictation.languages.length === 0)]}>
                {dictation.languages.map((option) => (
                  <Button key={option.code} label={option.label} onPress={() => void save({ language: option.code })} />
                ))}
              </Menu>
            </CardRow>
            <CardDivider />
            <CardRow icon="key" title="Deepgram API key">
              {dictation.configured ? <Button label="Remove" onPress={() => void save({ apiKey: "" })} modifiers={[font({ textStyle: "callout" }), foregroundStyle(Theme.red), disabled(saving)]} /> : null}
              <SecureField
                text={key}
                placeholder={dictation.configured ? "Saved" : "Paste a key"}
                modifiers={[multilineTextAlignment("trailing"), font({ textStyle: "callout", design: "monospaced" }), submitLabel("done"), onSubmit(submitKey)]}
              />
            </CardRow>
            <CardDivider />
            <CardValueRow icon="text.book.closed" title="Vocabulary" value={terms === 1 ? "1 term" : `${terms} terms`} onPress={onVocabulary} />
          </>
        ) : null}
      </SettingsGroup>
    </SettingsPage>
  );
}

export function VocabularyPage({ hostId }: { hostId: string }) {
  const { dictation, save } = useDictation(hostId);
  const draft = useNativeState("");
  const saved = dictation?.vocabulary;
  useEffect(() => {
    if (saved) draft.set(saved.join("\n"));
  }, [saved]);
  const commit = () => {
    if (!saved) return;
    const terms = draft.get().split("\n").map((term) => term.trim()).filter(Boolean);
    if (terms.join("\n") !== saved.join("\n")) void save({ vocabulary: terms });
  };
  return (
    <SettingsPage title="Vocabulary">
      <SettingsGroup label="One term per line" footer="Names and jargon Deepgram would not expect. Your projects and branches are already sent.">
        <TextField
          text={draft}
          placeholder={"Kubernetes\nZarigüeya"}
          axis="vertical"
          modifiers={[textFieldStyle("plain"), font({ textStyle: "callout" }), foregroundStyle(Theme.text), padding({ horizontal: 16, vertical: 12 }), onDisappear(commit)]}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
