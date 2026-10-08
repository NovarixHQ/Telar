import { Fragment, memo, useMemo, type ReactNode } from "react";
import { DynamicColorIOS, Linking, ScrollView, StyleSheet, Text, View, type ColorValue, type TextStyle } from "react-native";
import type { Tokens } from "marked";
import { fencedLanguage, highlightCode, markdownBlocks, type Token } from "./markdown-blocks";
import { faded, Radius, Theme } from "../../ui";
import { copyAction, LongPressMenu } from "./chrome";
import { MarkdownImage, MathView } from "./media";
import { MONO, Symbol } from "./native";

const SIZE = 15;
const HEADINGS: Record<number, { scale: number; top: number; bottom: number; muted?: boolean }> = {
  1: { scale: 1.4, top: 16, bottom: 8 },
  2: { scale: 1.2, top: 14, bottom: 6 },
  3: { scale: 1.05, top: 12, bottom: 4 },
  4: { scale: 1, top: 10, bottom: 4 },
  5: { scale: 0.9, top: 8, bottom: 4 },
  6: { scale: 0.85, top: 8, bottom: 4, muted: true },
};

// atom-one-light / atom-one-dark, the themes the Swift app highlights with.
const tone = (light: string, dark: string) => DynamicColorIOS({ light, dark });
const SYNTAX: Record<string, ColorValue> = {
  comment: tone("#A0A1A7", "#5C6370"), quote: tone("#A0A1A7", "#5C6370"),
  keyword: tone("#A626A4", "#C678DD"), doctag: tone("#A626A4", "#C678DD"), formula: tone("#A626A4", "#C678DD"),
  section: tone("#E45649", "#E06C75"), name: tone("#E45649", "#E06C75"), "selector-tag": tone("#E45649", "#E06C75"), deletion: tone("#E45649", "#E06C75"), subst: tone("#E45649", "#E06C75"),
  literal: tone("#0184BB", "#56B6C2"),
  string: tone("#50A14F", "#98C379"), regexp: tone("#50A14F", "#98C379"), addition: tone("#50A14F", "#98C379"), attribute: tone("#50A14F", "#98C379"),
  attr: tone("#986801", "#D19A66"), variable: tone("#986801", "#D19A66"), "template-variable": tone("#986801", "#D19A66"), type: tone("#986801", "#D19A66"), number: tone("#986801", "#D19A66"), "selector-class": tone("#986801", "#D19A66"), "selector-attr": tone("#986801", "#D19A66"), "selector-pseudo": tone("#986801", "#D19A66"),
  symbol: tone("#4078F2", "#61AEEF"), bullet: tone("#4078F2", "#61AEEF"), link: tone("#4078F2", "#61AEEF"), meta: tone("#4078F2", "#61AEEF"), "selector-id": tone("#4078F2", "#61AEEF"), title: tone("#4078F2", "#61AEEF"),
  built_in: tone("#C18401", "#E6C07B"), "title class_": tone("#C18401", "#E6C07B"),
};
const SYNTAX_BASE = tone("#383A42", "#ABB2BF");
const syntaxColor = (scope: string) => SYNTAX[scope] ?? SYNTAX[scope.split(" ")[0]!] ?? SYNTAX_BASE;

function inline(tokens: readonly Token[] | undefined, key = ""): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const id = `${key}${index}`;
    switch (token.type) {
      case "text":
        return token.tokens ? <Fragment key={id}>{inline(token.tokens, `${id}.`)}</Fragment> : token.text;
      case "strong":
        return <Text key={id} style={styles.strong}>{inline(token.tokens, `${id}.`)}</Text>;
      case "em":
        return <Text key={id} style={styles.em}>{inline(token.tokens, `${id}.`)}</Text>;
      case "del":
        return <Text key={id} style={styles.del}>{inline(token.tokens, `${id}.`)}</Text>;
      case "codespan":
        return <Text key={id} style={styles.codespan}>{token.text}</Text>;
      case "link":
        return <Text key={id} style={styles.link} onPress={() => void Linking.openURL(token.href)}>{inline(token.tokens, `${id}.`)}</Text>;
      case "image":
        return <Text key={id} style={styles.link} onPress={() => void Linking.openURL(token.href)}>{token.text || token.href}</Text>;
      case "br":
        return "\n";
      case "checkbox":
        return null;
      case "mathInline":
        return <MathView key={id} tex={token.text as string} display={false} />;
      default:
        return "text" in token && typeof token.text === "string" ? token.text : token.raw;
    }
  });
}

