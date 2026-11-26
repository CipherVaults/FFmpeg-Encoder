'use strict';

const { ToolError } = require('./process-runner.cjs');
const { readNativeMetadata } = require('./remux-native-reader.cjs');

const WINDOWS_AAC_FAMILY = 'windows-pcm-aac-range-v1';
const EXPLICIT_AAC_DISCARD_CLOCK = 'matroska-explicit-aac-discard-v1';
const EXPLICIT_AAC_DISCARD_ALIGNMENT = 'decoded-after-signalled-skip-and-terminal-discard';
const AAC_UNIT = 1024n;

function isWindowsAacTuple(rate, channels, layout) {
  return (Number(rate) === 44100 && channels === 2 && layout === 'stereo')
    || (Number(rate) === 48000 && channels === 1 && layout === 'mono');
}
function requireClock(valid, reason) {
  if (!valid) throw new ToolError('OPERATION_EVIDENCE_AAC_DISCARD', reason);
}
function nearest(numerator, denominator) {
  const value = numerator < 0n ? -numerator : numerator;
  const magnitude = (2n * value + denominator) / (2n * denominator);
  return numerator < 0n ? -magnitude : magnitude;
}

async function observeExplicitAacClock({ file, identity, sampleRate, phaseSamples, selectedSamples, decodedFrames, packets,
  budget, signal }) {
  const rate = BigInt(sampleRate), phase = BigInt(phaseSamples), selected = BigInt(selectedSamples);
  requireClock((rate === 44100n || rate === 48000n) && (phase === 0n || phase === 1n)
    && selected > 0n && selected <= rate * 3n, 'The explicit AAC clock needs the measured sample rate and short selected source.');
  const blocks = (selected + AAC_UNIT - 1n) / AAC_UNIT, tail = blocks * AAC_UNIT - selected;
  const codecDelayNs = nearest(AAC_UNIT * 1000000000n, rate);
  const discardPaddingNs = nearest(tail * 1000000000n, rate);
  const codecDelayTicks = nearest(codecDelayNs, 1000000n);
  requireClock(packets.length === Number(blocks + 1n) && decodedFrames.length === Number(blocks),
    'The complete coded and decoded AAC counts do not match the selected samples.');
  const normalDuration = AAC_UNIT * 1000n / rate;
  for (const [index, packet] of packets.entries()) {
    const head = index === 0, terminal = index === Number(blocks);
    const first = phase + (BigInt(index) - 1n) * AAC_UNIT;
    const duration = terminal && tail > 0n ? nearest((AAC_UNIT - tail) * 1000n, rate) : normalDuration;
    requireClock(packet.pts === nearest(first * 1000n, rate) && packet.duration === duration
      && packet.skip === (head ? AAC_UNIT : 0n) && packet.discard === (terminal ? tail : 0n)
      && packet.signalled === (head || terminal && tail > 0n),
    'AAC packets did not carry the exact sampled clock, priming and terminal discard.');
    if (!head) {
      const frame = decodedFrames[index - 1];
      requireClock(frame.pts === packet.pts && frame.samples === AAC_UNIT - (terminal ? tail : 0n),
        'A decoded AAC frame left the verified post-priming, post-discard sample grid.');
    }
  }
  return readNativeMetadata({ file, identity, signal, family: 'matroska', maxRecords: budget.maxRecords,
    timeoutMs: budget.timeoutMs, seekRecords: true, async withMetadata(meta) {
      const bytes = async (nodes, name, maximum = 8) => {
        const matches = nodes.filter(node => node.name === name);
        requireClock(matches.length === 1, 'A unique native Matroska ' + name + ' is required.');
        const { body, end } = matches[0];
        requireClock(end > body && end - body <= maximum, 'A native Matroska clock field exceeds its bound.');
        return meta.read(body, end - body);
      };
      const uint = buffer => BigInt('0x' + buffer.toString('hex'));
      const track = meta.nodes.filter(node => node.name === 'TrackEntry');
      requireClock(track.length === 2 && uint(await bytes(track[0].children, 'TrackType')) === 1n
        && uint(await bytes(track[1].children, 'TrackType')) === 2n
        && (await bytes(track[1].children, 'CodecID', 16)).toString('ascii') === 'A_AAC',
      'The staged Matroska must contain the expected video and native AAC tracks.');
      const audioTrack = String(uint(await bytes(track[1].children, 'TrackNumber')));
      requireClock(uint(await bytes(meta.nodes, 'TimestampScale')) === 1000000n
        && uint(await bytes(track[1].children, 'CodecDelay')) === codecDelayNs,
      'The Matroska output clock or native AAC priming differs.');
      const physical = meta.ebmlWalk.packets.filter(packet => packet.trackId === audioTrack);
      const padding = meta.ebmlWalk.paddings;
      requireClock(discardPaddingNs === 0n ? padding.length === 0 : padding.length === 1
        && padding[0].trackId === audioTrack && BigInt(padding[0].nanoseconds) === discardPaddingNs,
      'Native AAC discard is absent, interior, foreign or different from the exact sample count.');
      requireClock(physical.length === packets.length && physical.every((block, index) =>
        !block.lacing && BigInt(block.pts) === packets[index].pts + codecDelayTicks),
      'The physical Matroska AAC block clock differs from the complete observed packet clock.');
      const stored = await bytes(meta.nodes, 'Duration');
      requireClock(stored.length === 4 || stored.length === 8, 'Native Matroska duration has an unsupported representation.');
      const durationTicks = stored.length === 4 ? stored.readFloatBE() : stored.readDoubleBE();
      requireClock(Number.isSafeInteger(durationTicks) && durationTicks > 0, 'Native Matroska duration must retain exact 1 ms ticks.');
      return Object.freeze({ durationTicks, discardPaddingNs: Number(discardPaddingNs) });
    } });
}

module.exports = { WINDOWS_AAC_FAMILY, EXPLICIT_AAC_DISCARD_CLOCK, EXPLICIT_AAC_DISCARD_ALIGNMENT,
  isWindowsAacTuple, observeExplicitAacClock };
