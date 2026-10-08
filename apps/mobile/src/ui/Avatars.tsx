import { Image, Text } from "@expo/ui/swift-ui";
import { accessibilityHidden, accessibilityLabel, aspectRatio, background, clipShape, font, foregroundStyle, frame, resizable, shapes } from "@expo/ui/swift-ui/modifiers";
import type { SymbolName } from "./Icon";
import { hsb, nameHue, nameInitial, telarIconSymbol } from "./marks";
import { faded, Theme } from "./theme";

const initialSize = (size: number) => Math.max(7, Math.round(size * 0.62));

/** A computer's initial in its hashed hue. Callers show it only when more than one computer is paired. */
export function HostMark({ hostId, name, size }: { hostId: string; name: string; size: number }) {
  const hue = nameHue(hostId.toLowerCase());
  return (
    <Text
      modifiers={[
        font({ size: initialSize(size), weight: "semibold" }),
        foregroundStyle(hsb(hue, 0.55, 0.36)),
        frame({ width: size, height: size }),
        background(hsb(hue, 0.55, 0.5, 0.3), shapes.circle()),
        accessibilityLabel(`On ${name}`),
      ]}
    >
      {nameInitial(name)}
    </Text>
  );
}

export type ProjectMark = { name?: string; iconName?: string; iconEmoji?: string; image?: string };

/** A project's symbol, emoji or uploaded image (an image URI), else its initial in its hashed hue. */
export function ProjectAvatar({ name, iconName, iconEmoji, image, size = 16 }: ProjectMark & { size?: number }) {
  const trimmed = name?.trim() ?? "";
  const symbol = telarIconSymbol(iconName);
  if (symbol) return <Image systemName={symbol as SymbolName} modifiers={[font({ size: size * 0.82 }), frame({ width: size, height: size }), accessibilityHidden()]} />;
  if (iconEmoji) return <Text modifiers={[font({ size: Math.round(size * 0.72) }), frame({ width: size, height: size }), accessibilityHidden()]}>{iconEmoji}</Text>;
  if (image) return <Image uiImage={image} modifiers={[resizable(), aspectRatio({ contentMode: "fill" }), frame({ width: size, height: size }), clipShape("roundedRectangle", size / 4), accessibilityHidden()]} />;
  if (!trimmed) {
    return <Image systemName="folder" modifiers={[font({ size: size * 0.75 }), foregroundStyle(faded("textMuted", 0.6)), frame({ width: size, height: size }), accessibilityHidden()]} />;
  }
  const hue = nameHue(trimmed);
  return (
    <Text
      modifiers={[
        font({ size: initialSize(size), weight: "medium" }),
        foregroundStyle(hsb(hue, 0.45, 0.38)),
        frame({ width: size, height: size }),
        background(hsb(hue, 0.45, 0.5, 0.25)),
        clipShape("roundedRectangle", size / 4),
        accessibilityHidden(),
      ]}
    >
      {nameInitial(trimmed)}
    </Text>
  );
}

export function ProviderIcon({ driver, size = 16 }: { driver: string; size?: number }) {
  const box = frame({ width: size, height: size });
  if (driver === "codex") return <Image assetName="ProviderOpenAI" modifiers={[resizable(), aspectRatio({ contentMode: "fit" }), box, foregroundStyle(Theme.text)]} />;
  if (driver === "claude") return <Image assetName="ProviderClaude" modifiers={[resizable(), aspectRatio({ contentMode: "fit" }), box]} />;
  return <Text modifiers={[font({ size: size * 0.65, weight: "semibold" }), box]}>{driver === "opencode" ? "OC" : driver.slice(0, 2).toUpperCase()}</Text>;
}

export function TelarLogo({ size }: { size: number }) {
  return (
    <Image
      assetName="TelarLogo"
      modifiers={[resizable(), aspectRatio({ contentMode: "fit" }), frame({ width: size, height: size }), clipShape("roundedRectangle", size * 0.225), accessibilityHidden()]}
    />
  );
}
