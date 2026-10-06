import crypto from "node:crypto";

export const TICKET_TTL_MS = 5 * 60_000;
const HUB_API_PREFIX = "/api/simulators/hub/";

const digest = (ticket: string) => crypto.createHash("sha256").update(ticket).digest("hex");

export class StreamTickets {
  private readonly issued = new Map<string, { expiresAt: number; holder: string | null }>();

  constructor(private readonly now: () => number = Date.now) {}

  mint(holder: string | null): { ticket: string; expiresAt: number } {
    const now = this.now();
    for (const [hash, entry] of this.issued) if (entry.expiresAt <= now) this.issued.delete(hash);
    const ticket = `stk_${crypto.randomBytes(32).toString("base64url")}`;
    const expiresAt = now + TICKET_TTL_MS;
    this.issued.set(digest(ticket), { expiresAt, holder });
    return { ticket, expiresAt };
  }

  check(pathname: string, method: string, ticket: string | null | undefined): { holder: string | null } | undefined {
    if (!ticket || !pathname.startsWith(HUB_API_PREFIX) || (method !== "GET" && method !== "HEAD")) return undefined;
    const entry = this.issued.get(digest(ticket));
    return entry && entry.expiresAt > this.now() ? { holder: entry.holder } : undefined;
  }
}
