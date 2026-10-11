'use strict';

const { ToolError } = require('./process-runner.cjs');

// Evidence is descriptive, never an executable transform or preservation grant.
// Keep rationals as decimal integer strings: Number would round long timestamps.
const EVIDENCE_VERSION = 2;
const EVIDENCE_LIMITS = Object.freeze({ streams: 1024, chapters: 16384, relationships: 256, sideData: 64, nodes: 16384, depth: 8, string: 16384, characters: 524288 });
const UNKNOWN = new Set(['', 'n/a', 'unknown', 'unspecified', 'reserved']);
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new ToolError('INVALID_PROBE', message); };
const known = value => ({ state: 'known', value });
const unknown = reason => ({ state: 'unknown', reason });
const malformed = reason => ({ state: 'malformed', reason });

function absent(value) {
  if (value === undefined) return unknown('not-reported');
  if (typeof value === 'string' && UNKNOWN.has(value.trim().toLowerCase())) return unknown('unspecified');
  return null;
}

function text(value) {
  const missing = absent(value);
  if (missing) return missing;
  return typeof value === 'string' && value.length <= 1024 && !value.includes('\0')
    ? known(value) : malformed('invalid-text');
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const missing = absent(value);
  if (missing) return missing;
  if (!['string', 'number'].includes(typeof value) || !/^-?\d+$/.test(String(value))
      || String(value).length > 40 || (typeof value === 'number' && !Number.isSafeInteger(value))) return malformed('invalid-integer');
  const parsed = BigInt(value);
  if (parsed < BigInt(minimum) || parsed > BigInt(maximum)) return malformed('integer-out-of-range');
  return known(parsed.toString());
}

// ffprobe reports MOV track IDs and TS PIDs in hexadecimal. Keep their numeric
// identity comparable without accepting arbitrary numeric coercion or unsafe JS
// integers. A PID's narrower range is imposed only in the transport context.
function identifier(value, { minimum = 0, maximum = '18446744073709551615' } = {}) {
  const missing = absent(value);
  if (missing) return missing;
  if (typeof value === 'string' && /^0x[0-9a-f]{1,16}$/i.test(value)) return integer(BigInt(value).toString(), { minimum, maximum });
  return integer(value, { minimum, maximum });
}

function rational(value, { positive = false, nonnegative = false, separator = '/', decimal = false } = {}) {
  const missing = absent(value);
  if (missing) return missing;
  if (!['string', 'number'].includes(typeof value) || String(value).length > 96
      || (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))) return malformed('invalid-rational');
  let numerator, denominator;
  const raw = String(value);
  if (decimal) {
    const match = /^(-?)(\d{1,40})(?:\.(\d{1,18}))?$/.exec(raw);
    if (!match) return malformed('invalid-decimal');
    numerator = BigInt(`${match[1]}${match[2]}${match[3] || ''}`);
    denominator = 10n ** BigInt((match[3] || '').length);
  } else {
    const parts = raw.split(separator);
    if (parts.length !== 2 || parts.some(part => !/^-?\d{1,40}$/.test(part))) return malformed('invalid-rational');
    numerator = BigInt(parts[0]); denominator = BigInt(parts[1]);
    // ffprobe uses these particular sentinels for unavailable rates/aspect ratios.
    if (numerator === 0n && denominator === 0n) return unknown('zero-over-zero');
    if (separator === ':' && numerator === 0n && denominator === 1n) return unknown('unspecified-aspect-ratio');
    if (denominator <= 0n) return malformed('nonpositive-denominator');
  }
  if ((positive && numerator <= 0n) || (nonnegative && numerator < 0n)) return malformed('rational-out-of-range');
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  return known({ numerator: (numerator / a).toString(), denominator: (denominator / a).toString() });
}

