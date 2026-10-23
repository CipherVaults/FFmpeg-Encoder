'use strict';

// Synthetic EBML bytes only; no encoded media or qualification authority.
function size(value) {
  value = BigInt(value); let width = 1;
  while (value >= (1n << BigInt(width * 7)) - 1n) width++;
  if (width > 8) throw new Error('Synthetic EBML size exceeds eight bytes.');
  const bytes = Buffer.alloc(width); let encoded = value | (1n << BigInt(width * 7));
  for (let index = width - 1; index >= 0; index--) { bytes[index] = Number(encoded & 255n); encoded >>= 8n; } return bytes;
}
function element(id, data) { return Buffer.concat([Buffer.from(id, 'hex'), size(data.length), data]); }
function uint(value) { value = BigInt(value); const bytes = []; do { bytes.unshift(Number(value & 255n)); value >>= 8n; } while (value); return Buffer.from(bytes); }
function syntheticContainer({ frameRate = '30/1', declaredDurationTicks = '3200', payload = Buffer.alloc(0), defaultDurationNs, timestampScaleNs = '1000000', trackEnabled } = {}) {
  if (!['24/1', '25/1', '30/1'].includes(frameRate) || !/^[1-9]\d{0,4}$/.test(String(declaredDurationTicks)) || BigInt(declaredDurationTicks) > 60000n) throw new Error('Synthetic timing exceeds the reviewed bounds.');
  if (typeof payload === 'string') payload = Buffer.from(payload, 'utf8');
  if (!Buffer.isBuffer(payload) || payload.length > 15 * 1024 * 1024) throw new Error('Synthetic payload must be a bounded Buffer or string.');
  defaultDurationNs ??= 1000000000n / BigInt(frameRate.slice(0, -2));
  for (const value of [defaultDurationNs, timestampScaleNs, ...(trackEnabled === undefined ? [] : [trackEnabled])]) if (!/^\d{1,20}$/.test(String(value)) || BigInt(value) > 0xffffffffffffffffn) throw new Error('Synthetic scalar exceeds unsigned eight-byte bounds.');
  const duration = Buffer.alloc(8); duration.writeDoubleBE(Number(declaredDurationTicks));
  const header = element('1a45dfa3', Buffer.concat([element('4286', uint(1)), element('42f7', uint(1)), element('42f2', uint(4)), element('42f3', uint(8)), element('4282', Buffer.from('matroska')), element('4287', uint(4)), element('4285', uint(2))]));
  const info = element('1549a966', Buffer.concat([element('2ad7b1', uint(timestampScaleNs)), element('4489', duration)]));
  const entry = element('ae', Buffer.concat([element('d7', uint(1)), element('73c5', uint(1)), element('83', uint(1)), element('86', Buffer.from('V_MPEGH/ISO/HEVC')), element('23e383', uint(defaultDurationNs)), ...(trackEnabled === undefined ? [] : [element('b9', uint(trackEnabled))])]));
  return Buffer.concat([header, element('18538067', Buffer.concat([info, element('1654ae6b', entry), element('ec', payload)]))]);
}

module.exports = { syntheticContainer };
