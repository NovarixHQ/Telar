// Embeds the vendored marks into src/features/providers/components/connection-icon.tsx; run after re-vendoring.
// `MARKS` is keyed by models.dev connection id, where `opencode` is OpenCode Zen; the app marks are separate (#655).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => {
  const svg = fs.readFileSync(path.join(here, `${name}.svg`), "utf8");
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map((match) => match[0]);
  const dOf = (tag) => /\bd="([^"]+)"/.exec(tag)[1];
  const dim = paths.find((tag) => /\bopacity="/.test(tag));
  const solid = paths.find((tag) => !/\bopacity="/.test(tag));
  return {
    viewBox: /viewBox="([^"]+)"/.exec(svg)[1],
    d: dOf(solid),
    ...(dim ? { dim: dOf(dim), dimOpacity: Number(/\bopacity="([^"]+)"/.exec(dim)[1]) } : {}),
    ...(/fill-rule="evenodd"/.test(svg) ? { fillRule: "evenodd" } : {}),
  };
};
const marks = {
  openai: read("openai"),
  anthropic: read("anthropic"),
  google: read("google"),
  xai: read("xai"),
  meta: read("meta"),
  opencode: read("opencode"),
  "opencode-go": read("opencode-go"),
  "amazon-bedrock": read("amazon-bedrock"),
};

const out = `import { cn } from "@/ui/utils";

// Connection marks are models.dev provider logos (MIT, github.com/sst/models.dev); the app marks are from
// opencode's brand assets and @lobehub/icons-static-svg (MIT). Originals and ATTRIBUTION.md: public/model-providers/.

export type Mark = { viewBox: string; d: string; dim?: string; dimOpacity?: number; fillRule?: "evenodd" };

const MARKS: Record<string, Mark> = ${JSON.stringify(marks, null, 2)};

export const OPENCODE_MARK: Mark = ${JSON.stringify(read("opencode-app"), null, 2)};

export const CURSOR_MARK: Mark = ${JSON.stringify(read("cursor-app"), null, 2)};

const ALIASES: Record<string, string> = { "bedrock-mantle": "amazon-bedrock" };

export function connectionMark(connection: string): Mark | undefined {
  return MARKS[connection] ?? MARKS[ALIASES[connection] ?? ""];
}

export function MarkIcon({ mark, size = 14, className }: { mark: Mark; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={mark.viewBox}
      fill="currentColor"
      fillRule={mark.fillRule}
      shapeRendering="geometricPrecision"
      className={className}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {mark.dim && <path d={mark.dim} opacity={mark.dimOpacity ?? 0.45} />}
      <path d={mark.d} />
    </svg>
  );
}

export function ConnectionIcon({ connection, size = 14, className }: { connection: string; size?: number; className?: string }) {
  const mark = connectionMark(connection);
  if (!mark) {
    return (
      <span
        aria-hidden
        className={cn("inline-flex items-center justify-center rounded-sm border font-mono text-[0.5rem] uppercase", className)}
        style={{ width: size, height: size }}
      >
        {connection.slice(0, 2)}
      </span>
    );
  }
  return <MarkIcon mark={mark} size={size} className={className} />;
}
`;
fs.writeFileSync(path.join(here, "..", "..", "src", "features", "providers", "components", "connection-icon.tsx"), out);
console.log(`connection-icon.tsx written (${out.length} bytes)`);