// Opaque side-data/component fields remain inspectable for future policies, but
// cannot bring prototypes, binary payloads, unbounded nesting or parser work in.
function boundedStructure(value, label = 'media evidence') {
  let nodes = 0, characters = 0;
  function visit(entry, depth) {
    if (++nodes > EVIDENCE_LIMITS.nodes || depth > EVIDENCE_LIMITS.depth) fail(`Excessive ${label} complexity.`);
    if (typeof entry === 'string') {
      characters += entry.length;
      if (entry.length > EVIDENCE_LIMITS.string || characters > EVIDENCE_LIMITS.characters) fail(`Oversized ${label}.`);
      return entry;
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) fail(`Invalid ${label} number.`);
      return entry;
    }
    if (entry === null || typeof entry === 'boolean') return entry;
    if (Array.isArray(entry)) {
      if (entry.length > EVIDENCE_LIMITS.nodes) fail(`Excessive ${label} collection.`);
      return entry.map(child => visit(child, depth + 1));
    }
    if (!object(entry)) fail(`Invalid ${label} object.`);
    const result = {};
    for (const [key, child] of Object.entries(entry)) {
      if (key.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(key)) fail(`Invalid ${label} key.`);
      characters += key.length;
      if (characters > EVIDENCE_LIMITS.characters) fail(`Oversized ${label}.`);
      result[key] = visit(child, depth + 1);
    }
    return result;
  }
  return visit(value, 0);
}

function normalizeSideData(value) {
  if (!Array.isArray(value) || value.length > EVIDENCE_LIMITS.sideData) fail('Invalid or excessive side-data evidence.');
  for (const entry of value) {
    if (!object(entry) || (own(entry, 'side_data_type') && typeof entry.side_data_type !== 'string')) fail('Invalid side-data entry.');
  }
  return boundedStructure(value, 'side-data evidence');
}

function normalizeRelationships(value, kind) {
  if (!Array.isArray(value) || value.length > EVIDENCE_LIMITS.relationships) fail(`Invalid or excessive ${kind} evidence.`);
  const names = kind === 'programs'
    ? ['program_id', 'program_num', 'nb_streams', 'pmt_pid', 'pcr_pid', 'start_pts', 'end_pts', 'start_time', 'end_time']
    : ['index', 'id', 'nb_streams', 'type'];
  return value.map(entry => {
    if (!object(entry)) fail(`Invalid ${kind} entry.`);
    const result = {};
    for (const name of names) if (own(entry, name)) result[name] = boundedStructure(entry[name], kind);
    for (const name of ['tags', 'disposition', 'components']) if (own(entry, name)) result[name] = boundedStructure(entry[name], kind);
    if (own(entry, 'streams')) {
      if (!Array.isArray(entry.streams) || entry.streams.length > EVIDENCE_LIMITS.streams) fail(`Invalid ${kind} stream membership.`);
      // Top-level streams remain canonical. Retain only identity assertions from
      // nested copies so contradictory type/PID evidence is not erased before
      // confidence is assessed. Never promote the nested copy to a second stream.
      result.streams = entry.streams.map(stream => {
        if (!object(stream)) fail(`Invalid ${kind} stream reference.`);
        const reference = {};
        for (const name of ['index', 'id', 'codec_type', 'codec_name']) if (own(stream, name)) reference[name] = boundedStructure(stream[name], kind);
        return reference;
      });
    }
    return result;
  });
}

function displayMatrix(value) {
  const missing = absent(value);
  if (missing) return missing;
  if (typeof value !== 'string' || value.length > 4096) return malformed('invalid-display-matrix');
  const rows = value.trim().split(/\r?\n/);
  if (rows.length !== 3) return malformed('invalid-display-matrix');
  const entries = [];
  for (const row of rows) {
    const match = /^\s*[0-9a-fA-F]{8}:\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/.exec(row);
    if (!match) return malformed('invalid-display-matrix');
    for (const token of match.slice(1)) {
      const parsed = integer(token, { minimum: -2147483648, maximum: 2147483647 });
      if (parsed.state !== 'known') return malformed('invalid-display-matrix');
      entries.push(parsed.value);
    }
  }
  return known(entries);
}

const DOVI_FIELDS = ['dv_version_major', 'dv_version_minor', 'dv_profile', 'dv_level', 'rpu_present_flag', 'el_present_flag', 'bl_present_flag', 'dv_bl_signal_compatibility_id'];
const MASTER_FIELDS = ['red_x', 'red_y', 'green_x', 'green_y', 'blue_x', 'blue_y', 'white_point_x', 'white_point_y', 'min_luminance', 'max_luminance'];
const AMBIENT_FIELDS = ['ambient_illuminance', 'ambient_light_x', 'ambient_light_y'];

