import { expect, test } from "bun:test";
import { HostConnection } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf } from "../../platform/connection/testing";
import { BUSY_POLL_MS, IDLE_POLL_MS, Inbox } from "./inbox";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";

function setup(list: () => Response) {
  const clock = fakeClock();
  const network = fakeNetwork({ [MAC]: (path) => (path === "/api/identity" ? identityOf(HOST) : list()) });
  const connection = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock, random: () => 0 });
  const inbox = new Inbox(connection, clock);
  const reads = () => network.seen.filter((call) => call.url.endsWith("/api/sessions/live"));
  const next = () =>
    new Promise<void>((resolve) => {
      const stop = inbox.subscribe(() => {
        stop();
        resolve();
      });
    });
  return { clock, connection, inbox, reads, next };
}

const list = (activity: string, etag = '"r1"') => Response.json({ sessions: [{ id: "s1", title: "One", activity }], projects: [] }, { headers: { etag } });

test("it reads the list once the host is online, then again after the idle interval with its ETag", async () => {
  let calls = 0;
  const { clock, connection, inbox, reads, next } = setup(() => (++calls === 1 ? list("idle") : new Response(null, { status: 304, headers: { etag: '"r1"' } })));
  inbox.start();
  connection.start();
  await next();
  expect(inbox.snapshot.answer?.sessions.map((session) => session.id)).toEqual(["s1"]);
  clock.advance(IDLE_POLL_MS - 1);
  expect(reads()).toHaveLength(1);
  clock.advance(1);
  expect(reads()).toHaveLength(2);
});

test("a busy list is read every few seconds", async () => {
  const { clock, connection, inbox, reads, next } = setup(() => list("working"));
  inbox.start();
  connection.start();
  await next();
  clock.advance(BUSY_POLL_MS);
  await next();
  expect(reads()).toHaveLength(2);
});

test("in the background it stops reading, and reads again on coming back", async () => {
  const { clock, connection, inbox, reads, next } = setup(() => list("idle"));
  inbox.start();
  connection.start();
  await next();
  inbox.setForeground(false);
  clock.advance(IDLE_POLL_MS * 3);
  expect(reads()).toHaveLength(1);
  inbox.setForeground(true);
  await next();
  expect(reads()).toHaveLength(2);
});

test("a failed read is reported and the last list is kept", async () => {
  let calls = 0;
  const { clock, connection, inbox, next } = setup(() =>
    ++calls === 1 ? list("idle") : Response.json({ error: { code: "internal", message: "boom" } }, { status: 500 }),
  );
  inbox.start();
  connection.start();
  await next();
  clock.advance(IDLE_POLL_MS);
  await next();
  expect(inbox.snapshot.failed).toBe("boom");
  expect(inbox.snapshot.answer?.sessions).toHaveLength(1);
});
