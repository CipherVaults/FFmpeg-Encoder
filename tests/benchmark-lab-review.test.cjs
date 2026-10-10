'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomizedOrder, assetPath, reviewHtml } = require('../scripts/benchmark-lab-review.cjs');

test('blind ordering is reproducible per retained seed without dropping or changing entries', () => {
  const entries = ['reference', 'ordinary', 'compound', 'source'].map(id => ({ id, value: id }));
  const original = structuredClone(entries); const seed = 'retained-private-seed';
  const first = randomizedOrder(entries, seed, 'cd-b');
  assert.deepEqual(first, randomizedOrder(entries, seed, 'cd-b'));
  assert.deepEqual([...first].sort((a, b) => a.id.localeCompare(b.id)), [...entries].sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(entries, original);
  assert.throws(() => randomizedOrder(entries, 'short', 'cd-b'));
});

test('review paths cannot expose absolute or escaped filesystem locations', () => {
  assert.equal(assetPath('scene-1/label-a/frame-360.png'), 'scene-1/label-a/frame-360.png');
  for (const bad of ['../video.mkv', '/video.mkv', 'D:/video.mkv', 'a/../video.mkv', 'http://server/video', 'a\\video.mkv'])
    assert.throws(() => assetPath(bad));
});

test('technical source labels stay inert and review images have keyboard/native-view controls', () => {
  const pack = { groups: [{ id: 'synthetic', title: '</script><script>alert(1)</script>', context: 'source <name>', width: 1920, height: 1080,
    frameIndices: [360], entries: [{ label: 'Captured source', clip: 'scene/source.mkv', images: ['scene/source.png'] },
      { label: 'Candidate A', clip: 'scene/a.mkv', images: ['scene/a.png'] }] }] };
  const html = reviewHtml(pack);
  assert.ok(!html.includes('</script><script>alert(1)</script>'));
  assert.match(html, /\\u003c\/script>/);
  assert.match(html, /addEventListener\('keydown'/);
  assert.match(html, /Show native 100%/);
  assert.match(html, /textContent=sceneName\(g\)/);
  assert.match(html, /No scores or candidate encoder identities are shown/);
  assert.ok(!html.includes('reveal-key'));
  assert.throws(() => reviewHtml({ groups: [{ ...pack.groups[0], entries: [{ ...pack.groups[0].entries[0], images: [] }, pack.groups[0].entries[1]] }] }));
});
