import { Image } from "@expo/ui/swift-ui";
import { buttonStyle, clipShape, contentShape, font, foregroundStyle, shapes, type ModifierConfig } from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { Radius } from "./theme";

export type SymbolName = NonNullable<ComponentProps<typeof Image>["systemName"]>;
type TextStyle = NonNullable<Parameters<typeof font>[0]["textStyle"]>;
type Weight = NonNullable<Parameters<typeof font>[0]["weight"]>;

/** An SF Symbol. A `textStyle` makes it scale with Dynamic Type; a `size` pins it in points. */
export function Icon({ name, size, textStyle, weight, color, modifiers = [] }: { name: SymbolName; size?: number; textStyle?: TextStyle; weight?: Weight; color?: ColorValue; modifiers?: ModifierConfig[] }) {
  const sizing = textStyle ? font({ textStyle, ...(weight ? { weight } : {}) }) : font({ size: size ?? 17, ...(weight ? { weight } : {}) });
  return <Image systemName={name} modifiers={[sizing, ...(color ? [foregroundStyle(color)] : []), ...modifiers]} />;
}

/** Swift's RowButtonStyle: a plain button whose whole row is tappable, clipped to the row radius. */
export const rowButton: ModifierConfig[] = [buttonStyle("plain"), contentShape(shapes.rectangle()), clipShape("roundedRectangle", Radius.row)];
