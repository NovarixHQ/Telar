import { RoutedCockpit } from "@/features/sessions/cockpit";

export const generateStaticParams = () => [{ hostId: "_", projectId: "_" }];

export default function Page() {
  return <RoutedCockpit />;
}
