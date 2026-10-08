import { afterEach, describe, expect, test } from "bun:test";
import { createEngineApi, EngineApiError } from "./client";

describe("the package's domain methods over the cockpit's /api proxy", () => {
  test("a package domain method reaches the engine through the same /api route", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const api = createEngineApi(async (url, init) => {
      calls.push({ url: String(url), ...(init?.method ? { method: init.method } : {}) });
      return Response.json({ git: { repository: true, branch: "main" } });
    });
    await expect(api.projectGit("project a")).resolves.toEqual({ git: { repository: true, branch: "main" } });
    await api.commitSessionWork("session_a", "save");
    expect(calls).toEqual([
      { url: "/api/projects/project%20a/git", method: "GET" },
      { url: "/api/sessions/session_a/git/commit", method: "POST" },
    ]);
  });

  test("a refusal from a domain method arrives as an EngineApiError", async () => {
    const api = createEngineApi(async () => Response.json({ error: { code: "not_found", message: "No such project." } }, { status: 404 }));
    const refusal = await api.projectGit("gone").catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(EngineApiError);
    expect((refusal as EngineApiError).message).toBe("No such project.");
  });
});

describe("a browser the engine does not know", () => {
  const host = globalThis as { window?: unknown };
  const before = host.window;
  const unpaired = async () => Response.json({ error: { code: "cockpit_unauthorized", message: "Pair this device with the Telar cockpit to use it." } }, { status: 401 });
  const visit = (pathname: string) => {
    const visited: string[] = [];
    host.window = { location: { pathname, replace: (to: string) => visited.push(to) } };
    return visited;
  };
  afterEach(() => {
    host.window = before;
  });

  test("is sent to the pairing page", async () => {
    const visited = visit("/projects/p1");
    await createEngineApi(unpaired).projectGit("p1").catch(() => undefined);
    expect(visited).toEqual(["/pair"]);
  });

  test("on the pairing page itself it does not reload the page", async () => {
    const visited = visit("/pair");
    await createEngineApi(unpaired).projectGit("p1").catch(() => undefined);
    expect(visited).toEqual([]);
  });

  test("a refusal from another Mac stays an error on this page", async () => {
    const visited = visit("/hosts/mini/projects/p1");
    const refusal = await createEngineApi(unpaired).projectGit("p1").catch((error: unknown) => error);
    expect((refusal as EngineApiError).code).toBe("cockpit_unauthorized");
    expect(visited).toEqual([]);
  });
});
