type Pair = { light: string; dark: string };

/** Atom One Light and Dark, the themes the Swift app's highlighter wears. */
export const atomOne = {
  base: { light: "#383A42", dark: "#ABB2BF" },
  comment: { light: "#A0A1A7", dark: "#5C6370" },
  keyword: { light: "#A626A4", dark: "#C678DD" },
  tag: { light: "#E45649", dark: "#E06C75" },
  literal: { light: "#0184BB", dark: "#56B6C2" },
  string: { light: "#50A14F", dark: "#98C379" },
  number: { light: "#986801", dark: "#D19A66" },
  title: { light: "#4078F2", dark: "#61AEEE" },
  builtIn: { light: "#C18401", dark: "#E6C07B" },
} satisfies Record<string, Pair>;

type Colour = keyof typeof atomOne;

const SCOPE: Record<string, Colour> = {
  comment: "comment", quote: "comment",
  doctag: "keyword", keyword: "keyword", formula: "keyword",
  section: "tag", name: "tag", "selector-tag": "tag", deletion: "tag", subst: "tag",
  literal: "literal",
  string: "string", regexp: "string", addition: "string", attribute: "string",
  attr: "number", variable: "number", "template-variable": "number", type: "number", "selector-class": "number", "selector-attr": "number", "selector-pseudo": "number", number: "number",
  symbol: "title", bullet: "title", link: "title", meta: "title", "selector-id": "title", title: "title",
  built_in: "builtIn",
};

export type SyntaxStyle = { colour: Colour; italic: boolean; bold: boolean };

/** The style of a run inside these class lists (innermost last), resolved as the theme's CSS cascades. */
export function syntaxStyle(scopes: string[]): SyntaxStyle {
  const levels = scopes.map((level) => level.split(" ").map((name) => name.replace(/^hljs-/, "")));
  let colour: Colour = "base";
  for (let index = levels.length - 1; index >= 0; index--) {
    const [main = "", ...rest] = levels[index]!;
    const inClass = levels.slice(0, index).some((outer) => outer[0] === "class");
    const found = main === "title" && (rest.includes("class_") || inClass) ? "builtIn" : SCOPE[main];
    if (found) {
      colour = found;
      break;
    }
  }
  const has = (name: string) => levels.some((level) => level[0] === name);
  return { colour, italic: has("comment") || has("quote") || has("emphasis"), bold: has("strong") };
}
