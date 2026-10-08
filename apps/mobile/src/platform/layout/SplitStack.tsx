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
import { NativeStackView, type NativeStackNavigationEventMap, type NativeStackNavigationOptions, type NativeStackNavigatorProps, type NativeStackTypeBag } from "@react-navigation/native-stack";
import type { ReactNode } from "react";
import { Platform, PlatformColor, StyleSheet, useWindowDimensions, View } from "react-native";
import { isRegularWidth, selectionBase, SIDEBAR_WIDTH, splitColumns } from "./split";

type State = StackNavigationState<ParamListBase>;
type SplitOptions = StackRouterOptions & { selection: readonly string[] };
type Props = NativeStackNavigatorProps & {
  /** Routes that, opened from the sidebar, replace the detail column. */
  selection: readonly string[];
  /** Drawn in the detail column while nothing is chosen. */
  placeholder: ReactNode;
};

function SplitRouter({ selection, ...options }: SplitOptions): ReturnType<typeof StackRouter> {
  const router = StackRouter(options);
  return { ...router, getStateForAction: (state, action, config) => router.getStateForAction(selectionBase(state, action, selection), action, config) };
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
  const stack = (slice: State) => <NativeStackView state={slice} navigation={navigation} descriptors={descriptors} describe={describe} />;

  if (!isRegularWidth(width, Platform.OS === "ios" && Platform.isPad) || state.routes[0]?.name !== initialRouteName) return render(stack(state));
  const { sidebar, detail } = splitColumns(state);
  return render(
    <View style={styles.row}>
      <View style={styles.sidebar}>{stack({ ...sidebar, preloadedRoutes: [] })}</View>
      <View style={styles.detail}>{detail ? stack(detail) : placeholder}</View>
    </View>,
  );
}

type SplitTypeBag<ParamList extends ParamListBase> = Omit<NativeStackTypeBag<ParamList>, "Navigator"> & { Navigator: typeof SplitStackNavigator };

export function createSplitStackNavigator<const ParamList extends ParamListBase>(): TypedNavigator<SplitTypeBag<ParamList>, StaticConfig<SplitTypeBag<ParamList>>> {
  return createNavigatorFactory(SplitStackNavigator)();
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  sidebar: { width: SIDEBAR_WIDTH },
  detail: { flex: 1, backgroundColor: PlatformColor("systemBackground") },
});
