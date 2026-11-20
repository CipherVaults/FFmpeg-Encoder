'use strict';
// Original, generated MPEG-1 Layer III test signal. No downloaded or encoded media.
// Each independent granule encodes one signed nonzero spectral coefficient (Huffman table 1).
// Vary its sign and gain between frames/channels; ancillary bytes identify frame order.
function bits(buffer, offset = 0) {
  let i = offset;
  return (value, width) => {
    for (let b = width - 1; b >= 0; b--, i++) buffer[i >> 3] |= ((value >> b) & 1) << (7 - (i & 7));
  };
}
function makeLayer3({ channels = 2, rate = 48000, frames = 40, variable = false } = {}) {
  const rateIndex = [44100, 48000, 32000].indexOf(rate);
  if (![1, 2].includes(channels) || rateIndex < 0 || !Number.isInteger(frames) || frames < 1 || frames > 256) throw new Error('fixture limits');
  let remainder = 0;
  return Buffer.concat(Array.from({ length: frames }, (_, index) => {
    const slot = variable ? index % 3 : 1, kbps = [96, 128, 160][slot];
    remainder += (144000 * kbps) % rate;
    const padding = remainder >= rate ? 1 : 0;
    if (padding) remainder -= rate;
    const frame = Buffer.alloc(Math.floor(144000 * kbps / rate) + padding);
    frame.set([0xff, 0xfb, ([7, 9, 10][slot] << 4) | (rateIndex << 2) | (padding << 1), channels === 1 ? 0xc0 : 0]);
    const side = bits(frame, 32), mainOffset = 4 + (channels === 1 ? 17 : 32);
    side(0, 9); side(0, channels === 1 ? 5 : 3);
    for (let ch = 0; ch < channels; ch++) side(0, 4);
    const main = bits(frame, mainOffset * 8);
    for (let granule = 0; granule < 2; granule++) for (let ch = 0; ch < channels; ch++) {
      side(3, 12); side(1, 9); side(188 + ((index * 5 + ch * 3 + granule) % 18), 8);
      side(0, 4); side(0, 1); side(1, 5); side(1, 5); side(1, 5); side(0, 4); side(0, 3);
      side(0, 1); side(0, 1); side(0, 1);
      main(1, 2); main((index + ch + granule) % 2, 1);
    }
    frame.writeUInt32BE(index, frame.length - 4);
    return frame;
  }));
}
module.exports = { makeLayer3 };
