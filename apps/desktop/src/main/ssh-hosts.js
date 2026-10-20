const fs = require("node:fs");
const path = require("node:path");
const { checkTarget, createTunnel, launchOverSsh } = require("./ssh-launch");

const FILE = "ssh-hosts.json";

function createSshHosts({ dir, base, findFreePort, log = () => {}, launch = launchOverSsh, tunnelFor = createTunnel, ssh = "ssh" }) {
  const file = path.join(dir, FILE);
  const tunnels = new Map();

  function read() {
    try {
      const entries = JSON.parse(fs.readFileSync(file, "utf8"));
      return entries.filter((entry) => typeof entry?.target === "string" && Number.isInteger(entry.localPort));
    } catch {
      return [];
    }
  }

  function write(entries) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(entries), { mode: 0o600 });
  }

  const open = (entry) => {
    const tunnel = tunnelFor({ ssh, target: entry.target, localPort: entry.localPort, log });
    tunnels.set(entry.localPort, tunnel);
    tunnel.start();
  };

  return {
    restore() {
      for (const entry of read()) if (!tunnels.has(entry.localPort)) open(entry);
    },

    async add(target) {
      const checked = checkTarget(target);
      const known = read().find((entry) => entry.target === checked);
      const localPort = known?.localPort ?? (await findFreePort());
      tunnels.get(localPort)?.stop();
      tunnels.delete(localPort);
      const launched = await launch({ target: checked, base: base(), localPort, ssh, log });
      tunnels.set(localPort, launched.tunnel);
      if (!known) write([...read(), { target: checked, localPort }]);
      return { pairingUrl: launched.pairingUrl, name: checked.split("@").at(-1) };
    },

    release(baseUrl) {
      const url = new URL(baseUrl);
      if (url.hostname !== "127.0.0.1") return false;
      const port = Number(url.port);
      const entries = read();
      if (!entries.some((entry) => entry.localPort === port)) return false;
      tunnels.get(port)?.stop();
      tunnels.delete(port);
      write(entries.filter((entry) => entry.localPort !== port));
      return true;
    },

    reconnectAll() {
      for (const tunnel of tunnels.values()) tunnel.reconnectNow();
    },

    stopAll() {
      for (const tunnel of tunnels.values()) tunnel.stop();
      tunnels.clear();
    },
  };
}

module.exports = { createSshHosts };
