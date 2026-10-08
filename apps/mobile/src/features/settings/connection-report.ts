import type { ConnectionState } from "../../platform/connection";

export type ReportedHost = { hostId: string; name: string; state: ConnectionState; addresses: string[] };

/** "Paired · 192.168.1.4": every phone host holds a key, then the address it reaches it on. */
export function hostSubtitle(host: Pick<ReportedHost, "state" | "addresses">): string {
  const address = host.state.kind === "online" ? host.state.address : host.addresses[0];
  const name = address?.match(/^[a-z]+:\/\/([^/:]+)/i)?.[1] ?? address;
  return name ? `Paired · ${name}` : "Paired";
}

export function connectionReport(hosts: readonly ReportedHost[], now: Date): string {
  const lines = [`Telar connection report, ${now.toISOString()}`];
  for (const host of hosts) {
    const reached = host.state.kind === "online" ? ` via ${host.state.address}` : "";
    lines.push("", `${host.name} (${host.hostId})`, `  state: ${host.state.kind}${reached}`, `  addresses: ${host.addresses.join(" ") || "none"}`);
  }
  return lines.join("\n");
}
