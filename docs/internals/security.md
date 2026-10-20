# Security

Telar runs agents that can execute commands and write files, so whoever can reach it can act on the host. These invariants hold across every refactor:

## Access

- Only `ping` and `pair` are open without credentials. Everything else needs the engine token (loopback only) or a paired device token.
- The engine token never reaches a browser, renderer or phone. The desktop window loads the cockpit over `telar://app/`, and the main process adds the token to the `/v2` requests it forwards to the loopback engine, so the page holds no credential. Remote clients use device tokens.
- Device tokens are stored only as sha256 hashes and compared in constant time. Deleting `remote/remote.json` is the lockout recovery. The file is 0600 in a 0700 directory; there is no keychain.
- Pairing codes are 8 digits, valid 5 minutes, allow 5 tries, work once, and travel only in the URL fragment.
- The MCP connector (`/v2/mcp`, also `/api/mcp`) is open to every caller on an allowed Host because the engine checks it itself: only a paired device's bearer opens it, never the engine token or the device cookie. An observer is served only the reading tools.
- Scopes: a paired device holds `read`, `write` and `admin`, each including the ones below it. `read` is GET and HEAD, `write` is every other method, and `admin` adds the devices, pairing, exposure, other-hosts and settings routes that change what the host runs or who reaches it. `requiredScope` in `domains/remote/scopes.ts` is the one table; `decideAccess` enforces it for the cockpit gate and the network listener alike. The last `admin` device cannot be demoted. A pairing may carry the scopes and the session expiry (`expiresInMs`, at most a year) its device receives; the code itself still lasts 5 minutes. An expired device stops matching its token and stays listed until revoked. The CLI manages devices through `remoteClient` in `packages/engine-client/src/remote/client.ts`: list, pair, re-scope, revoke, and revoke all but one (omit `keep` to revoke every device). Fresh installs require pairing. Devices paired before scopes existed were migrated at boot: Full holds all three, View only holds `read`. The wire still carries a derived `role` (`observer` when `write` is missing) for iOS builds that predate scopes; it goes on 2027-01-01.
- The engine binds loopback only. `TELAR_ENGINE_HOST` (and `TELAR_ENGINE_PORT`) adds a second listener that the engine gates itself: ping and pair are open, everything else needs a paired device's bearer token, and the engine token and the sessions socket's secret open nothing there. Nothing the desktop shell holds opens it: the shell reaches the engine on loopback only. It ignores `requireAuth`, so turning that off never opens the network. A browser also gets an HttpOnly, `SameSite=Strict` cookie (`Secure` behind a TLS proxy) when it pairs, and the listener accepts it in place of a bearer; a cookie never authorises a write unless `Origin` matches `Host`, since an ambient credential must not obey another site's page. Bearers are exempt, and the MCP connector accepts a bearer only.
- A network listener sends no permissive CORS headers. The engine answers 421 to a Host that is not an IP literal, `localhost`, this Mac's name or `.local` name, or a `.ts.net` name, to block DNS rebinding. A request with no Host passes.
- Another Mac's token stays on this Mac; a browser only ever sees our own origin.
- A simulator stream ticket stands in for credentials only on GET and HEAD under `/v2/simulators/hub/` (`/api/simulators/hub/` is the same path). It lasts 5 minutes and stops working when the device that minted it is revoked.

## Agents

- Permission modes are capped by whoever created the session. A session can't hand a peer more access than it has.
- Login grants for the integrated browser are written by the desktop shell, never by the engine, so an agent can't grant itself a login.
- External plugins run as separate processes, and their tools always go through normal approvals. They are never treated as read-only.
- An inline artifact is agent-written html. Its frame is `sandbox="allow-scripts"` and never `allow-same-origin`, so it runs in an opaque origin with no reach into the cockpit, its cookies or its tokens. Its document opens with a CSP of `default-src 'none'`, so nothing leaves it. Svg and mermaid are drawn only as an image (a CSS background) of a `data:` url, where the browser runs no script and loads nothing; their markup is never put into the cockpit's DOM. The engine stores every artifact as `text/plain`, so the attachment route can't serve one as a page on the cockpit's origin.
- The simulator hub (`expo-device-hub`) binds 127.0.0.1 only and runs only while the owner's setting is on. Its own routes include unauthenticated shell exec, so a client reaches it only through engine routes or an allowlist of its read and stream paths, never a blanket pass-through, and the proxy forwards only a short list of request headers, never cookies, tokens or the host secret. Simulator settings are changed by the engine running `simctl` or `adb` itself, not by the hub.
- Agents reach simulators only when both simulator settings are on. The claim decides it, so a turn claimed after access is turned off gets no `simulator_*` tools and no agent-device on its PATH. agent-device is downloaded, at a pinned version, only once access is granted.
- Relay send keys stay on the Mac. The push relay only ever returns Apple's reason word, never a provider body or a token.

## Data

- `TELAR_HOME` is the owner's. Tests and agents build fixtures in temp dirs.
- Secrets live in the Keychain (`com.telar.push-relay`) or the provider's own config. They are never logged or journaled.
- The outgoing webhook's secret is kept in `remote/webhook.json` (0600), goes only to that URL, and is never returned by the engine; the settings see the URL's origin alone. Delivery never follows a redirect, so the Authorization header can't be carried to another host.
