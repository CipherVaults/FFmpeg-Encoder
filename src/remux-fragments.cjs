'use strict';
const { ToolError } = require('./process-runner.cjs');
const need = (v, message) => { if (!v) throw new ToolError('REMUX_SOURCE_FRAGMENT_UNVERIFIED', message); };
// Timing and counts only. Never read mdat or allocate an array per sample.
async function fragmentCoverage({ top, movieBoxes, boxes, read, maxRecords }) {
  const defaults = new Map(), result = new Map(); let total = 0;
  const mvex = movieBoxes.filter(b => b.type === 'mvex'); need(mvex.length === 1, 'Fragmented source needs one mvex.');
  for (const box of await boxes(mvex[0].body, mvex[0].end, 2)) if (box.type === 'trex') {
    need(box.end - box.body === 24, 'Malformed fragment defaults.'); const b = await read(box.body, 24), id = b.readUInt32BE(4);
    need(b.readUInt32BE() === 0 && id > 0 && !defaults.has(id) && b.readUInt32BE(8) === 1, 'Unsupported fragment track/sample-description defaults.');
    defaults.set(id, { duration: b.readUInt32BE(12), size: b.readUInt32BE(16) });
  }
  for (const moof of top.filter(b => b.type === 'moof')) for (const traf of (await boxes(moof.body, moof.end, 1)).filter(b => b.type === 'traf')) {
    const fields = await boxes(traf.body, traf.end, 2), headers = fields.filter(b => b.type === 'tfhd'), clocks = fields.filter(b => b.type === 'tfdt');
    need(headers.length === 1 && clocks.length === 1, 'Each fragment track needs one tfhd and one tfdt.');
    const h = headers[0], b = await read(h.body, Math.min(40, h.end - h.body));
    need(b.length >= 8 && b[0] === 0, 'Malformed fragment track header.');
    const flags = b.readUIntBE(1, 3), id = b.readUInt32BE(4), base = defaults.get(id); let at = 8;
    need(base && (flags & ~0x03003b) === 0, 'Unknown fragment track or unsupported tfhd flags.');
    need(!(flags & 0x10000) || !fields.some(b => b.type === 'trun'), 'An empty fragment track cannot declare sample runs.');
    if (flags & 1) at += 8;
    if (flags & 2) { need(at + 4 <= b.length && b.readUInt32BE(at) === 1, 'Changed fragment sample description.'); at += 4; }
    const value = flag => { if (!(flags & flag)) return null; need(at + 4 <= b.length, 'Truncated fragment defaults.'); const n = b.readUInt32BE(at); at += 4; return n; };
    const duration = value(8) ?? base.duration, size = value(16) ?? base.size; value(32);
    need(at === h.end - h.body, 'Invalid fragment track-header extent.');
    const cb = clocks[0], c = await read(cb.body, cb.end - cb.body);
    need([0, 1].includes(c[0]) && c.length === (c[0] ? 12 : 8) && c.readUIntBE(1, 3) === 0, 'Malformed fragment decode clock.');
    let clock = c[0] ? c.readBigUInt64BE(4) : BigInt(c.readUInt32BE(4));
    const state = result.get(id) || { count: 0, clock: 0n, minimum: null, maximum: null, endDts: null };
    need(state.endDts === null || clock >= state.endDts, 'Fragment decode clocks go backwards.');
    for (const trun of fields.filter(b => b.type === 'trun')) {
      const t = await read(trun.body, 8), f = t.readUIntBE(1, 3), count = t.readUInt32BE(4);
      need([0, 1].includes(t[0]) && (f & ~0xf05) === 0 && count > 0 && (total += count) <= maxRecords, 'Invalid or excessive fragment sample coverage.');
      const head = 8 + (f & 1 ? 4 : 0) + (f & 4 ? 4 : 0), width = [0x100, 0x200, 0x400, 0x800].filter(bit => f & bit).length * 4;
      need(trun.end - trun.body === head + count * width, 'Malformed fragment run extent.');
      for (let i = 0; i < count;) {
        const amount = Math.min(512, count - i), rows = width ? await read(trun.body + head + i * width, amount * width) : null;
        for (let j = 0; j < amount; j++) { let pos = j * width;
          const field = (bit, fallback, signed = false) => { if (!(f & bit)) return fallback; const n = rows[signed ? 'readInt32BE' : 'readUInt32BE'](pos); pos += 4; return n; };
          const d = field(0x100, duration), bytes = field(0x200, size); field(0x400, 0); const offset = field(0x800, 0, t[0] === 1);
          need(d > 0 && bytes > 0, 'Fragment sample duration/size is unavailable.');
          const first = clock + BigInt(offset), end = first + BigInt(d);
          if (state.minimum === null || first < state.minimum) state.minimum = first;
          if (state.maximum === null || end > state.maximum) state.maximum = end;
          clock += BigInt(d); state.clock += BigInt(d); state.count++;
        } i += amount;
      }
    }
    state.endDts = clock; result.set(id, state);
  }
  need(total > 0, 'Fragmented source has no verified fragment sample coverage.'); return result;
}
module.exports = { fragmentCoverage };