function hdrEntry(entry) {
  const type = entry.side_data_type;
  const result = { type: text(type), fields: {} };
  if (type === 'DOVI configuration record') {
    for (const field of DOVI_FIELDS) result.fields[field] = integer(entry[field], { maximum: field.endsWith('_flag') ? 1 : 255 });
    result.fields.dv_md_compression = text(entry.dv_md_compression);
  } else if (type === 'Mastering display metadata') {
    for (const field of MASTER_FIELDS) {
      const parsed = rational(entry[field], { nonnegative: true });
      result.fields[field] = parsed.state === 'known' && !field.endsWith('luminance')
        && BigInt(parsed.value.numerator) > BigInt(parsed.value.denominator)
        ? malformed('chromaticity-out-of-range') : parsed;
    }
    const min = result.fields.min_luminance, max = result.fields.max_luminance;
    if (min.state === 'known' && max.state === 'known'
        && BigInt(min.value.numerator) * BigInt(max.value.denominator) > BigInt(max.value.numerator) * BigInt(min.value.denominator)) {
      result.issues = ['mastering-minimum-exceeds-maximum'];
    }
  } else if (type === 'Content light level metadata') {
    for (const field of ['max_content', 'max_average']) {
      const parsed = integer(entry[field], { maximum: 65535 });
      result.fields[field] = parsed.state === 'known' && parsed.value === '0' ? unknown('unspecified-zero-light-level') : parsed;
    }
    const max = result.fields.max_content, average = result.fields.max_average;
    if (max.state === 'known' && average.state === 'known' && BigInt(average.value) > BigInt(max.value)) result.issues = ['average-light-exceeds-content-maximum'];
  } else if (type === 'Ambient viewing environment') {
    for (const field of AMBIENT_FIELDS) {
      const parsed = rational(entry[field], { nonnegative: true });
      result.fields[field] = parsed.state === 'known' && field !== 'ambient_illuminance'
        && BigInt(parsed.value.numerator) > BigInt(parsed.value.denominator)
        ? malformed('chromaticity-out-of-range') : parsed;
    }
  } else result.interpretation = 'unqualified-side-data';
  return result;
}

function streamEvidence(stream) {
  const sideData = stream.side_data_list || [];
  const rotations = sideData.filter(entry => entry.side_data_type === 'Display Matrix');
  const rotation = rotations.length === 1 ? rational(rotations[0].rotation, { decimal: true })
    : rotations.length > 1 ? malformed('multiple-display-matrices') : rational(stream.tags?.rotate, { decimal: true });
  const legacyRotation = rational(stream.tags?.rotate, { decimal: true });
  const geometry = {
    width: integer(stream.width, { minimum: 1, maximum: 1048576 }), height: integer(stream.height, { minimum: 1, maximum: 1048576 }),
    sampleAspectRatio: rational(stream.sample_aspect_ratio, { positive: true, separator: ':' }),
    displayAspectRatio: rational(stream.display_aspect_ratio, { positive: true, separator: ':' }),
    rotationDegrees: rotation,
    // Preserve both representations. Their sign/coordinate conventions must be
    // resolved by the geometry policy, not equated just because both say rotate.
    rotationSource: rotations.length ? 'display-matrix' : own(stream.tags || {}, 'rotate') ? 'legacy-rotate-tag' : 'not-reported',
    displayMatrix: rotations.length > 1 ? malformed('multiple-display-matrices') : displayMatrix(rotations[0]?.displaymatrix),
    legacyRotationDegrees: legacyRotation, fieldOrder: text(stream.field_order),
  };
  const { width, height, sampleAspectRatio: sar, displayAspectRatio: dar } = geometry;
  if ([width, height, sar, dar].every(field => field.state === 'known')
      && BigInt(width.value) * BigInt(sar.value.numerator) * BigInt(dar.value.denominator)
        !== BigInt(height.value) * BigInt(sar.value.denominator) * BigInt(dar.value.numerator)) {
    geometry.issues = ['display-aspect-ratio-mismatch'];
  }
  return {
    index: stream.index,
    identity: { containerStreamId: identifier(stream.id) },
    codec: { name: text(stream.codec_name), type: text(stream.codec_type), profile: text(stream.profile), tag: text(stream.codec_tag_string), tagValue: text(stream.codec_tag), level: integer(stream.level, { minimum: 0, maximum: 1000000 }), bitrate: integer(stream.bit_rate) },
    geometry,
    timeline: {
      timeBase: rational(stream.time_base, { positive: true }), startPts: integer(stream.start_pts, { minimum: '-9223372036854775808', maximum: '9223372036854775807' }),
      durationTicks: integer(stream.duration_ts, { maximum: '9223372036854775807' }),
      startSeconds: rational(stream.start_time, { decimal: true }), durationSeconds: rational(stream.duration, { decimal: true, nonnegative: true }),
      averageFrameRate: rational(stream.avg_frame_rate, { positive: true }), nominalFrameRate: rational(stream.r_frame_rate, { positive: true }),
      frameCount: integer(stream.nb_frames, { maximum: '9223372036854775807' }),
    },
    audio: { sampleFormat: text(stream.sample_fmt), sampleRate: integer(stream.sample_rate, { minimum: 1, maximum: 10000000 }), channels: integer(stream.channels, { minimum: 1, maximum: 1024 }), channelLayout: text(stream.channel_layout), bitsPerSample: integer(stream.bits_per_sample, { maximum: 128 }), bitsPerRawSample: integer(stream.bits_per_raw_sample, { maximum: 128 }), initialPadding: integer(stream.initial_padding), trailingPadding: integer(stream.trailing_padding) },
    color: { pixelFormat: text(stream.pix_fmt), transfer: text(stream.color_transfer), primaries: text(stream.color_primaries), matrix: text(stream.color_space), range: text(stream.color_range), chromaLocation: text(stream.chroma_location) },
    // An absent entry is not proof that no frame contains dynamic metadata.
    hdr: { coverage: 'stream-metadata-only', entries: sideData.filter(entry => /dovi|dolby|hdr|mastering|content light|ambient viewing/i.test(entry.side_data_type || '')).map(hdrEntry) },
  };
}

