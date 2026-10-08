import { ContentUnavailableView, Host } from "@expo/ui/swift-ui";
import { useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStack } from "./routes";

/** Placeholder for a sheet the phone does not have yet. */
export function Unavailable() {
  const { params } = useRoute<RouteProp<RootStack, "Unavailable">>();
  return (
    <Host style={{ flex: 1 }}>
      <ContentUnavailableView title={params.title} systemImage={params.systemImage} description="Not available on the phone yet." />
    </Host>
  );
}
