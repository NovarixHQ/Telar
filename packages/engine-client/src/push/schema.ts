export type ActivityReport = {
  card: boolean;
  blocker?: "off" | "no-start-token";
  lastStart?: { at: number; status: number; reason?: string; relay?: boolean; token?: string };
};