function relationshipsEvidence(probe, kind) {
  const countName = kind === 'programs' ? 'nb_programs' : 'nb_stream_groups';
  const reportedCount = integer(probe.format[countName], { maximum: EVIDENCE_LIMITS.relationships });
  if (!own(probe, kind)) return { ...(reportedCount.state === 'malformed' ? malformed('invalid-container-relationship-count') : unknown('not-reported')), reportedCount };
  const canonicalStreams = new Map(probe.streams.map(stream => [stream.index, stream]));
  const transport = typeof probe.format.format_name === 'string' && probe.format.format_name.split(',').includes('mpegts');
  const collectionIssues = [];
  if (reportedCount.state === 'malformed') collectionIssues.push('invalid-container-relationship-count');
  else if (reportedCount.state === 'known' && Number(reportedCount.value) !== probe[kind].length) collectionIssues.push('container-relationship-count-mismatch');
  if (kind === 'programs' && transport) {
    const pids = new Set();
    for (const stream of probe.streams) {
      const pid = identifier(stream.id, { minimum: 16, maximum: 8190 });
      if (pid.state === 'known' && pids.has(pid.value)) collectionIssues.push('duplicate-canonical-stream-pid');
      else if (pid.state === 'known') pids.add(pid.value);
    }
  }
  const seen = new Set();
  const value = probe[kind].map(entry => {
    const issues = [];
    const incomplete = [];
    const id = kind === 'programs' ? integer(entry.program_id) : integer(entry.index);
    if (id.state !== 'known') issues.push('missing-or-invalid-relationship-id');
    else if (seen.has(id.value)) issues.push('duplicate-relationship-id');
    else seen.add(id.value);
    const members = [];
    const memberPids = new Set();
    if (!Array.isArray(entry.streams)) issues.push('missing-stream-membership');
    else for (const stream of entry.streams) {
      if (!Number.isSafeInteger(stream.index) || stream.index < 0 || !canonicalStreams.has(stream.index)) issues.push('invalid-or-unresolved-stream-reference');
      else if (members.includes(stream.index)) issues.push('duplicate-stream-reference');
      else {
        members.push(stream.index);
        const canonical = canonicalStreams.get(stream.index);
        for (const field of ['id', 'codec_type', 'codec_name']) {
          if (!own(stream, field)) continue;
          const parse = field === 'id' ? identifier : text;
          const nested = parse(stream[field]), top = parse(canonical[field]);
          if (nested.state === 'malformed') issues.push(`invalid-member-${field}`);
          else if (nested.state === 'known' && top.state === 'known' && nested.value !== top.value) issues.push(`contradictory-member-${field}`);
          else if (nested.state !== 'known' || top.state !== 'known') incomplete.push(`unconfirmed-member-${field}`);
        }
        const canonicalType = text(canonical.codec_type);
        if (canonicalType.state === 'malformed') issues.push('invalid-member-codec-type');
        else if (canonicalType.state !== 'known') incomplete.push('unconfirmed-member-codec-type');
        if (kind === 'programs' && transport) {
          const pid = identifier(canonical.id, { minimum: 16, maximum: 8190 });
          if (pid.state === 'malformed') issues.push('invalid-stream-pid');
          else if (pid.state !== 'known') incomplete.push('stream-pid-not-reported');
          else if (memberPids.has(pid.value)) issues.push('duplicate-stream-pid');
          else memberPids.add(pid.value);
        }
      }
    }
    const count = integer(entry.nb_streams, { maximum: EVIDENCE_LIMITS.streams });
    if (count.state === 'malformed' || (count.state === 'known' && Number(count.value) !== members.length)) issues.push('stream-count-mismatch');
    else if (count.state !== 'known') incomplete.push('stream-count-not-reported');
    const fields = { streamCount: count };
    if (kind === 'stream_groups') {
      fields.type = text(entry.type);
      fields.containerId = identifier(entry.id);
      if (fields.type.state === 'malformed') issues.push('invalid-relationship-type');
      else if (fields.type.state !== 'known') incomplete.push('relationship-type-not-reported');
      if (fields.containerId.state === 'malformed') issues.push('invalid-container-group-id');
    } else {
      fields.programNumber = integer(entry.program_num, { minimum: transport ? 1 : 0, maximum: 65535 });
      fields.pmtPid = identifier(entry.pmt_pid, { minimum: transport ? 16 : 0, maximum: 8190 });
      fields.pcrPid = identifier(entry.pcr_pid, { minimum: transport ? 16 : 0, maximum: 8191 });
      for (const [field, parsed] of Object.entries(fields).filter(([field]) => field !== 'streamCount')) {
        if (parsed.state === 'malformed') issues.push(`invalid-${field}`);
        else if (transport && parsed.state !== 'known') incomplete.push(`${field}-not-reported`);
      }
      // PCR may legitimately use a separate PID or the null-PID sentinel. It need
      // not name a listed elementary stream. PMT cannot also be an ES/PCR PID.
      if (transport && fields.pmtPid.state === 'known') {
        if (memberPids.has(fields.pmtPid.value)) issues.push('pmt-pid-conflicts-with-stream');
        if (fields.pcrPid.state === 'known' && fields.pcrPid.value === fields.pmtPid.value) issues.push('pmt-pid-conflicts-with-pcr');
      }
    }
    return { state: issues.length ? 'malformed' : incomplete.length ? 'unknown' : 'known', id, fields,
      streamIndexes: members, issues: [...new Set(issues)], incomplete: [...new Set(incomplete)] };
  });
  return { state: collectionIssues.length || value.some(entry => entry.state === 'malformed') ? 'malformed'
    : value.some(entry => entry.state === 'unknown') ? 'unknown' : 'known', reportedCount, issues: collectionIssues, value };
}

