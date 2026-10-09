import { Button, Label, Menu, Section, Text } from "@expo/ui/swift-ui";
import { disabled } from "@expo/ui/swift-ui/modifiers";
import type { ProviderDriverKind, RuntimeMode, Session } from "@telar/engine-client";
import { choiceOf, type ModelChoice } from "@telar/client/providers";
import type { HostConnection } from "../../platform/connection";
import { setAccessMode, setSessionModel } from "./actions";
import { useModelCatalogue, useProviderInstances } from "./catalogue";
import { accessMenu, modelMenu, providerFamilies, type MenuOption, type ModelMenu } from "./model-menu";

type Props = { host: HostConnection; session: Session; onChanged: (work: Promise<unknown>) => void };

function Option({ option, onPick }: { option: Pick<MenuOption, "label" | "subtitle" | "selected">; onPick: () => void }) {
  const check = option.selected ? ({ systemImage: "checkmark" } as const) : {};
  if (!option.subtitle) return <Button label={option.label} onPress={onPick} {...check} />;
  return (
    <Button onPress={onPick}>
      {option.selected ? <Label title={option.label} systemImage="checkmark" /> : <Text>{option.label}</Text>}
      <Text>{option.subtitle}</Text>
    </Button>
  );
}

const PROVIDERS: { driver: ProviderDriverKind; title: string }[] = [
  { driver: "claude", title: "Claude" },
  { driver: "codex", title: "Codex" },
  { driver: "opencode", title: "OpenCode" },
];

/** What the menus show as chosen: a session's model and access, or a new session's picks so far. */
type Current = { driver: ProviderDriverKind; instanceId: string | undefined; choice: ModelChoice; runtimeMode: RuntimeMode | undefined };
type Choose = (next: ModelChoice, instanceId: string, driver: ProviderDriverKind) => void;

type SectionProps = { host: HostConnection; current: Current; driver: ProviderDriverKind; title: string; menu: ModelMenu | undefined; choose: Choose };

/** One provider's families; a family on another provider switches to it. */
function ProviderSection({ host, current, driver, title, menu, choose }: SectionProps) {
  const own = driver === current.driver;
  const instances = useProviderInstances(host);
  const instanceId = own && current.instanceId ? current.instanceId : instances?.find((instance) => instance.enabled && instance.driver === driver)?.id;
  const models = useModelCatalogue(host, driver, own ? undefined : instanceId);
  if (!instanceId) return null;
  const options = own ? menu?.families : models && providerFamilies(models, current.choice, menu?.window ?? "standard", driver);
  return (
    <Section title={title}>
      {options ? options.map((option) => <Option key={option.key} option={option} onPick={() => choose(option.choice, instanceId, driver)} />) : <Button label="Loading models…" modifiers={[disabled(true)]} />}
    </Section>
  );
}

function ModelMenus({ host, current, choose, pickAccess }: { host: HostConnection; current: Current; choose: Choose; pickAccess: (mode: RuntimeMode) => void }) {
  const models = useModelCatalogue(host, current.driver, current.instanceId);
  const menu = models ? modelMenu(models, current.choice, current.driver) : undefined;
  const access = accessMenu(current.runtimeMode);
  return (
    <>
      <Menu label={menu?.label ?? "Model"} systemImage="cpu">
        {PROVIDERS.map(({ driver, title }) => (
          <ProviderSection key={driver} host={host} current={current} driver={driver} title={title} menu={menu} choose={choose} />
        ))}
        {(menu?.sections ?? []).map((section) => (
          <Section key={section.title} title={section.title}>
            {section.options.map((option) => (
              <Option key={option.key} option={option} onPick={() => current.instanceId && choose(option.choice, current.instanceId, current.driver)} />
            ))}
          </Section>
        ))}
      </Menu>
      <Menu label={access.label} systemImage="slider.horizontal.3">
        {access.options.map((option) => (
          <Option key={option.value} option={option} onPick={() => option.value !== current.runtimeMode && pickAccess(option.value)} />
        ))}
      </Menu>
    </>
  );
}

/** The model and access menus the composer's plus button carries, as native SwiftUI submenus. */
export function SessionMenus({ host, session, onChanged }: Props) {
  const current = { driver: session.driver, instanceId: session.providerInstanceId, choice: choiceOf(session.model), runtimeMode: session.runtimeMode };
  return (
    <ModelMenus
      host={host}
      current={current}
      choose={(next, instanceId) => onChanged(setSessionModel(host, session.id, instanceId, next))}
      pickAccess={(mode) => onChanged(setAccessMode(host, session.id, mode))}
    />
  );
}

export type DraftPicks = { driver: ProviderDriverKind; choice?: ModelChoice; runtimeMode?: RuntimeMode };

/** The same menus for a session not made yet: picks are held until it is created. */
export function DraftMenus({ host, picks, onPicks }: { host: HostConnection; picks: DraftPicks; onPicks: (next: DraftPicks) => void }) {
  const instances = useProviderInstances(host);
  const instanceId = instances?.find((instance) => instance.enabled && instance.driver === picks.driver)?.id;
  const current = { driver: picks.driver, instanceId, choice: picks.choice ?? {}, runtimeMode: picks.runtimeMode };
  return (
    <ModelMenus
      host={host}
      current={current}
      choose={(choice, _instanceId, driver) => onPicks({ ...picks, driver, choice })}
      pickAccess={(runtimeMode) => onPicks({ ...picks, runtimeMode })}
    />
  );
}
