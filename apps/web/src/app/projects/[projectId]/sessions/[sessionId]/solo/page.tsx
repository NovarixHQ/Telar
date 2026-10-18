import { RoutedCockpit } from "@/features/sessions/cockpit";

export const generateStaticParams = () => [{ projectId: "_", sessionId: "_" }];

export default function Page() {
  return <RoutedCockpit />;
}
