'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { loadReview, byteRange, createServer } = require('../scripts/benchmark-lab-review-access.cjs');

test('byte ranges support native media seeking and reject malformed requests', () => {
  assert.deepEqual(byteRange(null, 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19, partial: true });
  assert.deepEqual(byteRange('bytes=90-', 100), { start: 90, end: 99, partial: true });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99, partial: true });
  for (const input of ['bytes=100-', 'bytes=2-1', 'bytes=0-1,3-4', 'bytes=-0', 'bytes=-', 'bytes=9007199254740992-'])
    assert.equal(byteRange(input, 100), null);
});

test('same sealed mapping, blind routes, media serving and bounded player action', async t => {
  const review = loadReview();
  assert.deepEqual(review.pack.groups.map(group => group.id), ['cd-b', 'e33-a', 'fh5-a', 'acc-a', 'desk-b', 'sf-b']);
  assert.equal(review.assets.size, 172);
  const launches = [];
  const server = createServer(review, { launchPlayer: (exe, args) => {
    launches.push({ exe, args }); const child = new EventEmitter(); child.unref = () => {};
    process.nextTick(() => child.emit('spawn')); return child;
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/'); const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy').includes('frame-ancestors'));
  for (const forbidden of ['reveal-key', 'review-manifest', 'feedback.csv', 'hevc_nvenc', 'av1_nvenc', 'libsvtav1', 'psy-rd', 'CQ29'])
    assert.ok(!html.includes(forbidden), forbidden);
  const token = html.match(/"csrfToken":"([a-f0-9]+)"/)?.[1]; assert.ok(token);
  for (const forbidden of ['/reveal-key.json', '/review-manifest.json', '/review-guide.html', '/feedback.csv', '/scripts/benchmark-lab.cjs', '/media/../../reveal-key.json'])
    assert.equal((await fetch(base + forbidden)).status, 404);
  const hostileStatus = await new Promise((resolve, reject) => {
    const request = http.get(base + '/', { headers: { Host: 'hostile.example' } }, result => {
      result.resume(); result.once('end', () => resolve(result.statusCode));
    }); request.once('error', reject);
  });
  assert.equal(hostileStatus, 403);
  for (const [route, asset] of review.assets) {
    const head = await fetch(base + route, { method: 'HEAD' });
    assert.equal(head.status, 200, route); assert.equal(Number(head.headers.get('content-length')), asset.bytes, route);
  }
  const route = review.pack.groups[0].entries[0].clip;
  const partial = await fetch(base + '/' + route, { headers: { Range: 'bytes=0-31' } });
  assert.equal(partial.status, 206);
  const expected = Buffer.alloc(32);
  const descriptor = fs.openSync(review.assets.get('/' + route).filename, 'r');
  try { fs.readSync(descriptor, expected, 0, 32, 0); } finally { fs.closeSync(descriptor); }
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected);
  assert.equal((await fetch(base + '/' + route, { headers: { Range: 'bytes=9999999999999-' } })).status, 416);
  const body = { sceneId: 'cd-b', entryIndex: 2, token };
  const send = (value, origin = base) => fetch(base + '/player', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await send(body, 'https://hostile.example')).status, 403);
  assert.equal((await send({ ...body, token: 'wrong' })).status, 400);
  assert.equal((await send({ ...body, sceneId: '../', entryIndex: 0 })).status, 400);
  assert.equal((await send({ ...body, entryIndex: 999 })).status, 400);
  assert.equal(launches.length, 0);
  assert.equal((await send(body)).status, 200);
  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].args, [review.clips.get('cd-b:2'), '/new', '/play']);
});