type Margin = { top: number; bottom: number };

function marginOf(token: Token): Margin {
  if (token.type === "heading") return HEADINGS[token.depth] ?? HEADINGS[6]!;
  if (token.type === "hr") return { top: 14, bottom: 14 };
  if (token.type === "text") return { top: 0, bottom: 0 };
  return { top: 0, bottom: 10 };
}

function Paragraph({ tokens, style }: { tokens: readonly Token[] | undefined; style?: TextStyle }) {
  return <Text selectable style={[styles.paragraph, style]}>{inline(tokens)}</Text>;
}

function CodeBlock({ token }: { token: Tokens.Code }) {
  const language = fencedLanguage(token.lang);
  const spans = useMemo(() => highlightCode(token.text, language), [token.text, language]);
  return (
    <LongPressMenu actions={[copyAction("Copy", token.text)]}>
      <View style={styles.codeBlock}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codePad}>
          <Text selectable style={[styles.code, !language && styles.codePlain]}>
            {spans.map((span, index) => (span.scope ? <Text key={index} style={{ color: syntaxColor(span.scope) }}>{span.text}</Text> : span.text))}
          </Text>
        </ScrollView>
      </View>
    </LongPressMenu>
  );
}

function Table({ token }: { token: Tokens.Table }) {
  const columns = token.header.map((head, column) => [head, ...token.rows.map((row) => row[column])]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={styles.table}>
        {columns.map((cells, column) => (
          <View key={column} style={column > 0 && styles.tableColumn}>
            {cells.map((cell, row) => (
              <View key={row} style={[styles.cell, row > 0 && styles.cellRule, row > 0 && row % 2 === 0 && styles.cellStripe]}>
                <Text selectable numberOfLines={1} style={[styles.cellText, row === 0 && styles.strong]}>{inline(cell?.tokens)}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function List({ token, muted }: { token: Tokens.List; muted: boolean }) {
  const start = typeof token.start === "number" ? token.start : 1;
  return (
    <View style={styles.list}>
      {token.items.map((item, index) => (
        <View key={index} style={styles.listItem}>
          <View style={styles.marker}>
            {item.task ? (
              <Symbol name={item.checked ? "checkmark.square.fill" : "square"} size={SIZE} color={item.checked ? Theme.accent : Theme.textMuted} />
            ) : (
              token.ordered ? <Text style={[styles.paragraph, muted && styles.muted]}>{`${start + index}.`}</Text> : <View style={[styles.bullet, muted && styles.bulletMuted]} />
            )}
          </View>
          <View style={styles.itemBody}>
            <Blocks tokens={item.tokens} muted={muted} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Block({ token, muted }: { token: Token; muted: boolean }) {
  const tint = muted ? styles.muted : undefined;
  switch (token.type) {
    case "paragraph":
      if (token.tokens?.length && token.tokens.every((part) => part.type === "image" || (part.type === "text" && !part.raw.trim()))) {
        return token.tokens.map((part, index) => (part.type === "image" ? <MarkdownImage key={index} uri={part.href as string} alt={part.text as string} /> : null));
      }
      return <Paragraph tokens={token.tokens} {...(tint ? { style: tint } : {})} />;
    case "mathBlock":
      return <MathView tex={token.text as string} display />;
    case "text":
      return <Paragraph tokens={token.tokens ?? [{ type: "text", raw: token.raw, text: token.text }]} {...(tint ? { style: tint } : {})} />;
    case "heading": {
      const heading = HEADINGS[token.depth] ?? HEADINGS[6]!;
      return <Paragraph tokens={token.tokens} style={{ fontSize: SIZE * heading.scale, lineHeight: SIZE * heading.scale * 1.25, fontWeight: "600", ...(heading.muted || muted ? { color: Theme.textMuted } : {}) }} />;
    }
    case "code":
      return <CodeBlock token={token as Tokens.Code} />;
    case "blockquote":
      return (
        <View style={styles.quote}>
          <View style={styles.quoteBar} />
          <View style={styles.quoteBody}>
            <Blocks tokens={token.tokens ?? []} muted />
          </View>
        </View>
      );
    case "list":
      return <List token={token as Tokens.List} muted={muted} />;
    case "table":
      return <Table token={token as Tokens.Table} />;
    case "hr":
      return <View style={styles.rule} />;
    case "html":
      return <Paragraph tokens={[{ type: "text", raw: token.raw, text: token.raw.trim() }]} {...(tint ? { style: tint } : {})} />;
    default:
      return null;
  }
}

function Blocks({ tokens, muted = false }: { tokens: readonly Token[]; muted?: boolean }) {
  const blocks = tokens.filter((token) => token.type !== "space" && token.type !== "def" && token.type !== "checkbox");
  return blocks.map((token, index) => {
    const previous = index > 0 ? marginOf(blocks[index - 1]!) : undefined;
    const gap = previous ? Math.max(previous.bottom, marginOf(token).top) : 0;
    return (
      <View key={index} style={gap ? { marginTop: gap } : undefined}>
        <Block token={token} muted={muted} />
      </View>
    );
  });
}

/** An agent's words: GFM at 15pt in the Swift app's MarkdownUI theme. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tokens = useMemo(() => markdownBlocks(text), [text]);
  return (
    <View>
      <Blocks tokens={tokens} />
    </View>
  );
});

const styles = StyleSheet.create({
  // MarkdownUI adds 0.3em between lines only; the negative margin takes it off a lone line.
  paragraph: { fontSize: SIZE, lineHeight: SIZE * 1.5, marginVertical: -SIZE * 0.15, color: Theme.text },
  muted: { color: Theme.textMuted },
  strong: { fontWeight: "600" },
  em: { fontStyle: "italic" },
  del: { textDecorationLine: "line-through" },
  link: { color: Theme.accent },
  codespan: { fontFamily: MONO, fontSize: SIZE * 0.88, backgroundColor: Theme.codeBackground },
  codeBlock: { backgroundColor: Theme.codeBackground, borderRadius: Radius.row, borderWidth: 1, borderColor: faded("border", 0.6), overflow: "hidden" },
  codePad: { padding: 10 },
  code: { fontFamily: MONO, fontSize: 13, color: SYNTAX_BASE },
  codePlain: { color: Theme.text, lineHeight: 13 * 1.4 },
  quote: { flexDirection: "row" },
  quoteBar: { width: 3, borderRadius: 2, backgroundColor: Theme.border },
  quoteBody: { flex: 1, paddingLeft: 12 },
  list: { gap: SIZE * 0.2 },
  listItem: { flexDirection: "row", paddingLeft: 8 },
  marker: { width: 24, alignItems: "center" },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: Theme.text },
  bulletMuted: { backgroundColor: Theme.textMuted },
  itemBody: { flex: 1 },
  tableScroll: { flexGrow: 0 },
  table: { flexDirection: "row", borderWidth: 1, borderColor: Theme.border },
  tableColumn: { borderLeftWidth: 1, borderColor: Theme.border },
  cell: { paddingVertical: 5, paddingHorizontal: 10 },
  cellRule: { borderTopWidth: 1, borderColor: Theme.border },
  cellStripe: { backgroundColor: Theme.subtle },
  cellText: { fontSize: SIZE * 0.92, color: Theme.text },
  rule: { height: 1, backgroundColor: Theme.border },
});
