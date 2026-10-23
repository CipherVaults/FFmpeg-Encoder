'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { REMUX_METADATA_POLICY, classifyRemuxMetadataTag, projectRequiredRemuxTags } = require('../src/remux-metadata-policy.cjs');

test('finite descriptive tool, authorship and capture-date tags request copy with warning consequences', () => {
  for (const key of REMUX_METADATA_POLICY.descriptiveTagKeys) {
    for (const scope of ['container', 'stream', 'chapter']) {
      const result = classifyRemuxMetadataTag(key.toUpperCase(), { scope });
      assert.equal(result.normalizedKey, key);
      assert.equal(result.classification, 'descriptive');
      assert.equal(result.preservation, 'attempt-copy');
      assert.equal(result.mismatch, 'warning');
      assert.ok(result.reason);
      assert.equal(Object.isFrozen(result), true);
    }
  }
  assert.equal(REMUX_METADATA_POLICY.version, 1);
  assert.equal(Object.isFrozen(REMUX_METADATA_POLICY), true);
  assert.equal(Object.isFrozen(REMUX_METADATA_POLICY.descriptiveTagKeys), true);
});

test('scope keeps track and chapter labels functional while container labels are descriptive', () => {
  for (const key of ['title', 'name']) {
    assert.equal(classifyRemuxMetadataTag(key, { scope: 'container' }).mismatch, 'warning');
    for (const scope of ['stream', 'chapter']) {
      const result = classifyRemuxMetadataTag(key, { scope });
      assert.equal(result.classification, 'functional');
      assert.equal(result.preservation, 'required');
      assert.equal(result.mismatch, 'error');
    }
  }
  for (const key of ['description', 'synopsis']) {
    assert.equal(classifyRemuxMetadataTag(key, { scope: 'container' }).mismatch, 'warning');
    assert.equal(classifyRemuxMetadataTag(key, { scope: 'stream' }).mismatch, 'error');
  }
});

test('functional language, attachments, audio gain, timing, geometry and color tags are never descriptive by prefix', () => {
  for (const key of REMUX_METADATA_POLICY.functionalTagKeys) {
    const result = classifyRemuxMetadataTag(key, { scope: 'stream' });
    assert.equal(result.classification, 'functional');
    assert.equal(result.mismatch, 'error');
  }
  assert.equal(classifyRemuxMetadataTag('encoder', { scope: 'stream' }).mismatch, 'warning');
  assert.equal(classifyRemuxMetadataTag('encoder_delay', { scope: 'stream' }).mismatch, 'error');
});

test('existing muxer-derived tags are transformed and excluded from semantic header tags without waiving actual counts or timing', () => {
  for (const key of REMUX_METADATA_POLICY.derivedTagKeys) {
    const result = classifyRemuxMetadataTag(key, { scope: 'stream' });
    assert.equal(result.classification, 'operation-derived');
    assert.equal(result.preservation, 'container-derived');
    assert.equal(result.mismatch, 'replacement');
  }
  assert.deepEqual(projectRequiredRemuxTags({ title: 'Track', encoder: 'Tool', duration: '00:00:02', number_of_frames: '120', number_of_bytes: '100' }, { scope: 'stream' }), { title: 'Track' });
});

test('unassessed, namespaced and prototype-looking exact keys retain strict consequences', () => {
  for (const key of ['unknown_playback_mode', 'vendor_id_extra', 'x-encoder', 'com.vendor.creation_time', 'license', '__proto__', 'constructor', 'prototype']) {
    const result = classifyRemuxMetadataTag(key, { scope: 'container' });
    assert.equal(result.classification, 'unassessed');
    assert.equal(result.preservation, 'required');
    assert.equal(result.mismatch, 'error');
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('classification requires a bounded exact tag and explicit supported scope', () => {
  for (const key of [null, undefined, 1, '', 'a'.repeat(257), 'bad\0tag']) {
    assert.throws(() => classifyRemuxMetadataTag(key, { scope: 'stream' }), TypeError);
  }
  for (const scope of [undefined, 'file', '__proto__']) {
    assert.throws(() => classifyRemuxMetadataTag('title', { scope }), TypeError);
  }
  let accessed = false;
  assert.throws(() => classifyRemuxMetadataTag('title', { get scope() { accessed = true; return 'stream'; } }), TypeError);
  assert.equal(accessed, false);
});

test('required-tag projection omits descriptions only and retains track, attachment and unknown semantics', () => {
  const tags = JSON.parse('{"title":"Signs","language":"eng","filename":"font.ttf","mimetype":"application/x-truetype-font","vendor_id":"FFMP","encoder":"A tool","creation_time":"A capture date","SOURCE_CREATION_TIME":"A capture date","unknown_role":"Critical until assessed","__proto__":"Original","constructor":"Also original"}');
  const projected = projectRequiredRemuxTags(tags, { scope: 'stream' });
  assert.deepEqual(Object.keys(projected), ['title', 'language', 'filename', 'mimetype', 'unknown_role', '__proto__', 'constructor']);
  for (const key of Object.keys(projected)) { assert.equal(Object.hasOwn(projected, key), true); assert.equal(projected[key], tags[key]); }
  assert.equal(Object.getPrototypeOf(projected), Object.prototype);
  assert.equal(Object.isFrozen(projected), true);
  assert.throws(() => { projected.language = 'fra'; }, TypeError);
  assert.equal(tags.vendor_id, 'FFMP', 'projection does not mutate source tags');
  assert.equal(Object.prototype.polluted, undefined);
});

test('projection scope keeps chapter labels and track descriptions while omitting only container descriptions', () => {
  const tags = { title: 'Chapter or track', description: 'Potential track role', comment: 'Editorial' };
  assert.deepEqual(projectRequiredRemuxTags(tags, { scope: 'stream' }), { title: tags.title, description: tags.description });
  assert.deepEqual(projectRequiredRemuxTags(tags, { scope: 'chapter' }), { title: tags.title, description: tags.description });
  assert.deepEqual(projectRequiredRemuxTags(tags, { scope: 'container' }), {});
});

test('projection rejects accessors, hidden/symbol/inherited data and unsafe values without invoking them', () => {
  let accessed = false;
  const getter = {}; Object.defineProperty(getter, 'vendor_id', { enumerable: true, get() { accessed = true; return 'FFMP'; } });
  const hidden = {}; Object.defineProperty(hidden, 'title', { value: 'Hidden' });
  const inherited = Object.create({ title: 'Inherited' }); inherited.vendor_id = 'FFMP';
  for (const tags of [getter, hidden, inherited, { [Symbol('tag')]: 'value' }, { title: { toString() { accessed = true; return 'Text'; } } }, { vendor_id: 'bad\0text' }]) {
    assert.throws(() => projectRequiredRemuxTags(tags, { scope: 'stream' }), TypeError);
  }
  assert.equal(accessed, false);
});
