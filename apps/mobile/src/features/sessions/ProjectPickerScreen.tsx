import { Button, Host, HStack, List, Menu, Section, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, contentShape, font, foregroundStyle, lineLimit, listStyle, scrollContentBackground, shapes, truncationMode } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect, useState } from "react";
import type { RootStack } from "../../platform/navigation/routes";
import { Icon, ProjectAvatar, Theme } from "../../ui";
import { hosts, useHosts } from "../hosts";
import { useProjectIcon } from "../projects";
import { pickerSections, showsPath, targetKey, type Target } from "./new-session";
import { newSessionMemory, useTargets } from "./use-targets";

type Navigation = NativeStackNavigationProp<RootStack, "ProjectPicker">;

function TargetRow({ target, detail, selected, onPick }: { target: Target; detail: string | undefined; selected: boolean; onPick: () => void }) {
  const image = useProjectIcon(target.hostId, target.project.id, target.project.icon);
  return (
    <Button onPress={onPick} modifiers={[buttonStyle("plain"), contentShape(shapes.rectangle()), accessibilityLabel(target.project.name)]}>
      <HStack spacing={12}>
        <ProjectAvatar name={target.project.name} iconName={target.project.iconName} iconEmoji={target.project.iconEmoji} image={image} size={27} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ textStyle: "callout", weight: "semibold" }), foregroundStyle(Theme.text)]}>{target.project.name}</Text>
          {detail ? <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(Theme.textMuted), lineLimit(1), truncationMode("middle")]}>{detail}</Text> : null}
        </VStack>
        <Spacer minLength={8} />
        {selected ? <Icon name="checkmark" textStyle="body" color={Theme.accent} /> : null}
      </HStack>
    </Button>
  );
}

/** Which project, on which computer, a new session starts in. */
export function ProjectPickerScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<RouteProp<RootStack, "ProjectPicker">>();
  const { targets, activity, loading, computers } = useTargets();
  const machines = useHosts(hosts).map(({ connection }) => ({ hostId: connection.hostId, name: connection.name }));
  const [query, setQuery] = useState("");
  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: { placeholder: "Search projects", hideWhenScrolling: false, onChangeText: (event) => setQuery(event.nativeEvent.text), onCancelButtonPress: () => setQuery("") },
    });
  }, [navigation]);

  const lastUsed = newSessionMemory.target();
  const sections = pickerSections(targets, activity, lastUsed, query);
  const current = params?.hostId && params.projectId ? targetKey(params.hostId, params.projectId) : undefined;
  const pick = (target: Target) => navigation.popTo("NewSession", { hostId: target.hostId, projectId: target.project.id }, { merge: true });
  const detail = (target: Target, recent: boolean) => [recent && computers > 1 ? target.hostName : undefined, showsPath(target, targets) ? target.project.root : undefined].filter(Boolean).join(" · ") || undefined;
  const add = (hostId: string) => navigation.navigate("AddProject", { hostId, pick: true });

  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[listStyle("insetGrouped"), scrollContentBackground("hidden"), background(Theme.sheet)]}>
        {sections.length === 0 ? <Text modifiers={[foregroundStyle(Theme.textMuted)]}>{loading ? "Loading projects…" : targets.length === 0 ? "No computer reported a project." : "No project matches that."}</Text> : null}
        {sections.map((section) => (
          <Section key={section.title ?? ""} {...(section.title ? { title: section.title } : {})}>
            {section.targets.map((target) => {
              const key = targetKey(target.hostId, target.project.id);
              return <TargetRow key={key} target={target} detail={detail(target, section.title === "Recent")} selected={key === current} onPick={() => pick(target)} />;
            })}
          </Section>
        ))}
        <Section>
          {machines.length > 1 ? (
            <Menu label="Add project…" systemImage="plus.circle">
              {machines.map((machine) => (
                <Button key={machine.hostId} label={machine.name} systemImage="desktopcomputer" onPress={() => add(machine.hostId)} />
              ))}
            </Menu>
          ) : machines[0] ? (
            <Button label="Add project…" systemImage="plus.circle" onPress={() => add(machines[0]!.hostId)} />
          ) : null}
        </Section>
      </List>
    </Host>
  );
}
