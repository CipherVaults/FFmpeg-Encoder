'use strict';
// Read-only compatibility audit of every retained catalog MP4/MOV proof and
// root's TS proof. No service, Start, decode, mux, writes or qualification grant.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { observeRemuxEditLists, observeRemuxSourcePlayback } = require('../src/remux-edit-lists.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { observeNativeInventory, compareNativeInventories } = require('../src/remux-native-checks.cjs');
const reports = [
  'slice3/service/1acb16cc-6616-434d-a1f8-8a465d436b44',
  'slice3/service/b9ec1209-7d3b-4b2c-b4ff-e022fae611d4',
  'q2d-mkv-mp4/838e1196-80b3-43bf-8bbf-9de3bd4f965a',
  'q2e-isobmff-mov/7a7f87a2-7eb9-4bc5-82d0-f119710e0fb3',
  'q2g-vfr-isobmff-mov/d252713e-6629-4627-a176-1653355a3e23',
  'q2i/smoke/c020cf60-8664-483a-918c-e90d9b6dc35d',
  'q2i/smoke/1c8c571e-84f2-4cc8-af73-5814b26dfc71',
  'q2i/smoke/1865c531-2809-4170-870e-29f56dfc97a3',
  'q2i/smoke/23e999a9-fca2-4ba3-a01f-449f11bb6038',
  'q2i/smoke/16477e14-c5f8-4beb-9f1b-4f07b95618a8',
];
const fields = ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const stamp = s => Object.fromEntries(fields.map(k => [k, String(s[k])]));
// Independent expected selection, captured from the retained proof set. Never
// infer completeness from the same filtered cases that the audit will check.
const EXPECTED_CASES = require('./v07-remux-proof-cases.json');
async function audit({ read = fsp.readFile, stat = fsp.stat, hashFile = async file => {
  const hash = createHash('sha256'); for await (const bytes of fs.createReadStream(file)) hash.update(bytes); return hash.digest('hex');
}, run = runTool, observe = observeRemuxEditLists } = {}) {
  const checked = [], unavailable = [], failures = [], { ffprobe } = require('../src/candidate-runtime.cjs').resolveCandidateRuntime({ root: path.resolve(__dirname, '..') });
  async function probe(file, extra = []) {
    return JSON.parse((await run(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe',
      ...extra, '-show_streams', '-show_format', '-show_chapters', '-show_programs', '-show_stream_groups', '-show_data_hash', 'sha256', '-of', 'json', '-i', file], { timeoutMs: 30000, stdoutLimit: 8 * 1024 ** 2 })).stdout);
  }
  for (const relative of reports) {
    let report;
    try {report=JSON.parse(await read(path.resolve(__dirname, '../artifacts/v0.7', relative, 'report.json'), 'utf8'));}
    catch(error){failures.push('Missing or unreadable expected report: '+relative+': '+error.message);continue;}
    const expected = EXPECTED_CASES[relative];
    if (!expected?.length || !Array.isArray(report?.cases)) { failures.push('Missing expected selection: '+relative); continue; }
    const selected=[];
    for(const wanted of expected) {
      const matches=report.cases.filter(c=>c?.label===wanted.label);
      if(matches.length!==1 || matches[0].target!==wanted.target || !matches[0].output?.file || matches[0].evidence?.status!=='completed')
        failures.push('Missing or incomplete expected case: '+relative+':'+wanted.label);
      else selected.push(matches[0]);
    }
    for(const c of report.cases.filter(c=>['mp4','mov'].includes(c?.target)&&c.output&&c.evidence?.status==='completed'))
      if(!expected.some(e=>e.label===c.label&&e.target===c.target)) failures.push('Unlisted proof case: '+relative+':'+c.label);
    for (const c of selected) {
      try{
      const file = c.output.file; let before;
      try { before = await stat(file, { bigint: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; unavailable.push(relative + ':' + c.label); continue; }
      if (Number(before.size) !== c.output.bytes || await hashFile(file) !== c.output.sha256) throw Error('Saved output changed: ' + file);
      const sourcePath = c.source || c.input;
      const sourceProbe = await probe(sourcePath);
      let sourcePlayback = null;
      if (sourceProbe.format?.format_name.split(',').includes('mov')) sourcePlayback = await observeRemuxSourcePlayback({ file: sourcePath,
        probe: sourceProbe, target: c.target, identity: await readSourceIdentity(sourcePath), selectedIndexes: c.evidence.essenceEvidence.streams.map(s => s.inputIndex),
        maxRecords: c.evidence.budget.maxRecords });
      const outputProbe = await probe(file);
      const sourceFamily = sourceProbe.format.format_name.split(',').includes('mov')?'isobmff':sourceProbe.format.format_name.split(',').includes('mpegts')?'mpegts':'matroska';
      const sourceNative = await observeNativeInventory({file:sourcePath,probe:sourceProbe,family:sourceFamily,target:c.target,
        selectedIndexes:c.evidence.essenceEvidence.streams.map(s=>s.inputIndex),maxRecords:c.evidence.budget.maxRecords});
      const outputNative = await observeNativeInventory({file,probe:outputProbe,family:'isobmff',target:c.target,maxRecords:c.evidence.budget.maxRecords});
      compareNativeInventories(sourceNative,outputNative,c.evidence.essenceEvidence.streams);
      const intervals = [];
      for (const s of c.evidence.essenceEvidence.streams) {
        const record = s.source; let firstPts = record.firstPts, visibleStart = firstPts;
        const stream = sourceProbe?.streams.find(stream => stream.index === s.inputIndex);
        if (s.codecType === 'audio' && record.representation !== 'packet-identity-v1') {
          // Old complete-native receipts start AFTER AAC priming. Obtain its
          // raw packet start with a bounded header-only source read, no decode.
          const head = await probe(sourcePath, ['-select_streams', String(s.inputIndex), '-show_packets', '-read_intervals', '%+#1']);
          const a = head.streams[0], p = head.packets[0]; const [n, d] = a.time_base.split('/').map(BigInt);
          firstPts = { numerator: String(BigInt(p.pts) * n), denominator: String(d) };
        } else if (record.pcm) {
          const e = record.endPts, rate = BigInt(stream?.sample_rate || 48000);
          visibleStart = { numerator: String(BigInt(e.numerator) * rate - BigInt(record.pcm.samples) * BigInt(e.denominator)), denominator: String(BigInt(e.denominator) * rate) };
        }
        intervals.push({ outputIndex: s.outputIndex, firstPts, visibleStart, endPts: record.endPts,
          ...(record.representation === 'packet-identity-v1' ? { packetCount: record.unitCount } : {}) });
      }
      const native = await observe({ fileReceipt: { path: file, bytes: c.output.bytes, sha256: c.output.sha256, identity: stamp(before) },
        outputProbe, intervals, maxRecords: c.evidence.budget.maxRecords, exact: c.label.startsWith('ts-') });
      if (fields.some(k => String(before[k]) !== String(native.identity[k]))) throw Error('Saved output changed during native observation: ' + file);
      checked.push({ report: relative, label: c.label, sha256: c.output.sha256, sourcePlaybackChecked: sourcePlayback !== null, tracks: native.tracks });
      }catch(error){failures.push(relative+':'+c.label+': '+(error.code||'AUDIT')+': '+error.message);}
    }
  }
  if(!checked.length) failures.push('No saved proof cases were checked.');
  if(unavailable.length) failures.push('Expected output files are absent: '+unavailable.join(', '));
  return { status: failures.length?'failed':'passed', failures, rounding: { mediaSpan: 'ceil to mvhd ticks', positiveEmptyDelay: 'floor to mvhd ticks', mediaTime: 'exact mdhd ticks',
    trackDuration: 'ceil absolute presentation end to mvhd ticks', movieDuration: 'maximum independently rounded track end', mediaDuration: 'exact sum of STTS decode durations', tickTolerance: 0 }, checked, unavailable };
}
async function cli(options){let result;try{result=await audit(options);}catch(e){result={status:'failed',failures:[e.message],checked:[],unavailable:[]};}
  process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.status!=='passed')process.exitCode=1;return result;}
if (require.main === module) cli();
module.exports = { audit, reports, EXPECTED_CASES, cli };
