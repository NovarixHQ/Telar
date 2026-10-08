import "./mathjax-env";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
// Ranges MathJax would fetch on demand; Metro can't, so the common alphabets are bundled.
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js";

/** A typeset formula: SVG markup sized in ex, with how far it sits below the baseline. */
export type Typeset = { xml: string; width: number; height: number; depth: number };

// The bundled ranges are already imported, so MathJax's on-demand loader can be a synchronous no-op.
mathjax.asyncLoad = () => undefined;
mathjax.asyncIsSynchronous = true;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document("", {
  InputJax: new TeX({ packages: ["base", "ams"] }),
  // MathJax 4 breaks inline maths into one <svg> per line; the transcript wraps it as a single run instead.
  OutputJax: new SVG({ fontCache: "none", fontData: MathJaxNewcmFont, linebreaks: { inline: false } }),
});

const cache = new Map<string, Typeset | null>();
const ex = (value: string | undefined) => Number.parseFloat(value ?? "") || 0;

/** TeX to SVG, or null when MathJax reports an error so the caller can show the source instead. */
export function typeset(tex: string, display: boolean): Typeset | null {
  const key = `${display ? "D" : "I"}${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let result: Typeset | null = null;
  try {
    const svg = adaptor.firstChild(document.convert(tex, { display }));
    const markup = adaptor.outerHTML(svg as never);
    if (!markup.includes("data-mjx-error") && !markup.includes("merror")) {
      const style = adaptor.getAttribute(svg as never, "style") ?? "";
      result = {
        xml: markup,
        width: ex(adaptor.getAttribute(svg as never, "width")),
        height: ex(adaptor.getAttribute(svg as never, "height")),
        depth: -ex(/vertical-align:\s*(-?[\d.]+)ex/.exec(style)?.[1]),
      };
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  return result;
}
