import { expect, test } from "bun:test";
import { StreamTickets, TICKET_TTL_MS } from "./tickets";

const STREAM = "/api/simulators/hub/vendor/serve-sim/helper/A1B2/stream.mjpeg";

test("a ticket opens reads under the hub prefix for its holder, and nothing else", () => {
  const tickets = new StreamTickets(() => 1_000);
  const { ticket, expiresAt } = tickets.mint("dev_1");
  expect(expiresAt).toBe(1_000 + TICKET_TTL_MS);
  expect(tickets.check(STREAM, "GET", ticket)).toEqual({ holder: "dev_1" });
  expect(tickets.check(STREAM, "HEAD", ticket)).toEqual({ holder: "dev_1" });
  expect(tickets.check(STREAM, "POST", ticket)).toBeUndefined();
  expect(tickets.check("/api/simulators/A1B2/input", "GET", ticket)).toBeUndefined();
  expect(tickets.check("/api/sessions", "GET", ticket)).toBeUndefined();
  expect(tickets.check(STREAM, "GET", `${ticket}x`)).toBeUndefined();
  expect(tickets.check(STREAM, "GET", null)).toBeUndefined();
});

test("a ticket stops working when it expires", () => {
  let now = 0;
  const tickets = new StreamTickets(() => now);
  const { ticket } = tickets.mint(null);
  now = TICKET_TTL_MS - 1;
  expect(tickets.check(STREAM, "GET", ticket)).toEqual({ holder: null });
  now = TICKET_TTL_MS;
  expect(tickets.check(STREAM, "GET", ticket)).toBeUndefined();
});