function buildMediaEvidence(probe) {
  const programs = relationshipsEvidence(probe, 'programs'), streamGroups = relationshipsEvidence(probe, 'stream_groups');
  const reportedStreamCount = integer(probe.format.nb_streams, { maximum: EVIDENCE_LIMITS.streams });
  const issues = [];
  if (reportedStreamCount.state === 'malformed') issues.push('invalid-container-stream-count');
  else if (reportedStreamCount.state === 'known' && Number(reportedStreamCount.value) !== probe.streams.length) issues.push('container-stream-count-mismatch');
  // Known fields are observations, not a statement that the entire relationship
  // graph is complete. Aggregate confidence includes container counts and missing
  // collections so consumers cannot accidentally treat a partial probe as whole.
  const relationships = { state: issues.length || [programs, streamGroups].some(value => value.state === 'malformed') ? 'malformed'
    : reportedStreamCount.state !== 'known' || [programs, streamGroups].some(value => value.state !== 'known') ? 'unknown' : 'known',
  reportedStreamCount, observedStreamCount: probe.streams.length, issues };
  return {
    version: EVIDENCE_VERSION,
    streams: probe.streams.map(streamEvidence),
    container: { name: text(probe.format.format_name), startSeconds: rational(probe.format.start_time, { decimal: true }), durationSeconds: rational(probe.format.duration, { decimal: true, nonnegative: true }), bitrate: integer(probe.format.bit_rate), size: integer(probe.format.size), programs, streamGroups, relationships },
  };
}

module.exports = { EVIDENCE_VERSION, EVIDENCE_LIMITS, integerEvidence: integer, rationalEvidence: rational, normalizeSideData, normalizeRelationships, buildMediaEvidence };
