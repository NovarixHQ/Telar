import { RoutedCockpit } from "@/features/sessions/cockpit";

export const generateStaticParams = () => [{ projectId: "_" }];

export default function Page() {
  return <RoutedCockpit />;
}
