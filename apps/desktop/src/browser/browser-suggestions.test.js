const { test, expect } = require('bun:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HISTORY_CAP, createBrowserSuggestions, siteOrigin, pageUrl, listeningPorts } = require('./browser-suggestions');

test('recent sites discard credentials and callback data', () => {
  expect(siteOrigin('https://example.com/oauth?code=secret#token')).toBe('https://example.com/');
  expect(siteOrigin('https://user:secret@example.com/')).toBeNull();
  expect(siteOrigin('chrome-extension://extension/popup.html')).toBeNull();
  expect(siteOrigin('about:blank')).toBeNull();
  expect(pageUrl('https://example.com/oauth/callback?code=secret#token')).toBe('https://example.com/oauth/callback');
});
test('port discovery accepts local listeners, deduplicates and excludes external interfaces', () => {
  expect(listeningPorts('p100\nn*:3000\nn127.0.0.1:3000\nn[::1]:5173\nn192.168.0.5:80\nn[::]:8080')).toEqual([3000, 5173, 8080]);
});
test('history persists per project, supports removal, and only live HTML servers are suggested', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'telar-suggestions-'));
  const probed = [];
  const dependencies = { scanPorts: async () => [3000, 4000, 5000], fetch: async (url, init) => {
    probed.push(url); expect(init.method).toBe('HEAD'); expect(init.redirect).toBe('manual');
    return new Response(null, { headers: { 'content-type': url.includes(':3000') ? 'text/html' : 'application/json' } });
  } };
  try {
    const store = createBrowserSuggestions(root, dependencies);
    store.remember('project-a', 'https://example.com/path?code=private');
    store.remember('project-b', 'https://another.example/');
    const a = await store.list('project-a', [5000]);
    expect(a.recent).toEqual([{ url: 'https://example.com/' }]);
    expect(a.servers).toEqual([{ url: 'http://127.0.0.1:3000/', port: 3000 }]);
    expect(probed).toHaveLength(2);
    const restored = createBrowserSuggestions(root, dependencies);
    expect((await restored.list('project-b')).recent).toEqual([{ url: 'https://another.example/' }]);
    restored.remove('project-a', 'https://example.com/');
    expect((await restored.list('project-a')).recent).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'browser-recent-sites.json'), 'utf8')).not.toContain('private');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function withStore(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'telar-history-'));
  let clock = 1000;
  const now = () => clock;
  try { return run(root, () => createBrowserSuggestions(root, { now }), (at) => { clock = at; }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('history records pages with visit counts, last visit and title, and survives a restart', () => withStore((root, open, setClock) => {
  const store = open();
  store.remember('p', 'http://localhost:3000/dashboard?token=x');
  store.retitle('p', 'http://localhost:3000/dashboard?token=x', 'Dashboard');
  setClock(2000);
  store.remember('p', 'https://github.com/');
  setClock(3000);
  store.remember('p', 'http://localhost:3000/dashboard');
  store.retitle('p', 'https://unvisited.example/', 'Ignored');
  expect(open().history('p')).toEqual([
    { url: 'http://localhost:3000/dashboard', title: 'Dashboard', visits: 2, lastVisit: 3000 },
    { url: 'https://github.com/', title: '', visits: 1, lastVisit: 2000 },
  ]);
  expect(open().history('other')).toEqual([]);
}));

test('history is capped, dropping the least recently visited page', () => withStore((_root, open) => {
  const store = open();
  for (let index = 0; index <= HISTORY_CAP; index += 1) store.remember('p', `https://site${index}.example/`);
  const entries = open().history('p');
  expect(entries).toHaveLength(HISTORY_CAP);
  expect(entries[0].url).toBe(`https://site${HISTORY_CAP}.example/`);
  expect(entries.some(entry => entry.url === 'https://site0.example/')).toBe(false);
}));

test('the start page lists distinct recent sites, and removing a site removes its pages', () => withStore((_root, open) => {
  const store = open();
  store.remember('p', 'https://a.example/one');
  store.remember('p', 'https://b.example/');
  store.remember('p', 'https://a.example/two');
  store.remove('p', 'https://a.example/');
  expect(store.history('p').map(entry => entry.url)).toEqual(['https://b.example/']);
}));
