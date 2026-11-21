'use strict';

const path = require('node:path');
const { types } = require('node:util');
const { createHash } = require('node:crypto');
const { PROFILES, describeRecipe, buildEncodeArgs, selectVideo, mappedStreams } = require('./media.cjs');
const { provenanceArgs, MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('./provenance.cjs');
const { VENDOR_MESSAGES, vendorFragments } = require('./vendor-profiles.cjs');

const bindings = new WeakSet();
const twinCommands = new WeakMap();
const COPY_SPECIFIERS = Object.freeze({ audio: 'a', subtitle: 's', attachment: 't' });
const PREFIX = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1',
  '-n', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi', '-i'];
const TRANSFERS = ['bt709', 'gamma22', 'gamma28', 'smpte170m', 'smpte240m', 'iec61966-2-1', 'bt2020-10', 'bt2020-12'];
const DISPOSITIONS = ['default', 'dub', 'original', 'comment', 'forced', 'hearing_impaired', 'visual_impaired', 'descriptions'];
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
function guard(name, condition, code = 'VENDOR_ARGV_SHAPE') {
  if (!condition) throw Object.assign(new Error(VENDOR_MESSAGES[code]), { code });
}
function dataRecord(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === keys.length && keys.every(key => Object.hasOwn(fields, key)
    && fields[key].enumerable && Object.hasOwn(fields[key], 'value'));
}
function stringArray(value) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => fields[i])
    .every(field => field && field.enumerable && Object.hasOwn(field, 'value') && typeof field.value === 'string' && !field.value.includes('\0'));
}
function localPath(value) {
  return typeof value === 'string' && value.length > 0 && !/[\0\r\n]/.test(value)
    && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value))
    && (!/^[a-z][a-z0-9+.-]*:/i.test(value) || /^[a-z]:[\\/]/i.test(value));
}

// Only main may call this factory with its validated DXGI observation. The
// frozen brand proves local issuance, not hardware execution or qualification.
function createVendorBinding(value) {
  guard('binding-record', dataRecord(value, ['vendor', 'adapterIndex', 'luid', 'vendorId', 'deviceId', 'umdVersion', 'description']), 'VENDOR_DEVICE_INVALID');
  guard('binding-index', Number.isSafeInteger(value.adapterIndex) && value.adapterIndex >= 0 && value.adapterIndex <= 63, 'VENDOR_DEVICE_INVALID');
  guard('binding-identity', ['AMD', 'Intel'].includes(value.vendor) && value.vendorId === (value.vendor === 'AMD' ? 0x1002 : 0x8086)
    && Number.isInteger(value.deviceId) && value.deviceId >= 0 && value.deviceId <= 0xffffffff
    && typeof value.luid === 'string' && /^[0-9a-f]{8}:[0-9a-f]{8}$/.test(value.luid)
    && typeof value.umdVersion === 'string' && /^\d{1,5}(\.\d{1,5}){3}$/.test(value.umdVersion)
    && typeof value.description === 'string' && value.description.length <= 128 && !/[\x00-\x1f\x7f]/.test(value.description), 'VENDOR_DEVICE_INVALID');
  const result = Object.freeze({ ...value });
  bindings.add(result);
  return result;
}

// Main passes the ordinary builder's own inspected source and output choices,
// never renderer argv. The branded receipt snapshots the exact twin array and
// separately fixes the output-kind ordinals allowed in the copy block.
function createVendorTwinCommand({ input, output, settings, probe, colorEvidence, outputId, generationDescription }) {
  const args = Object.freeze(buildEncodeArgs({ input, output, settings, probe, colorEvidence, outputId, generationDescription }));
  const mapped = mappedStreams(probe, selectVideo(probe));
  const maps = mapped.map(stream => String(stream.index));
  const ordinals = { audio: 0, subtitle: 0, attachment: 0 };
  const copy = mapped.slice(1).flatMap(({ codec_type: kind }) => [`-c:${COPY_SPECIFIERS[kind]}:${ordinals[kind]++}`, 'copy']);
  const token = Object.freeze({ args });
  twinCommands.set(token, { args, maps, copy });
  return token;
}

