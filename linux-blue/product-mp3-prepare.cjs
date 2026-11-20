'use strict';

// This module can return an explanation, not an operation or execution token.
const path = require('node:path');
const { ToolError, isSharedToolFailure } = require('../src/process-runner.cjs');
const { openProductMp3Source, assertProductMp3Source } = require('./product-mp3-source.cjs');
const { parseStandaloneMp3Probe, inspectStandaloneMp3Probe } = require('./product-mp3-inspection.cjs');
const MP3_NOTICE = 'For MP4, a folder with one standalone MP3 and no video input can be inspected. MP3-to-MP4 copying is not enabled; the audio is never converted to AAC.';
const INPUT = 'The selected MP3 source is no longer the same single-link regular file. Prepare again.';
const PROBE = 'Bounded MP3 metadata inspection did not complete cleanly. No copy or conversion was started.';
const fail = (code, msg) => { throw new ToolError(code, msg); };

function discoverMp3Diagnostic(entries, target) {
  if (target !== 'mp4') return [];
  const music = entries.filter(e => (e.isFile() || e.isSymbolicLink()) && path.extname(e.name).toLowerCase() === '.mp3');
  if (music.length > 1) fail('REMUX_MP3_MULTIPLE_INPUTS','For MP3 inspection, choose a folder with one MP3 and no video inputs. No audio was copied or converted.');
  return music;
}

async function inspectMp3Diagnostic({baseline,selectedPath,request,signal,current,onStage,ffprobe,run}) {
  current();
  if (request?.operation !== 'remux' || request.target !== 'mp4' || request.audioPolicy !== 'copy' || request.range !== null
      || request.resolution !== 'source' || request.hdrPolicy !== 'preserve' || request.aacBitrateKbps !== null
      || request.omissionRequestIds.length !== 0)
    fail('REMUX_MP3_TARGET_UNQUALIFIED','Standalone MP3 inspection is available only for Full MP4 stream copy without omissions. No output was prepared.');
  if (!baseline?.identity || baseline.error || baseline.identity.canonicalPath !== selectedPath) fail('UNSAFE_SOURCE',INPUT);
  let source, result;
  try {
    source = await openProductMp3Source(baseline.identity,{signal});
    current();source.assertCurrent({signal});onStage({stage:'metadata'});current();
    let output;
    try {
      output = await run(ffprobe, ['-v','error','-max_alloc','16777216','-protocol_whitelist','file',
        '-format_whitelist','mp3','-probesize','262144','-analyzeduration','500000','-max_probe_packets','128',
        '-show_streams','-show_format','-show_chapters','-show_programs','-show_stream_groups','-of','json','-i',source.identity.canonicalPath],
      {signal,timeoutMs:8000,stdoutLimit:128*1024,stderrLimit:32*1024});
    } catch (error) {
      current();
      // Keep known inability to launch/read the tool a batch failure. Never
      // project raw ffprobe stderr, path, or attacker-controlled tag text.
      if (isSharedToolFailure(error)) fail('SPAWN_FAILED','The verified media inspector could not complete this inspection.');
      fail('REMUX_MP3_PROBE_UNAVAILABLE',PROBE);
    }
    current();source.assertCurrent({signal});
    if (output.stderr?.trim() || output.stderrCapture?.truncated) fail('REMUX_MP3_PROBE_UNAVAILABLE',PROBE);
    let parsed;
    try { parsed = parseStandaloneMp3Probe(output.stdout); }
    catch { fail('REMUX_MP3_METADATA_UNPROVED','Standalone MP3 needs bounded, unambiguous media metadata.'); }
    result = inspectStandaloneMp3Probe(parsed,source.observation);
    assertProductMp3Source(source,result,{signal});
  } catch (error) {
    if (error.code==='INPUT_CHANGED') fail('INPUT_CHANGED',INPUT);
    // Only messages defined by the inspected project components are suitable
    // for the ordinary item. Filesystem exceptions can contain raw paths.
    if (error instanceof ToolError && (['CANCELLED','SPAWN_FAILED','INPUT_TOO_LARGE','MP3_FRAME_UNPROVED',
        'MP3_ID3V2_UNSUPPORTED','MP3_TRAILING_TAG_UNSUPPORTED','MP3_SEEK_HEADER_UNSUPPORTED',
        'MP3_CUSTODY_UNAVAILABLE','MP3_PROBE_MISMATCH'].includes(error.code) || /^REMUX_MP3_[A-Z_]+$/.test(error.code))) throw error;
    fail('REMUX_MP3_PROBE_UNAVAILABLE',PROBE);
  } finally {
    if (source) {
      try { await source.close(); } catch { fail('MP3_CUSTODY_UNAVAILABLE','The MP3 source observation could not be closed cleanly.'); }
      current();
      try { source.assertNamedCurrent({signal}); } catch (error) {
        if (error.code==='INPUT_CHANGED') fail('INPUT_CHANGED',INPUT);throw error;
      }
    }
  }
  return Object.freeze({reasonCode:result.reasonCode,reason:`Standalone MP3: ${result.rate} Hz, ${result.layout}. MP3-to-MP4 copy is not enabled; no audio was copied or converted to AAC. Some Apple players may not play MP3 audio inside MP4.`});
}
module.exports={discoverMp3Diagnostic, inspectMp3Diagnostic, MP3_NOTICE};
