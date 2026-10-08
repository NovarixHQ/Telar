import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { NativeStackHeaderItem, NativeStackHeaderItemButton, NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useLayoutEffect, useRef } from "react";
import { Alert } from "react-native";
import type { Session } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";
import type { RootStack } from "../../platform/navigation/routes";
import { Theme } from "../../ui";

type Icon = Extract<NonNullable<NativeStackHeaderItemButton["icon"]>, { type: "sfSymbol" }>;
const symbol = (name: Icon["name"]): Icon => ({ type: "sfSymbol", name });

/** The Swift app's session toolbar: an inline title, the panel button and the actions menu. */
export function useSessionHeader(host: HostConnection | undefined, sessionId: string, session: Session | undefined, fallbackTitle: string | undefined, act: (work: () => Promise<unknown>) => void) {
  const navigation = useNavigation<NavigationProp<RootStack>>();
  const title = session?.title || fallbackTitle || "Session";
  const settled = session?.settledOverride === "settled";
  const perform = useRef(act);
  perform.current = act;

  useLayoutEffect(() => {
    const update = (patch: Parameters<HostConnection["client"]["updateSession"]>[1]) => {
      if (host) perform.current(() => host.call(false, () => host.client.updateSession(sessionId, patch)));
    };
    const rename = () =>
      Alert.prompt("Rename session", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Rename", isPreferred: true, onPress: (next?: string) => next?.trim() && update({ title: next.trim() }) }], "plain-text", title);
    const openPanel = (tab?: "diff") => {
      if (host) navigation.navigate("Panel", { hostId: host.hostId, sessionId, ...(tab ? { tab } : {}) });
    };
    const options: NativeStackNavigationOptions = {
      title,
      unstable_headerRightItems: (): NativeStackHeaderItem[] => [
        { type: "button", label: "Panel", icon: symbol("sidebar.trailing"), tintColor: Theme.textMuted, onPress: () => openPanel(), accessibilityLabel: "Panel" },
        {
          type: "menu",
          label: "Session actions",
          icon: symbol("ellipsis.circle"),
          tintColor: Theme.textMuted,
          accessibilityLabel: "Session actions",
          menu: {
            title,
            items: [
              { type: "submenu", label: "Edit", inline: true, items: [{ type: "action", label: "Rename", icon: symbol("pencil"), onPress: rename }] },
              { type: "submenu", label: "Panel", inline: true, items: [{ type: "action", label: "Diff", icon: symbol("plusminus"), onPress: () => openPanel("diff") }] },
              {
                type: "submenu",
                label: "Shelf",
                inline: true,
                items: [settled ? { type: "action", label: "Un-settle", icon: symbol("arrow.uturn.backward"), onPress: () => update({ settledOverride: "active" }) } : { type: "action", label: "Settle", icon: symbol("checkmark"), onPress: () => update({ settledOverride: "settled" }) }],
              },
            ],
          },
        },
      ],
    };
    navigation.setOptions(options);
  }, [navigation, host, sessionId, title, settled]);
}
