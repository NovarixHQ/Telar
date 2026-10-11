const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HISTORY_CAP = 1000;
const TITLE_CAP = 300;

function parsedVisit(raw) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function siteOrigin(raw) {
  const url = parsedVisit(raw);
  return url ? url.origin + '/' : null;
}

// History keeps the page, never its query or fragment, where login callbacks carry codes and tokens.
function pageUrl(raw) {
  const url = parsedVisit(raw);
  return url ? url.origin + url.pathname : null;
}

function validEntry(entry) {
  if (!entry || typeof entry.url !== 'string' || pageUrl(entry.url) !== entry.url) return null;
  return {
    url: entry.url,
    title: typeof entry.title === 'string' ? entry.title.slice(0, TITLE_CAP) : '',
    visits: Number.isInteger(entry.visits) && entry.visits > 0 ? entry.visits : 1,
    lastVisit: Number.isFinite(entry.lastVisit) ? entry.lastVisit : 0,
  };
}

function listeningPorts(text) {
  return [...new Set(text.split('\n').flatMap(line => {
    const match = /^n(?:\*|127\.0\.0\.1|localhost|\[::1\]|\[::\]|0\.0\.0\.0):(\d+)$/.exec(line.trim());
    const port = match ? Number(match[1]) : 0;
    return port > 0 && port <= 65535 ? [port] : [];
  }))].slice(0, 64);
}

function scanPorts() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return Promise.resolve([]);
  return new Promise(resolve => {
    execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'], { timeout: 2000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? [] : listeningPorts(stdout));
    });
  });
}

function createBrowserSuggestions(userData, dependencies = {}) {
  const filename = path.join(userData, 'browser-recent-sites.json');
  const now = dependencies.now || Date.now;
  let profiles = {};
  try {
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (data.version === 1 && data.profiles && typeof data.profiles === 'object') profiles = data.profiles;
  } catch { /* First run, or an unusable suggestions cache. */ }
  let discovery;
  let discoveredAt = 0;
  let servers = [];
  const persist = () => {
    try {
      fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(filename + '.tmp', JSON.stringify({ version: 1, profiles }));
      fs.renameSync(filename + '.tmp', filename);
    } catch { /* Suggestions do not gate browsing. */ }
  };
  const history = profile => Object.hasOwn(profiles, profile) && Array.isArray(profiles[profile]) ? profiles[profile].map(validEntry).filter(Boolean).slice(0, HISTORY_CAP) : [];
  // Own-property assignment even for an unusual profile name.
  const store = (profile, entries) => Object.defineProperty(profiles, profile, { value: entries, enumerable: true, configurable: true, writable: true });
  const recent = profile => [...new Set(history(profile).map(entry => siteOrigin(entry.url)))].slice(0, 8).map(url => ({ url }));
  return {
    remember(profile, raw) {
      const url = pageUrl(raw);
      if (!profile || !url) return;
      const entries = history(profile);
      const seen = entries.find(entry => entry.url === url);
      const visit = { url, title: seen?.title ?? '', visits: (seen?.visits ?? 0) + 1, lastVisit: now() };
      store(profile, [visit, ...entries.filter(entry => entry.url !== url)].slice(0, HISTORY_CAP));
      persist();
    },
    retitle(profile, raw, title) {
      const url = pageUrl(raw);
      const entry = url && history(profile).find(candidate => candidate.url === url);
      const next = String(title || '').slice(0, TITLE_CAP);
      if (!entry || entry.title === next) return;
      store(profile, history(profile).map(candidate => candidate.url === url ? { ...candidate, title: next } : candidate));
      persist();
    },
    history,
    /**
     * Metadata migration only: move one key's history to another
     * (a project key that became a named profile id). A no-op when the source
     * has nothing or the target already has history — this never merges two
     * identities' browsing into one list.
     */
    adopt(fromProfile, toProfile) {
      if (!fromProfile || !toProfile || fromProfile === toProfile) return;
      if (!Object.hasOwn(profiles, fromProfile) || Object.hasOwn(profiles, toProfile)) return;
      store(toProfile, history(fromProfile));
      delete profiles[fromProfile];
      persist();
    },
    remove(profile, site) {
      if (!Object.hasOwn(profiles, profile)) return;
      profiles[profile] = history(profile).filter(entry => siteOrigin(entry.url) !== site);
      persist();
    },
    async list(profile, excludedPorts = []) {
      if (!discovery && Date.now() - discoveredAt > 15000) {
        discovery = (async () => {
          const ports = await (dependencies.scanPorts || scanPorts)();
          const found = [];
          // Four bounded probes at once; HEAD only, no cookies or redirects.
          for (let index = 0; index < ports.length; index += 4) {
            await Promise.all(ports.slice(index, index + 4).filter(port => !excludedPorts.includes(port)).map(async port => {
              const url = `http://127.0.0.1:${port}/`;
              try {
                const response = await (dependencies.fetch || fetch)(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(400) });
                if (response.ok && /text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) found.push({ url, port });
                await response.body?.cancel();
              } catch { /* A listening socket need not be a web server. */ }
            }));
          }
          servers = found.sort((a, b) => a.port - b.port);
          discoveredAt = Date.now();
        })().finally(() => { discovery = undefined; });
      }
      await discovery;
      return { recent: recent(profile), servers: servers.filter(server => !excludedPorts.includes(server.port)) };
    },
  };
}
module.exports = { HISTORY_CAP, createBrowserSuggestions, siteOrigin, pageUrl, listeningPorts };
