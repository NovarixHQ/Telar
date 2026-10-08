import { VStack } from "@expo/ui/swift-ui";
import { background, clipShape, frame, padding, strokeBorder } from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { faded, Radius, Theme, type ThemeColor } from "./theme";

/** A card tinted 6% by a status colour, for banners like "connection lost" or a parked request. */
export function StatusCard({ tint, spacing, children }: { tint: ThemeColor; spacing?: number; children: ReactNode }) {
  return (
    <VStack
      alignment="leading"
      {...(spacing === undefined ? {} : { spacing })}
      modifiers={[
        padding({ horizontal: 14, vertical: 12 }),
        frame({ maxWidth: Infinity, alignment: "leading" }),
        background(faded(tint, 0.06)),
        background(Theme.card),
        clipShape("roundedRectangle", Radius.statusCard),
        strokeBorder({ color: Theme.border, style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.statusCard }),
      ]}
    >
      {children}
    </VStack>
  );
}
