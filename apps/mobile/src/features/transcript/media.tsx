import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { palette, Theme } from "../../ui";
import { mathScale, typeset } from "./math";
import { MONO } from "./native";

/** A TeX formula drawn natively; when MathJax can't typeset it, its source in mono. */
export function MathView({ tex, display, size = 15 }: { tex: string; display: boolean; size?: number }) {
  const dark = useColorScheme() === "dark";
  const { fontScale } = useWindowDimensions();
  const [room, setRoom] = useState(0);
  const set = useMemo(() => typeset(tex, display), [tex, display]);
  if (!set) return <Text style={styles.source}>{`$$${tex}$$`}</Text>;
  const ex = mathScale(size, display, fontScale);
  const width = set.width * ex;
  const svg = <SvgXml xml={set.xml.replaceAll("currentColor", dark ? palette.text.dark : palette.text.light)} width={width} height={set.height * ex} accessibilityLabel={tex} />;
  if (!display) return <View style={{ transform: [{ translateY: set.depth * ex }] }}>{svg}</View>;
  return (
    <View onLayout={({ nativeEvent }) => setRoom(nativeEvent.layout.width)}>
      {room > 0 && width > room ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {svg}
        </ScrollView>
      ) : (
        <View style={styles.display}>{svg}</View>
      )}
    </View>
  );
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
