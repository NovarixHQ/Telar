import { expect, test } from "bun:test";
import { HostConnection, HostRegistry } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf, until } from "../../platform/connection/testing";
import { listDirectories, otherRoots, parseFolderPath, registerProject } from "./directories";

const MAC = "http://192.168.1.20:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";

function online(answer: (path: string, init: RequestInit) => Response) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const network = fakeNetwork({
    [MAC]: (path, init) => {
      if (path === "/api/identity") return identityOf(HOST);
      calls.push({ path, method: init.method ?? "GET", ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return answer(path, init);
    },
  });
  const host = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock(), random: () => 0 });
  host.start();
  return { host, calls, network };
}

const listing = { path: "/Users/me", name: "me", parent: "/Users", home: "/Users/me", roots: [{ name: "Home", path: "/Users/me" }, { name: "Drive", path: "/Volumes/Drive" }], dirs: [], truncated: false };

test("a typed folder is cleaned up, and anything not starting at / or ~ is refused", () => {
  expect(parseFolderPath(' "/Volumes/Drive/app/" ')).toEqual({ ok: true, path: "/Volumes/Drive/app" });
  expect(parseFolderPath("~/code")).toEqual({ ok: true, path: "~/code" });
  expect(parseFolderPath("/")).toEqual({ ok: true, path: "/" });
  expect(parseFolderPath("  ")).toEqual({ ok: false, message: "Type or paste a folder path." });
  expect(parseFolderPath("code/app")).toEqual({ ok: false, message: "A folder path has to start with / or ~." });
});

test("other roots leave out the one being shown", () => {
  expect(otherRoots(listing)).toEqual([{ name: "Drive", path: "/Volumes/Drive" }]);
});

test("browsing asks the cockpit's fs route, with the folder only when there is one", async () => {
  const { host, network } = online(() => Response.json(listing));
  await until(host, "online");
  expect(await listDirectories(host)).toEqual(listing);
  await listDirectories(host, "/Volumes/Drive app");
  expect(network.seen.slice(-2).map((call) => call.url)).toEqual([`${MAC}/api/fs`, `${MAC}/api/fs?path=%2FVolumes%2FDrive+app`]);
});

test("adding a project posts its name and root, falling back to the folder's name", async () => {
  const project = { id: "p1", name: "app", root: "/Users/me/app" };
  const { host, calls } = online(() => Response.json({ project }, { status: 201 }));
  await until(host, "online");
  expect(await registerProject({ get: () => host }, HOST, "/Users/me/app", "  ", "app")).toEqual(project as never);
  await registerProject({ get: () => host }, HOST, "/Users/me/app", " Telar ", "app");
  expect(calls).toEqual([
    { path: "/api/projects", method: "POST", body: { name: "app", root: "/Users/me/app" } },
    { path: "/api/projects", method: "POST", body: { name: "Telar", root: "/Users/me/app" } },
  ]);
});

test("with two computers paired, a project is added on the one chosen and the other hears nothing", async () => {
  const STUDIO = "http://192.168.1.30:3000";
  const posted: string[] = [];
  const mac = (hostId: string, origin: string) => (path: string) => {
    if (path === "/api/identity") return identityOf(hostId);
    posted.push(`${origin}${path}`);
    return Response.json({ project: { id: "p9", name: "app", root: "/code/app" } }, { status: 201 });
  };
  const network = fakeNetwork({ [MAC]: mac(HOST, MAC), [STUDIO]: mac("host_studio", STUDIO) });
  const registry = new HostRegistry({ fetch: network.fetch, clock: fakeClock(), random: () => 0 });
  registry.add({ hostId: HOST, name: "Mini", token: "a", paired: [MAC] });
  const studio = registry.add({ hostId: "host_studio", name: "Studio", token: "b", paired: [STUDIO] });
  await until(studio, "online");
  await registerProject(registry, "host_studio", "/code/app", "", "app");
  expect(posted).toEqual([`${STUDIO}/api/projects`]);
  await expect(registerProject(registry, "host_gone", "/code/app", "", "app")).rejects.toThrow("no longer paired");
});
