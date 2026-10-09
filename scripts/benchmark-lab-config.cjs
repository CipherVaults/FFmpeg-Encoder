'use strict';

// The laboratory imports production's pure configuration descriptions. It never
// changes an application profile or lets an experimental override enter IPC.
const path = require('node:path');
const assert = require('node:assert/strict');
const { describeRecipe, buildEncodeArgs } = require('../src/media.cjs');

const SOURCES = [
  ['acc', 'Assetto Corsa Competizione 2026.10.09 - 23.04.11.06.mp4', '1440p-gameplay', [50, 62], [100, 112], [170, 230]],
  ['e33', 'Clair Obscur  Expedition 33 2026.10.09 - 22.54.13.05.mp4', '1080p-gameplay', [50, 62], [100, 112], [210, 270]],
  ['cd', 'Crimson Desert 2026.10.09 - 22.37.56.03.mp4', '1080p-gameplay', [50, 62], [95, 107], [140, 200]],
  ['desk', 'Desktop 2026.10.09 - 23.11.42.09.mp4', '1080p-desktop', [15, 27], [49, 61], [70, 110]],
  ['fh5', 'Forza Horizon 5 2026.10.09 - 23.20.31.10.mp4', '1080p-gameplay', [50, 62], [95, 107], [185, 245]],
  ['sf', 'Starfield 2026.10.09 - 23.29.00.11.mp4', '1080p-gameplay', [20, 32], [95, 107], [210, 270]],
].map(([id, name, cohort, a, b, holdout]) => ({ id, name, cohort, a, b, holdout }));

const FAMILIES = [
  { id: 'x265', profileId: 'h265-cpu', preset: 'slow', values: [25], anchor: true },
  { id: 'svt', profileId: 'av1-cpu', preset: '5', values: [22, 28, 34] },
  { id: 'hevc-ordinary', profileId: 'h265-nvidia', preset: 'p7', values: [25, 29, 33] },
  { id: 'hevc-archive', profileId: 'h265-nvidia', preset: 'p7', values: [25, 29, 33], recipeId: 'archive-quality-hevc-v1', anchorQuality: 29 },
  { id: 'av1-ordinary', profileId: 'av1-nvidia', preset: 'p7', values: [24, 30, 36] },
  { id: 'av1-quality', profileId: 'av1-nvidia', preset: 'p7', values: [24, 30, 36], experimental: true },
];

const LIMITS = Object.freeze({ activeMs: 12 * 60 * 60 * 1000,
  growthBytes: 55 * 1024 ** 3, minFreeBytes: 20 * 1024 ** 3, encodeInvocations: 340 });
const MATRIX = Object.freeze({ pilot: 20, coarse: 96, generalization: 42,
  refinement: 18, optionalAblation: 8, finalistHeldout: 24, protectedRecipeHeldout: 12,
  uniqueMaximumBeforeReuse: 220, extraHeldoutTimingRepeats: 72,
  candidateInvocationMaximum: 292, warmupSupportMaximum: 24, diagnosticRetryMaximum: 24 });
const PAIRED_HELDOUT = ['cd', 'sf', 'desk'];

function configuration(familyId, quality, overrides = {}) {
  const family = FAMILIES.find(f => f.id === familyId); assert.ok(family, `Unknown family ${familyId}`);
  const settings = { profileId: family.profileId, preset: overrides.preset || family.preset, quality,
    ...(family.recipeId ? { recipeId: family.recipeId } : {}) };
  const description = describeRecipe(settings);
  let args = [...description.args];
  if (family.experimental) {
    // AV1-specific investigation: no HEVC B-frame/reference flags are copied.
    args[args.indexOf('-tune:v:0') + 1] = 'uhq';
    args.push('-multipass:v:0', 'fullres');
  }
  for (const [flag, value] of Object.entries(overrides.options || {})) {
    assert.ok(['-tune:v:0', '-multipass:v:0', '-tf_level:v:0', '-b_ref_mode:v:0'].includes(flag));
    const index = args.indexOf(flag); if (index >= 0) args[index + 1] = String(value); else args.push(flag, String(value));
  }
  return { familyId, settings, encoder: description.encoder, qualityMode: description.qualityMode,
    args, experimental: family.experimental || Boolean(overrides.options), overrides,
    effectiveSettings: { explicit: args, inherited: 'Driver/native preset values omitted by canonical contribution',
      observed: null, unknown: ['inherited lookahead/AQ/GOP/reference values unless reported by exact runtime'] } };
}

function selector(source, window, frameCount) {
  // copyts preserves the source timeline through accurate input seek. trim is
  // verified against an unseeked decoded frame-hash trace before use.
  return { input: ['-copyts', '-ss', String(Math.max(0, window.start - 2)), '-i', source.stagedPath],
    filterAbsolute: `trim=start=${window.start}:end=${window.end}`,
    filter: `trim=start=${window.start}:end=${window.end},setpts=PTS-STARTPTS`,
    ...(frameCount === undefined ? {} : { frameCount }) };
}

function encodeArgs(source, window, config, output) {
  const selected = selector(source, window, window.frameCount);
  const production = buildEncodeArgs({ input: source.stagedPath, output,
    settings: config.settings, probe: source.probe });
  const mediaFlags = ['-profile:v:0', '-pix_fmt:v:0', '-color_trc:v:0', '-color_primaries:v:0', '-colorspace:v:0', '-color_range:v:0'];
  const mediaArgs = mediaFlags.flatMap(flag => {
    const index = production.indexOf(flag); return index < 0 ? [] : [flag, production[index + 1]];
  });
  return ['-hide_banner', '-nostdin', '-n', '-loglevel', 'verbose', '-nostats', '-progress', 'pipe:1',
    ...selected.input, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', selected.filter,
    ...config.args, ...mediaArgs, '-fps_mode:v:0', 'passthrough',
    // Explicit native time base prevents r_frame_rate=120 metadata from
    // quantizing irregular ~60fps timestamps. This harness timing flag is
    // recorded as a difference from production; encoder quality is unchanged.
    '-enc_time_base:v:0', 'demux', '-frames:v:0', String(window.frameCount),
    '-map_metadata', '-1', '-f', 'matroska', output];
}

function windowDefinitions(sourceId, role) {
  const spec = SOURCES.find(s => s.id === sourceId); assert.ok(spec); assert.ok(['a', 'b', 'holdout'].includes(role));
  return { id: `${sourceId}-${role}`, sourceId, role, start: spec[role][0], end: spec[role][1], cohort: spec.cohort };
}

function pilotCases() {
  const windows = [['cd', 'b'], ['desk', 'b'], ['sf', 'a']];
  const cases = windows.flatMap(([id, role]) => FAMILIES.map(f => ({ window: windowDefinitions(id, role),
    config: configuration(f.id, f.values[Math.floor(f.values.length / 2)]) })));
  for (const id of ['x265', 'av1-quality']) {
    const f = FAMILIES.find(f => f.id === id);
    cases.push({ window: windowDefinitions('acc', 'a'), config: configuration(id, f.values[Math.floor(f.values.length / 2)]) });
  }
  return cases;
}

module.exports = { SOURCES, FAMILIES, LIMITS, MATRIX, PAIRED_HELDOUT,
  configuration, selector, encodeArgs, windowDefinitions, pilotCases };
