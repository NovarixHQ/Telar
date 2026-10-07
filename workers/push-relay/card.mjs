import { DEAD_TOKEN, appleReason } from './shared.mjs';

const CARD_ROWS = 5;
const HOST_TTL = 600000;
const THROTTLE = 15000;
const REFRESH = 300000;
const ARMED_GRACE = 120000;
const STALE_S = 600, END_DISMISS_S = 15, ATTEMPTS = 20;
const REFERENCE_EPOCH = 978307200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOUND = /^[A-Za-z0-9_.-]{1,64}$/;
const RANK = { 'Needs you': 0, Failed: 1, Working: 2, Queued: 2, Done: 4 };

const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const optional = (value, max) => value === undefined || text(value, max);
const rank = status => RANK[status] ?? 3;
const over = status => status === 'Done' || status === 'Failed';

function validRow(row) {
  return row && text(row.id, 128) && text(row.status, 40) && optional(row.title, 160) && optional(row.project, 60)
    && (row.workers === undefined || (Number.isInteger(row.workers) && row.workers > 0 && row.workers < 1000));
}

export function hostPost(body) {
  const { host, rows, active, alert } = body ?? {};
  if (!host || typeof host.id !== 'string' || !UUID.test(host.id) || !text(host.name, 60)) return;
  if (!Number.isInteger(active) || active < 0 || active > 10000 || !Array.isArray(rows) || rows.length > CARD_ROWS || !rows.every(validRow)) return;
  if (alert !== undefined && !(alert && text(alert.title, 160) && text(alert.body, 160) && (alert.sound === undefined || (typeof alert.sound === 'string' && SOUND.test(alert.sound))))) return;
  return {
    host: { id: host.id, name: host.name, active,
      rows: rows.map(({ id, status, title, project, workers }) => ({ id, status, ...(title ? { title } : {}), ...(project ? { project } : {}), ...(workers ? { workers } : {}) })) },
    ...(alert ? { alert: { title: alert.title, body: alert.body, ...(alert.sound ? { sound: alert.sound } : {}) } } : {}),
  };
}

export function cardContent(hosts) {
  const named = hosts.length > 1;
  const rows = [...hosts].sort((a, b) => b.at - a.at)
    .flatMap((host, order) => host.rows.map((row, index) => ({ row: { ...row, hostId: host.id, ...(named ? { host: host.name } : {}) }, order, index })))
    .sort((a, b) => rank(a.row.status) - rank(b.row.status) || a.index - b.index || a.order - b.order)
    .slice(0, CARD_ROWS).map(({ row }) => row);
  if (!rows.length) return;
  const active = hosts.reduce((n, host) => n + host.active, 0);
  const focus = rows[0];
  const only = active === 1 ? rows.find(row => !over(row.status)) : undefined;
  return {
    title: only?.title ?? (active > 1 ? `${active} active sessions` : active ? 'Telar work' : 'Work finished'),
    status: active ? focus.status : focus.status === 'Failed' ? 'Failed' : 'Finished',
    ended: !active, sessionId: focus.id, hostId: focus.hostId, activeCount: active, rows,
  };
}

export function important(before, after) {
  if (!before || before.activeCount !== after.activeCount) return true;
  const key = row => `${row.hostId}:${row.id}`;
  const had = new Set(before.rows.map(row => `${key(row)}:${row.status}`));
  return after.rows.some(row => (row.status === 'Needs you' || over(row.status)) && !had.has(`${key(row)}:${row.status}`));
}

async function liveHosts(storage, now) {
  const entries = await storage.list({ prefix: 'host:' });
  const gone = [...entries].filter(([, host]) => now - host.at >= HOST_TTL).map(([k]) => k);
  if (gone.length) await storage.delete(gone);
  return [...entries].filter(([k]) => !gone.includes(k)).map(([, host]) => host);
}

