import test from 'node:test';
import assert from 'node:assert/strict';
import { cardContent, hostPost, important } from './card.mjs';

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const host = (id, name, rows, active, at) => ({ id, name, rows, active, at });

test('a post keeps only what the card shows, and refuses anything else', () => {
  const post = hostPost({ kind: 'card', host: { id: A, name: 'Studio' }, active: 1, rows: [{ id: 's1', status: 'Working', title: 'Fix it', extra: 'x' }], alert: { title: 'T', body: 'B', sound: 'default' } });
  assert.deepEqual(post, { host: { id: A, name: 'Studio', active: 1, rows: [{ id: 's1', status: 'Working', title: 'Fix it' }] }, alert: { title: 'T', body: 'B', sound: 'default' } });
  for (const bad of [
    { host: { id: 'nope', name: 'Studio' }, active: 0, rows: [] },
    { host: { id: A, name: 'Studio' }, active: 0, rows: Array(6).fill({ id: 's', status: 'Working' }) },
    { host: { id: A, name: 'Studio' }, rows: [] },
    { host: { id: A, name: 'Studio' }, active: 0, rows: [{ id: 's', status: 'Working', title: 'x'.repeat(161) }] },
    { host: { id: A, name: 'Studio' }, active: 0, rows: [], alert: { title: 'T' } },
  ]) assert.equal(hostPost({ kind: 'card', ...bad }), undefined);
});

test('rows from every Mac merge, the most urgent first, at most five, each naming its Mac', () => {
  const content = cardContent([
    host(A, 'Studio', [{ id: 'a1', status: 'Working' }, { id: 'a2', status: 'Waiting on a session' }, { id: 'a3', status: 'Done' }], 2, 2000),
    host(B, 'Laptop', [{ id: 'b1', status: 'Needs you', title: 'Deploy' }, { id: 'b2', status: 'Working' }, { id: 'b3', status: 'Queued' }], 3, 1000),
  ]);
  assert.deepEqual(content.rows.map(r => [r.id, r.host, r.hostId]), [['b1', 'Laptop', B], ['a1', 'Studio', A], ['b2', 'Laptop', B], ['b3', 'Laptop', B], ['a2', 'Studio', A]]);
  assert.deepEqual([content.title, content.status, content.activeCount, content.ended, content.sessionId, content.hostId], ['5 active sessions', 'Needs you', 5, false, 'b1', B]);
});

test('one Mac names no Mac; finished work reads as finished; nothing left is no card', () => {
  const one = cardContent([host(A, 'Studio', [{ id: 'a1', status: 'Working', title: 'Fix it' }], 1, 1)]);
  assert.equal(one.rows[0].host, undefined);
  assert.equal(one.title, 'Fix it');
  const done = cardContent([host(A, 'Studio', [{ id: 'a1', status: 'Failed' }, { id: 'a2', status: 'Done' }], 0, 1)]);
  assert.deepEqual([done.title, done.status, done.ended], ['Work finished', 'Failed', true]);
  assert.equal(cardContent([]), undefined);
});

test('only a moved count, a new "Needs you" or a newly finished row skips the throttle', () => {
  const card = rows => cardContent([host(A, 'Studio', rows, rows.filter(r => r.status !== 'Done').length, 1)]);
  const before = card([{ id: 'a1', status: 'Working' }, { id: 'a2', status: 'Queued' }]);
  assert.equal(important(undefined, before), true);
  assert.equal(important(before, card([{ id: 'a1', status: 'Working', title: 'renamed' }, { id: 'a2', status: 'Working' }])), false);
  assert.equal(important(before, card([{ id: 'a1', status: 'Needs you' }, { id: 'a2', status: 'Queued' }])), true);
  assert.equal(important(before, card([{ id: 'a1', status: 'Working' }])), true);
  const waiting = card([{ id: 'a1', status: 'Needs you' }, { id: 'a2', status: 'Queued' }]);
  assert.equal(important(waiting, card([{ id: 'a1', status: 'Needs you', title: 'x' }, { id: 'a2', status: 'Queued' }])), false);
});
