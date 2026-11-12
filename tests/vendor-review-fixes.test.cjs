'use strict';

// Root fixes for the slice 2-4 security review (November 12, 2026):
// F1 vendor job outcomes keep truthful codes; F2 cache notices stay fixed text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { VENDOR_MESSAGES } = require('../src/vendor-profiles.cjs');
const { vendorRefusal } = require('../src/vendor-execution.cjs');
const realOutputs = require('../src/outputs.cjs');
const { harness, load, noPrivate } = require('./vendor-s34-fixtures.cjs');

test('F1: ordinary job outcome codes keep their own fixed text for vendor items', () => {
  for (const code of ['PUBLICATION_UNCERTAIN', 'CANCELLED', 'INPUT_CHANGED', 'SOURCE_CHECK_INCOMPLETE']) {
    const refusal = vendorRefusal(Object.assign(new Error('EACCES PRIVATE X:\\private\\stage.mkv'), { code }));
    assert.equal(refusal.reasonCode, code); assert.equal(refusal.reason, VENDOR_MESSAGES[code]);
    assert.doesNotMatch(refusal.reason, /PRIVATE|EACCES|\\/);
  }
  assert.match(VENDOR_MESSAGES.PUBLICATION_UNCERTAIN, /may exist in the output folder/);
  assert.equal(vendorRefusal({ code: 'SOMETHING_ELSE' }).reasonCode, 'VENDOR_ENCODE_FAILED');
});

test('F1: an uncertain vendor publication is reported as uncertain, never as "nothing published"', async t => {
  const { EncoderService } = load('src/encoder-service.cjs', value => value, { './outputs.cjs': { ...realOutputs,
    publishOutput: async () => { throw Object.assign(new Error('EBUSY PRIVATE X:\\private\\copy.mkv'), { code: 'PUBLICATION_UNCERTAIN' }); } } });
  const h = await harness(t, { Service: EncoderService });
  const plan = await h.prepare(), result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'failed'); assert.equal(item.reasonCode, 'PUBLICATION_UNCERTAIN');
  assert.equal(item.reason, VENDOR_MESSAGES.PUBLICATION_UNCERTAIN);
  assert.equal(item.outputDisposition.kind, 'publication-uncertain'); assert.equal(item.outputDisposition.published, null);
  noPrivate(h.states);
});

test('F2: a vendor batch shows fixed text when inspection reuse is unavailable', async t => {
  const h = await harness(t, { serviceOptions: { inspectionCache: {
    warning: 'EPERM: operation not permitted, open \'C:\\Users\\secret\\inspection-cache\\x.json\'',
    lookup: async () => null, store: async () => {} } } });
  await h.prepare();
  const notices = h.states.map(state => state.preparation?.notice).filter(Boolean);
  assert.ok(notices.length > 0, 'the reuse notice is shown');
  for (const notice of notices) assert.equal(notice, VENDOR_MESSAGES.VENDOR_INSPECTION_REUSE_UNAVAILABLE);
  noPrivate(h.states);
});