async function plan(storage, now, alert) {
  const card = await storage.get('card');
  const hosts = await liveHosts(storage, now);
  if (!card || card.ended) return {};
  const expiry = hosts.length ? Math.min(...hosts.map(host => host.at)) + HOST_TTL : undefined;
  const content = cardContent(hosts);
  if (!content) {
    if (now - card.armedAt < ARMED_GRACE) return { card, wake: card.armedAt + ARMED_GRACE };
    return { card, send: 'end' };
  }
  const json = JSON.stringify(content);
  const urgent = alert !== undefined || important(card.sent && JSON.parse(card.sent), content);
  if (json === card.sent && !alert && now - card.sentAt < REFRESH) return { card, expiry, wake: card.sentAt + REFRESH };
  if (!urgent && now - (card.sentAt ?? 0) < THROTTLE) return { card, expiry, wake: card.sentAt + THROTTLE };
  return { card, expiry, content, json, urgent, send: 'update' };
}

export async function wakeAt(storage, ...times) {
  const at = Math.min(...times.filter(t => t !== undefined));
  if (!Number.isFinite(at)) return;
  const current = await storage.getAlarm();
  if (current === null || at < current) await storage.setAlarm(at);
}

async function record(storage, attempt) {
  const attempts = (await storage.get('attempts')) ?? [];
  await storage.put('attempts', [...attempts, attempt].slice(-ATTEMPTS));
}

export async function reconcileCard(storage, env, device, now, alert) {
  const first = await plan(storage, now, alert);
  if (!first.send) { await wakeAt(storage, first.wake, first.expiry); return false; }
  const signed = await env.SIGNER.get(env.SIGNER.idFromName('apns')).fetch('https://internal/token');
  if (!signed.ok) { await record(storage, { at: now, event: first.send, status: 503 }); await wakeAt(storage, now + THROTTLE); return false; }
  const jwt = await signed.text();
  const next = await plan(storage, now, alert);
  if (!next.send) { await wakeAt(storage, next.wake, next.expiry); return false; }
  const { card, content, send } = next;
  const at = Math.floor(now / 1000);
  const aps = send === 'end'
    ? { timestamp: at, event: 'end', 'dismissal-date': at + END_DISMISS_S }
    : { timestamp: at, event: 'update', 'content-state': { ...content, startedAt: Math.floor(card.armedAt / 1000) - REFERENCE_EPOCH, updatedAt: at - REFERENCE_EPOCH },
      'stale-date': at + STALE_S, ...(alert ? { alert } : {}) };
  let status, reason;
  try {
    const response = await fetch(`https://${device.sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'}/3/device/${card.token}`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { authorization: `bearer ${jwt}`, 'apns-topic': `${device.bundle}.push-type.liveactivity`, 'apns-push-type': 'liveactivity',
        'apns-priority': send === 'end' || next.urgent ? '10' : '5', 'apns-expiration': String(at + 3600) },
      body: JSON.stringify({ aps }),
    });
    status = response.status;
    if (status === 200) await response.body?.cancel(); else reason = await appleReason(response);
  } catch { status = 0; }
  await record(storage, { at: now, event: send, status, ...(reason ? { reason } : {}), ...(content ? { rows: content.rows.length } : {}) });
  const current = await storage.get('card');
  if (current?.token !== card.token) return false;
  if (status === 410 || DEAD_TOKEN.has(reason) || (status === 200 && send === 'end')) {
    await storage.put('card', { token: card.token, armedAt: card.armedAt, ended: true });
    return false;
  }
  if (status !== 200) { await wakeAt(storage, now + THROTTLE); return false; }
  await storage.put('card', { ...current, sent: next.json, sentAt: now });
  await wakeAt(storage, now + REFRESH, next.expiry);
  return alert !== undefined;
}

export async function registerCard(storage, token, now) {
  const card = await storage.get('card');
  if (token === undefined) { if (card) await storage.delete('card'); return; }
  if (card?.token === token) return;
  await storage.put('card', { token, armedAt: now });
}

export async function storeHost(storage, pairing, host, now) {
  if (host.rows.length) await storage.put(`host:${pairing}`, { ...host, at: now });
  else await storage.delete(`host:${pairing}`);
}

export async function cardReport(storage, now) {
  const card = await storage.get('card');
  const hosts = await liveHosts(storage, now);
  return {
    card: card ? { armedAt: card.armedAt, ended: card.ended === true, ...(card.sentAt ? { sentAt: card.sentAt } : {}) } : null,
    hosts: hosts.map(host => ({ id: host.id, rows: host.rows.length, active: host.active, at: host.at })),
    attempts: (await storage.get('attempts')) ?? [],
  };
}
