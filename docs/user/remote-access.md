# Remote access

Telar runs on your Mac, but you can reach it from somewhere else: a browser on another computer, the iPhone app, or the Telar on a second Mac. Everything is in Settings → Connections.

## How it's guarded

**Require pairing** is on by default. A device can only connect once it's paired. The Mac running Telar is always allowed in. If you turn pairing off, anything that can reach the address has full control.

**Network access** decides who can reach Telar at all. By default Telar only listens on this Mac. Switch it to every interface to let other devices on your network or tailnet connect. This setting only applies while Require pairing is on, and it takes effect when Telar restarts. The pane offers a Restart button.

## Pairing a browser or phone

1. On the Mac, go to Settings → Connections → Pair a device and show a pairing code.
2. Pick the address the other device will use: the local network, your Tailscale address, or the Tailscale HTTPS name.
3. On the other device, scan the QR code, open the link, or type the eight-digit code on the pairing page.

A code works for one device. It lasts five minutes or five wrong tries, and Telar shows it once and never stores it.

A browser pairs once per address. If you've paired at the Tailscale IP, the Tailscale HTTPS name counts as a different address and needs its own pairing.

## Tailscale

Tailscale is the easiest way to reach your Mac from anywhere. Install it on the Mac and on the other device, and sign in to the same tailnet. Then pick the tailnet address when you pair.

**Tailscale HTTPS** publishes Telar at a MagicDNS `https://….ts.net` address with a real certificate. Some browser features, like dictation, only work over HTTPS on a phone's browser. To use it, turn on HTTPS certificates for your tailnet in the Tailscale admin console. It takes effect at the next launch.

Before you turn it on: issuing the certificate writes this Mac's name to a public certificate log, permanently. If the Mac's name includes your own name, rename the machine in Tailscale first.

## Paired devices and roles

Every paired device is listed with where it connected from and when it was last seen. Each has a role:

- **Full**: reads and changes everything, like the Mac itself.
- **View only**: reads everything and changes nothing. A view-only phone can't sign up for notifications.

You can rename a device or change its role. At least one device must keep full access.

## Revoking

Revoke a device and it's logged out on its next request. It can pair again with a fresh code. **Revoke all other devices** logs out everything except the device you're using. Use it if you lose your phone.

Forgetting the pairing on a phone only removes it from that phone. To cut the phone off everywhere, revoke it on the Mac.

## Other Macs

You can bring another Mac's conversations into this one's rail.

1. On the other Mac, turn on network access and pairing, then show a pairing code and copy the link.
2. On this Mac, go to Settings → Connections → Paired → Add a computer, paste the link, and choose Pair.

That Mac's conversations appear in your rail, marked with its name, and you work on them from here. You can rename it here.

Its alerts show on this Mac too, and reading one on any device takes it down here.

Forgetting a Mac removes its conversations from your rail. The other Mac still lists this one as a paired device until you revoke it there.

## Assistants (MCP connector)

Telar is also an MCP server, so an assistant that takes a custom connector by URL can list and read your sessions, start one, send it a message, stop or settle it, and answer its permission prompts. The address is your cockpit address followed by `/api/mcp`, over Streamable HTTP.

1. Show a pairing code in Settings → Connections → Pair a device.
2. Trade it for a token from any machine that reaches the cockpit:
   ```sh
   curl -s https://<mac>.<tailnet>.ts.net/api/pair -H 'content-type: application/json' -d '{"token":"<code>","deviceName":"Grok"}'
   ```
   The `deviceToken` in the answer (`tlr_…`) is the connector's secret. It is listed under Paired devices like any other.
3. In the assistant, add a connector with the address and the header `Authorization: Bearer tlr_…`.

Give the device **View only** and the assistant sees only the reading tools: it can list a session's permission prompts but not answer them. Secret-access prompts are never answerable from a connector.

What is not obvious:
- The connector always needs a device token, even with Require pairing off. A browser's pairing cookie doesn't open it.
- An assistant that runs in the cloud, like Grok, is not on your tailnet, so Tailscale HTTPS is not enough. Publish just the connector on the internet with Tailscale Funnel, using the port of the cockpit's Local network address:
  ```sh
  tailscale funnel --bg --https=8443 --set-path=/api/mcp http://127.0.0.1:<port>/api/mcp
  ```
  The address is then `https://<mac>.<tailnet>.ts.net:8443/api/mcp`. Anyone on the internet can reach it and only the token keeps them out, so revoke the device if the token leaks. `tailscale funnel --https=8443 off` takes it down.

## Webhook

Telar can POST to a URL of yours when a session finishes, fails or needs your approval: the same moments a notification fires, once each. Set the URL, and optionally a secret, in Settings → Connections → Webhook. **Send a test** posts a `test` event right away.

```json
{ "id": "…", "event": "session.finished", "sessionId": "…", "title": "Fix the login", "project": { "id": "…", "name": "Telar" }, "status": "idle", "at": "2026-10-13T12:00:00.000Z" }
```

`event` is `session.finished`, `session.failed` or `session.blocked`. `status` is what the session is doing at that moment. The headers `X-Telar-Event` and `X-Telar-Delivery` repeat the event and its `id`. With a secret, each request carries `Authorization: Bearer <secret>` and `X-Telar-Signature: sha256=<hex HMAC-SHA256 of the raw body>`, so check whichever your receiver supports.

What is not obvious:
- Each try times out after 5 seconds. No answer, a 408, a 429 or a 5xx is retried three more times, after 1, 5 and 30 seconds. Other refusals and redirects are not. A retry keeps the same `id`, so deduplicate on it.
- Nothing is sent for what happened while Telar was closed. After a launch it starts from how things are now.
- A session another session started sends only `session.blocked`, as with notifications.
- The settings show only the URL's origin, and the secret is never shown again.

## Push notifications

Phone notifications are set on the phone. See [iPhone](iphone.md).