// Consume the whole grammar and bind each consumed position to that exact
// canonical command. No unparsed tokens, untyped copy aliases, or guessed
// tracks can survive. Offsets are derived by parsing, not searched in argv.
function parseTwin(args, twinSettings, bitDepth, command) {
  guard('argv-data', stringArray(args));
  let cursor = 0;
  const exact = (start, end) => same(args.slice(start, end), command.args.slice(start, end));
  const take = (name, expected) => {
    const end = cursor + expected.length;
    guard(name, same(args.slice(cursor, end), expected) && exact(cursor, end));
    cursor = end;
  };
  take('prefix', PREFIX);
  const input = args[cursor], output = args.at(-1);
  guard('paths', exact(cursor, cursor + 1) && output === command.args.at(-1) && localPath(input) && localPath(output)
    && path.win32.normalize(input).toLowerCase() !== path.win32.normalize(output).toLowerCase());
  cursor++;
  const { maps, copy } = command;
  take('map-set', maps.flatMap(index => ['-map', `0:${index}`]));
  const recipe = describeRecipe(twinSettings);
  take('mapping-codec', ['-map_metadata', '0', '-map_chapters', '0', '-c:v:0', recipe.encoder]);
  const codecValue = cursor - 1;
  take('stream-codecs', copy);
  for (const [index, sourceIndex] of maps.entries()) {
    take('stream-metadata', [`-map_metadata:s:${index}`, `0:s:${sourceIndex}`]);
    if (args[cursor] === `-metadata:s:${index}`) {
      guard('creation-alias', exact(cursor, cursor + 2) && args[cursor + 1]?.startsWith('SOURCE_CREATION_TIME=')); cursor += 2;
    }
    guard('stream-disposition', exact(cursor, cursor + 2) && args[cursor] === `-disposition:${index}` && typeof args[cursor + 1] === 'string'
      && (args[cursor + 1] === '0' || (() => {
        const flags = args[cursor + 1].split('+');
        return flags.every(flag => DISPOSITIONS.includes(flag)) && new Set(flags).size === flags.length
          && !(flags.includes('original') && flags.includes('dub'));
      })()));
    cursor += 2;
  }
  const runStart = cursor;
  take('twin-options', recipe.args.slice(2));
  const pixelStart = cursor;
  take('twin-pixel', ['-pix_fmt:v:0', bitDepth === 10 ? '+yuv420p10le' : '+yuv420p']);
  take('timing', ['-fps_mode:v:0', 'passthrough', '-color_trc:v:0']);
  guard('transfer', exact(cursor, cursor + 1) && TRANSFERS.includes(args[cursor]));
  cursor++;
  for (const option of ['-color_primaries:v:0', '-colorspace:v:0', '-color_range:v:0']) {
    if (args[cursor] === option) {
      guard('color-value', exact(cursor, cursor + 2) && /^[a-z0-9-]+$/.test(args[cursor + 1] || '')
        && !['unknown', 'unspecified', 'reserved', 'n/a'].includes(args[cursor + 1]));
      cursor += 2;
    }
  }
  if (args[cursor] === '-metadata') {
    const start = cursor;
    const id = args[cursor + 3];
    cursor += 4;
    let description, valid = same(args.slice(start, start + 3), ['-metadata', `${MARKER_KEY}=1`, '-metadata'])
      && typeof id === 'string' && id.startsWith(`${OUTPUT_ID_KEY}=`);
    if (args[cursor] === '-metadata') {
      const value = args[cursor + 1];
      valid &&= typeof value === 'string' && value.startsWith(`${GENERATION_KEY}=`);
      try { description = JSON.parse(value.slice(GENERATION_KEY.length + 1)); } catch { valid = false; }
      cursor += 2;
    }
    let canonical;
    try { canonical = provenanceArgs(id.slice(OUTPUT_ID_KEY.length + 1), description); } catch { valid = false; }
    guard('provenance', valid && exact(start, cursor) && same(args.slice(start, cursor), canonical));
  }
  // This also rejects every device/hwaccel/filter alias, duplicate -i and second
  // output: none is a production above, including before the final muxer block.
  take('terminal', ['-default_mode', 'passthrough', '-f', 'matroska', output]);
  guard('complete', cursor === args.length && cursor === command.args.length);
  return { codecValue, runStart, pixelStart };
}

function overlayVendorArgs(twinArgs, options) {
  guard('options-record', dataRecord(options, ['twinSettings', 'profile', 'settings', 'bitDepth', 'binding', 'twinCommand']));
  const { twinSettings, profile, settings, bitDepth, binding, twinCommand } = options;
  guard('ordinary-device', !PROFILES.includes(profile) || binding === null || binding === undefined, 'VENDOR_DEVICE_UNEXPECTED');
  const fragment = vendorFragments(profile, settings, bitDepth);
  const twin = PROFILES.find(row => row.id === profile.twin);
  guard('twin-settings', dataRecord(twinSettings, ['profileId', 'preset', 'quality'])
    && twinSettings.profileId === twin.id && twinSettings.preset === twin.defaultPreset && twinSettings.quality === twin.quality.default);
  guard('binding-required', binding !== null && binding !== undefined, 'VENDOR_DEVICE_REQUIRED');
  guard('binding-brand', bindings.has(binding), 'VENDOR_DEVICE_INVALID');
  guard('binding-vendor', binding.vendor === profile.hardware, 'VENDOR_DEVICE_MISMATCH');
  const command = twinCommands.get(twinCommand);
  guard('twin-command', command !== undefined);
  const { codecValue, runStart, pixelStart } = parseTwin(twinArgs, twinSettings, bitDepth, command);
  const device = ['-init_hw_device', `d3d11va=ffenc_d3d:${binding.adapterIndex}`];
  if (profile.hardware === 'Intel') device.push('-init_hw_device', 'qsv=ffenc_qsv@ffenc_d3d');
  device.push('-filter_hw_device', profile.hardware === 'AMD' ? 'ffenc_d3d' : 'ffenc_qsv');
  const args = [...twinArgs.slice(0, 12), ...device, ...twinArgs.slice(12, codecValue), profile.encoder,
    ...twinArgs.slice(codecValue + 1, runStart), ...fragment.preset, ...fragment.options,
    '-filter:v:0', fragment.uploadFilters.join(','), ...fragment.pixelArgs, ...twinArgs.slice(pixelStart + 2)];
  guard('overlay-final', !args.includes(twin.encoder) && !args.includes('-crf:v:0') && !args.includes('-x265-params')
    && args.filter(value => value === profile.encoder).length === 1 && args.filter(value => value === '-pix_fmt:v:0').length === 1);
  return args;
}

// JSON string literals have no literal newlines. Joining them with LF is an
// unambiguous canonical token encoding (including empty strings and Unicode).
function vendorArgsHash(argv) {
  guard('hash-data', stringArray(argv));
  return createHash('sha256').update(argv.map(value => JSON.stringify(value)).join('\n')).digest('hex');
}

module.exports = { createVendorBinding, createVendorTwinCommand, overlayVendorArgs, vendorArgsHash };
