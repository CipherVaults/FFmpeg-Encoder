'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { createOwnedSession, fault } = require('./v07-remux-long-fixtures.cjs');
const { runCases } = require('./q2j-mp3-laboratory.cjs');

const MiB = 1024 ** 2;
const LIMITS = Object.freeze({ totalMs: 90000, childMs: 8000, maxChildren: 19, maxStarts: 0,
  minimumDFreeBytes: 25 * 1024 ** 3, marginBytes: 64 * MiB, forecastBytes: 16 * MiB, reportBytes: 8 * MiB });

async function proof() {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: 'mp3' });
  const { report } = session;
  report.scope = 'Native MP3 copy laboratory with no product Prepare or Start';
  report.enginePair = REGULAR_WINDOWS_PAIR;
  let observer;
  try {
    await session.open();
    const runtime = session.runtime;
    assert.equal(runtime.manifest.enginePair, REGULAR_WINDOWS_PAIR);
    const names = ['ffmpeg', 'ffprobe'];
    observer = new OperationRuntimeObserver({
      runtime: Object.fromEntries(names.map(tool => [tool, runtime[tool]])),
      pins: Object.fromEntries(names.map((tool, index) => {
        const { sizeBytes, sha256 } = runtime.verified[index];
        return [tool, { sizeBytes, sha256 }];
      })),
    });
    const token = await observer.observe({ hardware: 'CPU' });
    assert.equal(observer.snapshot(token).runtimeIdentity, REGULAR_WINDOWS_PAIR);
    async function invoke(tool, args, { signal, expectedFail = false } = {}) {
      let child;
      try {
        const result = await session.run(runtime[tool], args, { signal, stdoutLimit: MiB, stderrLimit: 32 * 1024, onChild: value => { child = value; } },
          (_file, argv, options) => observer.invoke(token, tool, argv, options));
        assert.equal(result.stderrCapture.truncated, false);
        assert.equal(result.exitCode, 0);
        if (expectedFail) {
          assert.match(result.stderr, /already exists/i);
          report.collision = { exitCode: result.exitCode, stderr: result.stderr };
        } else assert.equal(result.stderr, '');
        return result.stdout;
      } catch (error) {
        // Windows exposes FFmpeg's negative AVERROR(EEXIST) as a DWORD.
        const existingOutputExit = error.exitCode === 1 || (error.exitCode >>> 0) === 0xffffffef;
        if (!expectedFail || !child || error.code !== 'TOOL_FAILED' || !existingOutputExit
            || error.stderrCapture?.truncated !== false || !/already exists/i.test(error.stderr)) throw error;
        report.collision = { exitCode: error.exitCode, stderr: error.stderr };
        return '';
      }
    }
    report.extra = await runCases(session.owned, invoke, report.cases);
    await assert.rejects(invoke('ffprobe', ['-version'], { signal: AbortSignal.abort() }), { code: 'CANCELLED' });
    const last = report.invocations.at(-1);
    assert.equal(last.childStartedAt, undefined);
    report.extra.preAbortedChildren = 0;
    const fresh = await observer.observe({ hardware: 'CPU' });
    assert.equal(observer.snapshot(fresh).runtimeIdentity, REGULAR_WINDOWS_PAIR);
    assert.equal(report.childrenClosed, 18);
    assert.equal(report.acceptedStarts, 0);
    report.status = 'passed-owned-mp3-lab';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
  } finally {
    try {
      if (observer) await observer.close();
    } catch (error) {
      report.status = 'failed-retained';
      report.observerClosureFailure = fault(error);
    } finally {
      await session.close();
    }
  }
  return report;
}

if (require.main === module) {
  assert.deepEqual(process.argv.slice(2), ['--owned-mp3-lab']);
  proof().then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, cases: report.cases.length,
      childrenClosed: report.childrenClosed, report: path.join(report.directory, 'report.json'),
      failure: report.failure, closureFailures: report.closureFailures, observerClosureFailure: report.observerClosureFailure }));
    if (report.status !== 'passed-owned-mp3-lab') process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
