'use strict';

// Resource planning uses observed process costs, not historical advertised FPS.
// This is a conservative planning estimate, not a confidence interval.
const lab = require('./benchmark-lab-config.cjs');

function estimate(state, snapshot, resources, options = {}) {
  const measured = state.cases.filter(c => c.status === 'complete' && c.stage !== 'warmup' && c.validity?.valid);
  const supported = lab.FAMILIES.filter(f => !state.unsupportedFamilies?.[f.id]);
  function costs(family, cohort, duration, metrics = true, neg = false, sourceId) {
    let cases = options.sourceSpecific && sourceId
      ? measured.filter(c => c.config.familyId === family && c.source === sourceId) : [];
    if (!cases.length) cases = measured.filter(c => c.config.familyId === family && c.cohort === cohort);
    let resolutionMultiplier = 1;
    if (!cases.length) {
      cases = measured.filter(c => c.config.familyId === family && c.cohort === '1080p-gameplay');
      resolutionMultiplier = cohort === '1440p-gameplay' ? 2.1 : 1;
    }
    if (!cases.length) return null;
    // Replace a contaminated timing only with a clean observation of THAT
    // window/configuration. An easier clean A scene must not erase a costly B
    // workload observation from the planning ceiling. Dirty observations are
    // provisional costs only and never support comparative speed claims.
    const grouped = new Map();
    for (const c of cases) {
      const key = `${c.window}:${JSON.stringify(c.config)}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(c);
    }
    cases = [...grouped.values()].flatMap(group => {
      const quiet = group.filter(c => c.timingValidity?.valid === true);
      return quiet.length ? quiet : group;
    });
    const scale = c => duration / state.windows.find(w => w.id === c.window).durationSeconds * resolutionMultiplier;
    const encode = Math.max(...cases.map(c => c.elapsedSeconds * scale(c)));
    const validation = Math.max(...cases.map(c => {
      // Exact identities avoid charging unrelated later commands if a metric
      // repair changes its sequence. Legacy pilot entries have matching argv.
      const sequences = Object.values(c.validity.commandSequences || {});
      const commands = sequences.length ? sequences.map(seq => state.commands.find(x => x.sequence === seq))
        : ['-output-packets', '-decoded-frames'].map(suffix => state.commands.find(x =>
          x.label.endsWith(suffix) && x.argv?.at(-1) === c.output?.path));
      return commands.filter(Boolean).reduce((sum, x) => sum + x.elapsedSeconds, 0) * scale(c);
    }));
    const regular = metrics ? Math.max(...cases.map(c => (c.quality?.regular?.elapsedSeconds || 0) * scale(c))) : 0;
    const ssim = metrics ? Math.max(...cases.map(c => (c.quality?.ssim?.elapsedSeconds || 0) * scale(c))) : 0;
    // A missing NEG observation uses the regular metric cost as an explicit
    // fallback. A failed/unavailable bundled model costs no future NEG runs.
    const negative = metrics && neg ? Math.max(...cases.map(c =>
      (c.quality?.neg?.elapsedSeconds ?? c.quality?.regular?.elapsedSeconds ?? 0) * scale(c))) : 0;
    return encode + validation + regular + ssim + negative + 3;
  }
  const exists = (window, family, quality) => measured.some(c => c.window === window && c.config.familyId === family
    && c.config.settings.quality === quality && c.timingValidity?.valid === true
    && (c.repeat === 0 || c.retimingOf) && !Object.keys(c.config.overrides || {}).length);
  let coarse = 0, coarseCount = 0;
  const coarseSelection = options.coarseSelection || lab.SOURCES.flatMap(source => supported.flatMap(family =>
    family.values.map(quality => ({ source: source.id, family: family.id, quality }))));
  for (const selected of coarseSelection) {
    const source = lab.SOURCES.find(s => s.id === selected.source);
    const family = supported.find(f => f.id === selected.family); const quality = selected.quality;
    if (!source || !family || !Number.isFinite(quality)) throw new Error('Invalid forecast search descriptor.');
    if (!exists(`${source.id}-a`, family.id, quality)) {
      if (options.omitSvt22 && family.id === 'svt' && quality === 22) continue;
      coarse += costs(family.id, source.cohort, 12, true, false, source.id); coarseCount++;
    }
  }
  let generalization = 0;
  for (const source of lab.SOURCES) for (const family of supported) {
    if (options.reducedB && !['x265', 'hevc-archive'].includes(family.id)
      && !(family.id === 'svt' ? ['cd', 'desk'] : ['cd', 'sf', 'desk']).includes(source.id)) continue;
    // Fixed anchors can be deducted exactly. Other chosen points are not
    // presumed to match a pilot run before their configurations are selected.
    if (family.id === 'x265' && exists(`${source.id}-b`, family.id, 25)) continue;
    if (family.id === 'hevc-archive' && options.reducedB && exists(`${source.id}-b`, family.id, 29)) continue;
    // Once the bounded B choice is recorded, its actual clean result can be
    // deducted. Before that choice no pilot overlap is presumed.
    const chosen = options.reducedB && state.selections?.find(s => s.familyId === family.id);
    if (chosen && family.id !== 'hevc-archive' && exists(`${source.id}-b`, family.id, chosen.selectedQuality)) continue;
    generalization += costs(family.id, source.cohort, 12, true,
      ['cd', 'desk'].includes(source.id) && family.id !== 'svt', source.id);
  }
  // An additional retuned Archive arm can be separate from the protected CQ29.
  if (!options.reducedB) for (const source of lab.SOURCES) {
    if (!exists(`${source.id}-b`, 'hevc-archive', 29))
      generalization += costs('hevc-archive', source.cohort, 12, true, ['cd', 'desk'].includes(source.id), source.id);
  }
  const worstCalibration = Math.max(...supported.filter(f => f.id !== 'x265').map(f => costs(f.id, '1080p-gameplay', 12, true, true)));
  // A completed configuration/window is charged once, even if a later timing
  // repeat exists. This deducts actual work, never presumed future overlap.
  const completedRefinement = new Set(measured.filter(c => c.stage === 'refinement' && c.timingValidity?.valid === true)
    .map(c => `${c.window}:${JSON.stringify(c.config)}`)).size;
  const remainingRefinement = options.refinementCases ?? Math.max(0, lab.MATRIX.refinement - completedRefinement);
  const refinement = remainingRefinement * worstCalibration;
  const ablation = lab.MATRIX.optionalAblation * worstCalibration;
  let referenceHeldout = 0, protectedHeldout = 0, finalistHeldout = [0, 0, 0];
  let heldoutCount = 0;
  // Reserve x265 plus the three slowest potential finalist families at each
  // cohort, and all four protected recipe arms separately. Overlap is not
  // spent in advance. Three completed timing repetitions; metrics only once.
  function triple(family, source) {
    const duration = source.holdout[1] - source.holdout[0];
    return costs(family, source.cohort, duration, true, lab.PAIRED_HELDOUT.includes(source.id) && family !== 'svt', source.id)
      + 2 * costs(family, source.cohort, duration, false, false, source.id);
  }
  for (const source of lab.SOURCES) {
    referenceHeldout += triple('x265', source); heldoutCount += 3;
    const possible = supported.filter(f => f.id !== 'x265').map(f => triple(f.id, source)).sort((a, b) => b - a);
    for (let i = 0; i < 3; i++) finalistHeldout[i] += possible[i] || 0;
    heldoutCount += Math.min(3, possible.length) * 3;
    if (lab.PAIRED_HELDOUT.includes(source.id)) for (const id of ['hevc-ordinary', 'hevc-archive', 'av1-ordinary', 'av1-quality']) {
      if (supported.some(f => f.id === id)) { protectedHeldout += triple(id, source); heldoutCount += 3; }
    }
  }
  const selectorReserve = 1800, reportReserve = 1800, supportReserve = 900;
  const contingencyFactor = 1.25;
  const heldout = referenceHeldout + protectedHeldout + finalistHeldout.reduce((n, v) => n + v, 0);
  const searchAndPreparation = coarse + generalization + refinement + selectorReserve + supportReserve;
  const capacityScenarios = [1, 2, 3].map(finalistSlots => {
    const heldoutSeconds = referenceHeldout + protectedHeldout + finalistHeldout.slice(0, finalistSlots).reduce((n, v) => n + v, 0);
    const remainingSeconds = contingencyFactor * (searchAndPreparation + heldoutSeconds) + reportReserve;
    return { finalistSlots, heldoutSecondsBeforeContingency: heldoutSeconds, remainingSeconds,
      fits: remainingSeconds <= snapshot.remainingMs / 1000,
      qualification: `${options.sourceSpecific ? 'Worst observed same-source/family when available, cohort fallback otherwise' : 'Worst observed cost by cohort'}; no overlap savings assumed. All protected recipe arms and three timing repeats remain. The per-source slowest potential family is a conservative capacity ceiling, not one selected global finalist.` };
  });
  const mandatoryRemainingSeconds = contingencyFactor * (coarse + generalization + refinement + heldout + selectorReserve + supportReserve) + reportReserve;
  const maximumRemainingSeconds = mandatoryRemainingSeconds + contingencyFactor * ablation;
  const remainingSeconds = snapshot.remainingMs / 1000;
  return { schemaVersion: 2, observedUtc: new Date().toISOString(), measuredCases: measured.length, encodeInvocations: state.encodeInvocations,
    forecastOptions: options,
    provisionalTimingCases: measured.filter(c => c.timingValidity?.valid === false).length,
    usedActiveSeconds: snapshot.accumulatedMs / 1000, remainingSeconds,
    stagesSecondsBeforeContingency: { coarse, generalization, refinement, optionalAblation: ablation,
      heldoutIncludingRepeats: heldout, selectorReserve, supportReserve, reportingReserve: reportReserve },
    counts: { remainingCoarse: coarseCount, completedRefinement, remainingRefinement, heldoutInvocationsBeforeOverlap: heldoutCount },
    unitCosts: { refinement: worstCalibration },
    contingencyFactor, mandatoryRemainingSeconds, maximumRemainingSeconds,
    fullHeldoutPlusCoarseRemainingSeconds: contingencyFactor * (coarse + heldout + selectorReserve + supportReserve) + reportReserve,
    capacityScenarios,
    fullSearchFitsWithOneFinalist: capacityScenarios[0].fits,
    provisionalFinalistCapacity: Math.max(0, ...capacityScenarios.filter(s => s.fits).map(s => s.finalistSlots)),
    fitsFullMatrix: maximumRemainingSeconds <= remainingSeconds,
    fitsRequiredWithoutAblation: mandatoryRemainingSeconds <= remainingSeconds,
    resources, storageForecast: { stagedBytes: state.stagingPlannedBytes,
      remainingOutputAndReviewReserveBytes: 25 * 1024 ** 3,
      rationale: 'Video-only outputs plus selected lossless review material; reserve checked dynamically, no overwrite.' },
    assumptions: ['Worst observed same-family/cohort cost, linear duration scaling with startup conservatively included.',
      options.sourceSpecific ? 'Use worst observed same-source/family cost where available; unseen content variation remains uncertain.'
        : 'Every unmeasured source uses worst observed family/cohort cost, intentionally conservative.',
      'Unmeasured1440 families use2.1 times the worst1080 gameplay cost; replace with measured costs during coarse.',
      'Three heldout timing runs; quality metrics computed once per unique configuration/window.',
      'Protected paired arms counted separately before overlap savings.',
      'Up to3finalists is a ceiling;1finalist capacity is tested separately from the conservative3slot maximum.',
      'Long-GOP softwareAV1 seek/decode can limit whole-pipeline GPU throughput.',
      'Pre-quiet pilot costs are provisional workload observations, not valid comparative speed evidence; use quiet observations when available.',
      'Quiet replacement is window/configuration-specific; difficult B observations remain in the cost ceiling until equivalent clean timings exist.',
      '25percent contingency is a planning margin, not a statistical interval.'] };
}

module.exports = { estimate };
