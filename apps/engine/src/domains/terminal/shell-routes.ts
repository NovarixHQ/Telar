import { z } from "zod";
import { HttpError } from "../../platform/http/http";
import { ok, type Route } from "../../platform/http/route";
import { holdEventStream, type OpenStream } from "../sessions";
import { readKittyImageFile } from "./kitty-image-file";
import type { ShellHub } from "./shells";

const Open = z.object({
  shell: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1).optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  sessionId: z.string().min(1).optional(),
  title: z.string().optional(),
});
const Ids = z.object({ ids: z.array(z.string()).optional() });
const Resize = z.object({ cols: z.number().int().positive(), rows: z.number().int().positive() });
const Kill = z.object({ signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL", "SIGHUP"]).optional() });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new HttpError(400, "invalid_request", issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "that request is not valid");
}

export function shellRoutes(hub: ShellHub | undefined, openStreams: Set<OpenStream>): Route[] {
  const need = (): ShellHub => {
    if (!hub) throw new HttpError(503, "engine_unavailable", "this engine cannot run terminals: node-pty did not load");
    return hub;
  };
  const post = (path: string | RegExp, handle: Route["handle"]): Route => ({ method: "POST", path, auth: "engine", handle });
  const byId = (action: string, handle: (shells: ShellHub, id: string, body: Record<string, unknown>) => unknown): Route =>
    post(new RegExp(`^/v2/terminals/([A-Za-z0-9_-]+)/${action}$`), async ({ params: [id], body }) => ok(await handle(need(), id!, body)));

  return [
    post("/v2/terminals/open", async ({ body }) => ok(await need().open(parse(Open, body)))),
    post("/v2/terminals/list", ({ body }) => ok({ terminals: need().list(typeof body.sessionId === "string" ? body.sessionId : undefined) })),
    post("/v2/terminals/active", async ({ body }) => ok({ terminals: await need().active(parse(Ids, body).ids) })),
    post("/v2/terminals/image-file", async ({ body }) => {
      const answer = await readKittyImageFile(body.path);
      return ok(answer.ok ? { ok: true, base64: Buffer.from(answer.bytes).toString("base64") } : answer);
    }),
    byId("write", (shells, id, body) => ({ ok: typeof body.data === "string" && shells.write(id, body.data) })),
    byId("resize", (shells, id, body) => {
      const { cols, rows } = parse(Resize, body);
      return { ok: shells.resize(id, cols, rows) };
    }),
    byId("kill", (shells, id, body) => ({ ok: shells.kill(id, parse(Kill, body).signal) })),
    byId("close", async (shells, id) => ({ ok: await shells.close(id) })),
    post(/^\/v2\/terminals\/([A-Za-z0-9_-]+)\/stream$/, ({ params: [id], body, request, response }) => {
      const after = typeof body.after === "number" && body.after > 0 ? body.after : 0;
      const shells = need();
      if (!shells.list().some((terminal) => terminal.id === id)) throw new HttpError(404, "not_found", "that terminal is not running");
      holdEventStream(request, response, openStreams, (send) => shells.follow(id!, after, send) ?? (() => {}));
      return undefined;
    }),
  ];
}
