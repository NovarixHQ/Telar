import { expect, test } from "bun:test";
import { RECORDED_HOSTS, recordedFetch } from "@telar/engine-client/fixtures/hosts";
import { HostConnection } from "../../platform/connection";
import { fakeClock, until } from "../../platform/connection/testing";
import { pair } from "../hosts/pairing";
import { Inbox } from "./inbox";
import { railSections } from "./rail";

const MAC = "http://100.70.1.2:3000";

for (const host of RECORDED_HOSTS) {
  test(`pairs with a ${host.version} host and lists its sessions`, async () => {
    const recorded = recordedFetch(host);
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith("/api/pair") ? Promise.resolve(Response.json({ deviceToken: "tlr_phone", deviceId: "dev_1" })) : recorded(input, init)) as typeof globalThis.fetch;

    const outcome = await pair(`${MAC}/pair#token=48129037`, { tablet: false }, fetch);
    if (!outcome.ok) throw new Error(outcome.message);

    const clock = fakeClock();
    const connection = new HostConnection(outcome.host, { fetch, clock });
    connection.start();
    await until(connection, "online");

    const inbox = new Inbox(connection, clock);
    await inbox.refresh();
    expect(inbox.snapshot.failed).toBeUndefined();
    const rail = railSections([{ hostId: connection.hostId, answer: inbox.snapshot.answer }], clock.now());
    expect(rail.active.map((row) => row.sessionId)).toEqual(["session_compat"]);
    connection.stop();
  });

  test(`a pairing kept from a newer ${host.version} host still connects after a downgrade`, async () => {
    const connection = new HostConnection({ hostId: "host_00000000-0000-0000-0000-000000000001", name: "Studio", token: "tlr_phone", paired: [MAC] }, { fetch: recordedFetch(host), clock: fakeClock() });
    connection.start();
    expect(await until(connection, "online")).toMatchObject({ address: MAC });
    connection.stop();
  });
}
