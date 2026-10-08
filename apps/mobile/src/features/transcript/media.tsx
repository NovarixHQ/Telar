import { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { palette, Theme } from "../../ui";
import { typeset } from "./math";
import { MONO } from "./native";

// MathJax sizes in ex of its New Computer Modern font; Swift draws display maths at 18pt and inline at 15pt.
const EX_PER_EM = 0.442;

/** A TeX formula drawn natively; when MathJax can't typeset it, its source in mono. */
export function MathView({ tex, display }: { tex: string; display: boolean }) {
  const dark = useColorScheme() === "dark";
  const set = useMemo(() => typeset(tex, display), [tex, display]);
  if (!set) return <Text style={styles.source}>{`$$${tex}$$`}</Text>;
  const ex = (display ? 18 : 15) * EX_PER_EM;
  const svg = <SvgXml xml={set.xml.replaceAll("currentColor", dark ? palette.text.dark : palette.text.light)} width={set.width * ex} height={set.height * ex} accessibilityLabel={tex} />;
  if (!display) return <View style={{ transform: [{ translateY: set.depth * ex }] }}>{svg}</View>;
  return <View style={styles.display}>{svg}</View>;
}

/** A remote image in a reply, as wide as the column at its own aspect ratio. */
export function MarkdownImage({ uri, alt }: { uri: string; alt: string }) {
  const [ratio, setRatio] = useState<number>();
  useEffect(() => {
    if (!/^https?:/.test(uri)) return;
    Image.getSize(uri, (width, height) => height > 0 && setRatio(width / height), () => setRatio(undefined));
  }, [uri]);
  if (!/^https?:/.test(uri) || !ratio) return null;
  return <Image source={{ uri }} style={[styles.image, { aspectRatio: ratio }]} resizeMode="contain" accessibilityLabel={alt} />;
}

const styles = StyleSheet.create({
  source: { fontFamily: MONO, fontSize: 12, color: Theme.textMuted },
  display: { alignItems: "center" },
  image: { width: "100%" },
});
