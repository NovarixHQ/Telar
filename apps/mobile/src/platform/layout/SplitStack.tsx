import {
  createNavigatorFactory,
  StackRouter,
  useNavigationBuilder,
  type ParamListBase,
  type StackActionHelpers,
  type StackNavigationState,
  type StackRouterOptions,
  type StaticConfig,
  type TypedNavigator,
} from "@react-navigation/native";
import {
  NativeStackView,
  type NativeStackHeaderItem,
  type NativeStackNavigationEventMap,
  type NativeStackNavigationOptions,
  type NativeStackNavigatorProps,
  type NativeStackTypeBag,
} from "@react-navigation/native-stack";
import { useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, PlatformColor, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Theme, type SymbolName } from "../../ui";
import { isRegularWidth } from "./size-class";
import { selectionBase, SIDEBAR_WIDTH, splitColumns } from "./split";
import { SplitColumnContext, type SplitColumn } from "./split-column";

type State = StackNavigationState<ParamListBase>;
type Descriptors = ReturnType<typeof useNavigationBuilder<State, SplitOptions, StackActionHelpers<ParamListBase>, NativeStackNavigationOptions, NativeStackNavigationEventMap>>["descriptors"];
type SplitOptions = StackRouterOptions & { selection: readonly string[] };
type Props = NativeStackNavigatorProps & {
  /** Routes that, opened from the sidebar, replace the detail column. */
  selection: readonly string[];
  /** Drawn in the detail column while nothing is chosen. */
  placeholder: ReactNode;
};
type Side = "unstable_headerLeftItems" | "unstable_headerRightItems";

const SHEETS = new Set<NativeStackNavigationOptions["presentation"]>(["modal", "transparentModal", "containedModal", "containedTransparentModal", "fullScreenModal", "formSheet", "pageSheet"]);

function SplitRouter({ selection, ...options }: SplitOptions): ReturnType<typeof StackRouter> {
  const router = StackRouter(options);
  return { ...router, getStateForAction: (state, action, config) => router.getStateForAction(selectionBase(state, action, selection), action, config) };
}

function sidebarButton(label: string, onPress: () => void): NativeStackHeaderItem {
  return { type: "button", label, icon: { type: "sfSymbol", name: "sidebar.left" satisfies SymbolName }, tintColor: Theme.text, onPress };
}

/** The descriptors with one more toolbar button on a route: a separate glass group at the outer end, as Swift's sidebar toggle sits. */
function withButton(descriptors: Descriptors, key: string | undefined, side: Side, item: NativeStackHeaderItem): Descriptors {
  const descriptor = key ? descriptors[key] : undefined;
  if (!key || !descriptor) return descriptors;
  const own = descriptor.options[side];
  const items: NativeStackNavigationOptions[Side] = (props) => {
    const current = own?.(props) ?? [];
    const gap: NativeStackHeaderItem[] = current.length ? [{ type: "spacing", spacing: 8 }] : [];
    return side === "unstable_headerRightItems" ? [...current, ...gap, item] : [item, ...gap, ...current];
  };
  return { ...descriptors, [key]: { ...descriptor, options: { ...descriptor.options, [side]: items } } };
}

/** A native stack that, at regular width, pins its first route as a 300pt sidebar beside the rest, like a balanced NavigationSplitView. */
function SplitStackNavigator({ id, initialRouteName, children, layout, screenListeners, screenOptions, screenLayout, selection, placeholder }: Props) {
  const { state, describe, descriptors, navigation, render } = useNavigationBuilder<State, SplitOptions, StackActionHelpers<ParamListBase>, NativeStackNavigationOptions, NativeStackNavigationEventMap>(SplitRouter, {
    id,
    initialRouteName,
    children,
    layout,
    screenListeners,
    screenOptions,
    screenLayout,
    selection,
  });
  const { width } = useWindowDimensions();
  const [hidden, setHidden] = useState(false);
  const shown = useRef(new Animated.Value(1)).current;
  const setSidebarHidden = (next: boolean) => {
    if (next === hidden) return;
    setHidden(next);
    Animated.timing(shown, { toValue: next ? 0 : 1, duration: 280, easing: Easing.inOut(Easing.ease), useNativeDriver: false }).start();
  };
  const stack = (slice: State, shown: Descriptors) => <NativeStackView state={slice} navigation={navigation} descriptors={shown} describe={describe} />;

  if (!isRegularWidth(width, Platform.OS === "ios" && Platform.isPad) || state.routes[0]?.name !== initialRouteName) return render(stack(state, descriptors));
  const { sidebar, detail } = splitColumns(state, (route) => SHEETS.has(descriptors[route.key]?.options.presentation ?? "card"));
  const chosen = detail?.routes[0];
  const column: SplitColumn = {
    sidebar: false,
    sidebarHidden: hidden,
    showSidebar: () => setSidebarHidden(false),
    setSidebarHidden,
    ...(chosen && selection.includes(chosen.name) && chosen.params ? { selected: chosen.params } : {}),
  };
  const toggled = hidden
    ? withButton(descriptors, chosen?.key, "unstable_headerLeftItems", sidebarButton("Show Sidebar", () => setSidebarHidden(false)))
    : withButton(descriptors, sidebar.routes[0]?.key, "unstable_headerRightItems", sidebarButton("Hide Sidebar", () => setSidebarHidden(true)));
  return render(
    <SplitColumnContext.Provider value={column}>
      <View style={styles.row}>
        <Animated.View style={[styles.clip, { width: shown.interpolate({ inputRange: [0, 1], outputRange: [0, SIDEBAR_WIDTH] }) }]}>
          <Animated.View style={[styles.sidebar, { transform: [{ translateX: shown.interpolate({ inputRange: [0, 1], outputRange: [-SIDEBAR_WIDTH, 0] }) }] }]}>
            <SplitColumnContext.Provider value={{ ...column, sidebar: true }}>{stack({ ...sidebar, preloadedRoutes: [] }, toggled)}</SplitColumnContext.Provider>
          </Animated.View>
        </Animated.View>
        <View style={styles.detail}>{detail ? stack(detail, toggled) : <SafeAreaProvider>{placeholder}</SafeAreaProvider>}</View>
      </View>
    </SplitColumnContext.Provider>,
  );
}

type SplitTypeBag<ParamList extends ParamListBase> = Omit<NativeStackTypeBag<ParamList>, "Navigator"> & { Navigator: typeof SplitStackNavigator };

export function createSplitStackNavigator<const ParamList extends ParamListBase>(): TypedNavigator<SplitTypeBag<ParamList>, StaticConfig<SplitTypeBag<ParamList>>> {
  return createNavigatorFactory(SplitStackNavigator)();
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  clip: { overflow: "hidden" },
  sidebar: { width: SIDEBAR_WIDTH, flex: 1 },
  detail: { flex: 1, backgroundColor: PlatformColor("systemBackground") },
});
