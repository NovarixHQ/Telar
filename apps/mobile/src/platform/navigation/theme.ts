import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from "@react-navigation/native";
import { palette } from "../../ui";

/** The navigation chrome in the Swift palette: sheet backgrounds, card bars, indigo tint. */
export function navigationTheme(scheme: "light" | "dark"): NavigationTheme {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const pick = (name: keyof typeof palette) => palette[name][scheme];
  return {
    ...base,
    colors: { ...base.colors, primary: pick("accent"), background: pick("sheet"), card: pick("sheet"), text: pick("text"), border: pick("border"), notification: pick("red") },
  };
}
