'use strict';

// Controlled O recovery fixture. It executes the real service lifecycle with
// dummy source/output bytes and an injected runner; no media executable runs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { EncoderService } = require('../../src/encoder-service.cjs');
const { PROFILES } = require('../../src/media.cjs');

(async () => {
  const root = process.argv[2], stateDir = path.join(root, 'state');
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  const probe = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p',
    width: 320, height: 180, color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv' }] };
  let encodeArgs;
  const service = new EncoderService({ ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir,
    inspectionCache: null, storageEligibility: { check: async () => ({ eligible: false }) },
    capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile, available: true, supportedBitDepths: [8] })), versions: {} }),
    inspect: async () => ({ probe, color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: 0 }, duration: 2 }),
    verify: () => { service.controller.abort(); return { valid: true, errors: [] }; },
    run: async (executable, args) => {
      if (executable === 'injected-ffmpeg') {
        encodeArgs = args; await fs.writeFile(args.at(-1), 'owned injected complete output', { flag: 'wx' });
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (executable !== 'injected-ffprobe') throw Error('Unexpected executable');
      const tags = {};
      for (let index = 0; index < encodeArgs.length; index++) if (encodeArgs[index] === '-metadata') {
        const text = encodeArgs[index + 1], split = text.indexOf('='); tags[text.slice(0, split)] = text.slice(split + 1);
      }
      return { exitCode: 0, stdout: JSON.stringify({ ...probe, format: { tags } }), stderr: '' };
    } });
  const record = service.recordIncident.bind(service);
  service.recordIncident = async event => {
    const result = await record(event);
    if (event.reason === 'JOB_DISPOSITION') {
      if (!result.persisted || event.context.outputDisposition?.kind !== 'retained-completed') throw Error('No durable retained disposition');
      await fs.writeFile(path.join(root, 'interrupted-child.json'), JSON.stringify({ eventId: result.eventId,
        planId: service.plan.id, fileId: event.fileId, retained: event.context.outputDisposition.file }), { flag: 'wx' });
      // End the process after this actual durable service event, before its
      // batch/session terminal records. No process/cleanup authority is saved.
      process.exit(23);
    }
    return result;
  };
  await fs.writeFile(path.join(input, 'owned.mp4'), 'owned synthetic input', { flag: 'wx' });
  const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
  const prepared = await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id,
    settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 } });
  if (prepared.items[0]?.status !== 'ready') throw Error('Fixture did not prepare');
  service.startBatch({ planId: prepared.planId, fileIds: [prepared.items[0].id] });
  await service.taskPromise;
  throw Error('Expected controlled interruption was not reached');
})().catch(error => { console.error(error.message); process.exit(24); });
