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
  refinement: 18, optionalAblation: 0, finalistHeldout: 24, protectedRecipeHeldout: 12,
  uniqueMaximumBeforeReuse: 212, extraHeldoutTimingRepeats: 72,
  // Eight optional ablation invocations are reassigned to native lossless
  // review/warm-up support. The approved total340 and decisive pairs remain.
  candidateInvocationMaximum: 284, warmupSupportMaximum: 32, diagnosticRetryMaximum: 24 });
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

function targetedCases() {
  // Approved initial points, narrowed after independent A-scene review. The
  // two HEVC arms explore fidelity deficits; AV1/SVT explore the size bracket.
  const points = [['svt', 34], ['hevc-ordinary', 25], ['hevc-archive', 25],
    ['av1-ordinary', 36], ['av1-quality', 36]];
  return SOURCES.filter(s => s.cohort === '1080p-gameplay').flatMap(s => points.map(([family, quality]) =>
    ({ window: windowDefinitions(s.id, 'a'), config: configuration(family, quality) })));
}

function reducedGeneralization(selections) {
  const quality = id => { const found = selections.find(s => s.familyId === id); assert.ok(found); return found.selectedQuality; };
  const cases = [];
  for (const source of SOURCES) {
    const window = windowDefinitions(source.id, 'b');
    cases.push({ window, config: configuration('x265', 25) }, { window, config: configuration('hevc-archive', 29) });
    if (PAIRED_HELDOUT.includes(source.id)) for (const family of ['hevc-ordinary', 'av1-ordinary', 'av1-quality'])
      cases.push({ window, config: configuration(family, quality(family)) });
    if (['cd', 'desk'].includes(source.id)) cases.push({ window, config: configuration('svt', quality('svt')) });
  }
  return cases;
}

function refinementCases(block) {
  if (block === 'cd-challenges') return [['hevc-ordinary', 25], ['hevc-archive', 25], ['av1-ordinary', 24], ['av1-quality', 24]]
    .map(([family, quality]) => ({ window: windowDefinitions('cd', 'b'), config: configuration(family, quality) }));
  if (['av1-fh', 'av1-rest'].includes(block)) return (block === 'av1-fh' ? ['fh5'] : ['cd', 'e33', 'sf'])
    .flatMap(source => ['av1-ordinary', 'av1-quality'].map(family =>
      ({ window: windowDefinitions(source, 'a'), config: configuration(family, 32) })));
  if (block === 'av1-b') return ['cd', 'sf', 'desk'].flatMap(source =>
    ['av1-ordinary', 'av1-quality'].map(family =>
      ({ window: windowDefinitions(source, 'b'), config: configuration(family, 32) })));
  throw new Error('Unknown bounded refinement block.');
}

function calibrationReview() {
  const points = (svt, hevc, av1) => [['svt', svt], ['hevc-ordinary', hevc], ['hevc-archive', 29],
    ['av1-ordinary', av1], ['av1-quality', av1]];
  const groups = [
    ['acc', 'a', 'Assetto Corsa Competizione — native 1440p', 'Inspect cars, road/fence detail and HUD; separate native1440 cohort.', points(28, 29, 30)],
    ['e33', 'a', 'Expedition 33', 'Inspect effects, movement and fine surfaces.', points(34, 29, 32)],
    ['fh5', 'a', 'Forza Horizon 5', 'Inspect foliage and motion, including the lower-size alternatives.',
      [...points(34, 29, 32), ['av1-ordinary', 36], ['av1-quality', 36]]],
    ['cd', 'b', 'Crimson Desert — difficult window', 'Inspect foliage, fine texture and motion carefully.', points(34, 29, 32)],
    ['desk', 'b', 'Desktop', 'Inspect text, edges, gradients and scrolling; separate desktop cohort.', points(34, 29, 32)],
    ['sf', 'b', 'Starfield', 'Inspect dark surfaces, fine detail and HUD.', points(34, 29, 32).filter(([family]) => family !== 'svt')],
  ];
  // Only actual A/B points; no held-out admission or setting selection occurs.
  // Starfield-B SVT was not measured and is deliberately absent.
  return groups.map(([sourceId, role, title, context, configurations]) => ({ sourceId, role, title, context,
    configurations: [['x265', 25], ...configurations].map(([family, quality]) => configuration(family, quality)) }));
}

function assertHumanGate(phase, humanStatus) {
  if (humanStatus === 'awaiting-calibration-judgment') assert.ok(['status', 'checks', 'forecast', 'allocate-review', 'review'].includes(phase),
    'Ahmed calibration judgment is pending. Do not start further benchmark execution.');
}

module.exports = { SOURCES, FAMILIES, LIMITS, MATRIX, PAIRED_HELDOUT,
  configuration, selector, encodeArgs, windowDefinitions, pilotCases, targetedCases, reducedGeneralization, refinementCases, calibrationReview, assertHumanGate };
