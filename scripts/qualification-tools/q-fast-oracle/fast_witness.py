"""Read-only test adapter for the frozen 116 normal two-AAC QA evidence."""

import argparse
import hashlib
import json
import os
from pathlib import PurePosixPath
import stat

# Immutable allowlist transcribed from the actual lead-supervised 116 run.
PINS = {'qa': ['released-normal-116-residual-01/qa-report.json',
        'f0b05cfde0b97f0f056ae7ccd5a5500790f475559fdc8d2a8d46a00035c8be3b'],
 'supervisor': ['supervisor-released-normal-116-residual-01.json',
                '96dc7eb48f11f1dc4f38356fe184cc589fa81c5459c2203d0886dccc61a219a8'],
 'runner': ['normal-qa.cjs', '8b1425b7494575f2b3958e6320229e69a34ec238148e66da57fbc9e232b52639'],
 'binding': ['BINDING-116.json', '4f3eac942f4204aba0ba46a3b8747de9865f26417f72fb15b8535e2386f85e60'],
 'release': ['LEAD-QA-116.json', '85686d932ee15f6bde91563aa80014d4a52f216df5b3e73a6c7c73b30645475d'],
 'rows': {'mixed': {'scenario': 'mixed-720',
                    'receipt': ['released-normal-116-residual-01/mixed-720/state/operation-evidence/job-1ce29df5-55fa-4fe9-b5cf-765b107b2500/remux-evidence-wLq6qZ/receipt.json',
                                'f7806c14a1c9444f4571d34a87dde227d27e05da089033a8bd8f0783cae8c774'],
                    'intent': ['released-normal-116-residual-01/mixed-720/state/provenance-v1/4adddee3-a156-4eeb-aa76-74457b251832.intent.json',
                               'b21bcc400228d86cc65c07a1c76a02912187521aa3a3bafed059d9bdf2cb61a0'],
                    'published': ['released-normal-116-residual-01/mixed-720/state/provenance-v1/4adddee3-a156-4eeb-aa76-74457b251832.published.json',
                                  '0d8e4e7000971b0f96b95249219be05dbeb26e4457b953ca75eeddfc68c4f9df'],
                    'pair': {'source': ['released-normal-116-residual-01/mixed-720/in/original.mp4',
                                        'd6060bf4b33f8518d41d7f4d570e395e382bb6fa64eeb16d06dd4e0b45b96978',
                                        1264415],
                             'output': ['released-normal-116-residual-01/mixed-720/out/original_Remux-MP4.mp4',
                                        '10274b8a4599a2187c5b434c47c6284729549b1cdbeae92ae5d5901566b77709',
                                        1264756]}},
          'twins': {'scenario': 'twins-1080',
                    'receipt': ['released-normal-116-residual-01/twins-1080/state/operation-evidence/job-d0384acd-5b87-4713-bd09-1a7e7484fdd3/remux-evidence-7vOF6O/receipt.json',
                                '481ec62ea432252459a9a14373c968bf41a529e5562d9e020aca0eb6a49372b1'],
                    'intent': ['released-normal-116-residual-01/twins-1080/state/provenance-v1/dbcc9322-17d3-4895-a52f-e55440136f9b.intent.json',
                               'cf0e4d7c1688fe1e8e6979f8719f4dc3dd86369f4313c1449dfe478a1d3e61fa'],
                    'published': ['released-normal-116-residual-01/twins-1080/state/provenance-v1/dbcc9322-17d3-4895-a52f-e55440136f9b.published.json',
                                  '3f55cc250f46e85164361baa884022df1c5618d87ea125d2ec418cb3b0a1583f'],
                    'pair': {'source': ['released-normal-116-residual-01/twins-1080/in/original.mp4',
                                        'faa0029455ee8ada0da580b2a650812db72ff089c523c8bca4b4d8a1e03edc5c',
                                        3052177],
                             'output': ['released-normal-116-residual-01/twins-1080/out/original_Remux-MP4.mp4',
                                        '759ec7afd279347aff53e08cf31ebc54d2e6800cc9850865b442a636e5791537',
                                        3052518]}}}}

ROLE = 'mp4-full-h264-two-aac-exact-ordered-copy-v1'
METHOD = 'packet-identity-v1'
RUNTIME = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13'
MAPPING = [(0, 0, 'h264'), (1, 1, 'aac'), (2, 2, 'aac')]
MAX_BYTES = 4 * 1024 * 1024


class EvidenceError(Exception):
    """The exact original observation cannot be bridged; never a media refusal."""


def require(ok, reason):
    if not ok:
        raise EvidenceError(reason)


def same_stamp(left, right, fields):
    return all(key in left and key in right and left[key] == right[key] for key in fields)


def open_artifact(root, pin):
    """Read only fixed relative regular single-link artifacts, including after relocation."""
    rel, expected, *sizes = pin
    parts = PurePosixPath(rel).parts
    require(parts and all(p not in ('/', '..', '.') for p in parts), 'artifact-path')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    directories = []
    fd = None
    try:
        parent = root
        for part in parts[:-1]:
            parent = os.open(part, flags | os.O_DIRECTORY, dir_fd=parent)
            directories.append(parent)
        fd = os.open(parts[-1], flags, dir_fd=parent)
        before = os.fstat(fd)
        def stamp(s):
            return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink, s.st_mode)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= MAX_BYTES
                and (not sizes or sizes == [before.st_size]), 'artifact-shape')
        remaining = before.st_size
        digest = hashlib.sha256()
        chunks = []
        while remaining:
            data = os.read(fd, min(65536, remaining))
            require(data, 'artifact-short-read')
            digest.update(data)
            if rel.endswith('.json'):
                chunks.append(data)
            remaining -= len(data)
        require(stamp(before) == stamp(os.fstat(fd)) ==
                stamp(os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)), 'artifact-currentness')
        require(digest.hexdigest() == expected, 'artifact-digest')
        return json.loads(b''.join(chunks)) if rel.endswith('.json') else None
    finally:
        if fd is not None:
            os.close(fd)
        for directory in reversed(directories):
            os.close(directory)


def _read(root, row):
    def load(pin):
        return open_artifact(root, pin)
    qa = load(PINS['qa'])
    sup = load(PINS['supervisor'])
    bind = load(PINS['binding'])
    release = load(PINS['release'])
    load(PINS['runner'])
    require(qa['baseCommit'] == 'fe3d7871c463acbcfcb65732eef972b020eba348'
            and qa['baseTree'] == '8e00d4b79ce887eb3ce8048f7539cf28fb9c8cb5'
            and not qa['errors'] and sup['exit'] == 0 and not sup['terminationNeeded']
            and not sup['leftoverGroupKilled'] and sup['qaReportSha256'] == PINS['qa'][1]
            and qa['releaseSha256'] == PINS['release'][1] == sup['releaseSha256']
            and qa['bindingSha256'] == PINS['binding'][1] == sup['bindingSha256'] == release['bindingSha256']
            and qa['baseCommit'] == bind['baseCommit'] and qa['baseTree'] == bind['baseTree']
            and qa['candidateRecord'] == bind['candidateRecord']
            and bind['closure'][qa['candidateRecord']['path']] == qa['candidateRecord']['sha256']
            and release['runnerSha256'] == PINS['runner'][1], 'supervised-run')
    short, case = row
    pins = PINS['rows'][short]
    accepted = qa['positives'][short]
    receipt = load(pins['receipt'])
    intent, published = load(pins['intent']), load(pins['published'])
    for pin in pins['pair'].values():
        load(pin)
    source, output = (accepted[k] for k in ('source','output'))
    for which, entry in [('source', source), ('output', output)]:
        require([entry['sha256'], entry['bytes']] == pins['pair'][which][1:], 'pair-fingerprint')
    require(bind['sources'][short]['sha256'] == source['sha256'], 'frozen-source')
    output_id = accepted['markerOutputId']
    authority = accepted['authority']
    require(authority == {'cell':'internal-isobmff-mp4-q2l-two-aac-v1',
                          'policy':qa['candidateRecord']['policyIdentity'],
                          'evidence':qa['candidateRecord']['evidenceId'], 'method':METHOD}
            and receipt['status'] == 'completed' and receipt['runtimeIdentity'] == RUNTIME
            and receipt['verificationMethod'] == METHOD and receipt['outputId'] == output_id
            and receipt['sourcePath'] == source['path'], 'selected-role-and-collector')
    complete = [r for r in qa['rows'] if r['scenario'] == case and r['type'] == 'complete']
    require(len(complete) == 1 and complete[0]['status'] == 'success'
            and complete[0]['disposition'] == {'kind':'published', 'published':True, 'file':output['path']},
            'normal-product-completion')
    writers = [c for c in qa['children'] if c['scenario'] == case and c['writer'] and
               c['settled']['code'] == 0 and c['settled']['signal'] is None]
    require(len(writers) == 1, 'unique-settled-writer')
    argv = writers[0]['argv']
    def args(option):
        return [argv[i+1] for i,p in enumerate(argv[:-1]) if p == option]
    require(args('-i') == [source['path']] and args('-map') == ['0:0','0:1','0:2'] and args('-c') == ['copy']
            and args('-f') == ['mp4'] and '-copyts' in argv and argv[-1] == receipt['outputPath']
            and 'FFMPEG_ENCODER_OUTPUT_ID=' + output_id in args('-metadata'), 'writer-stage-mapping')

    fields = ('dev','ino','size','mtimeNs','ctimeNs','birthtimeNs')
    si, oi = intent['sourceIdentity'], published['outputIdentity']
    before, after = receipt['sourceBefore'], receipt['sourceAfter']
    stage = receipt['outputBefore']
    native = receipt['nativeEditLists']
    essence = receipt['essenceEvidence']
    require(intent['kind'] == 'intent' and intent['profileId'] == 'remux-mp4'
            and intent['outputId'] == published['outputId'] == output_id
            and intent['destination'] == output['path'] == oi['canonicalPath']
            and published['kind'] == 'published' and si['canonicalPath'] == source['path']
            and str(source['bytes']) == before['size'] and str(output['bytes']) == stage['size']
            and before == after and stage == receipt['outputAfter']
            and before['nlink'] == stage['nlink'] == '1'
            and receipt['sourcePlayback']['complete'] is True and receipt['sourcePlayback']['identity'] == before
            and same_stamp(si, before, fields) and same_stamp(oi, stage, tuple(k for k in fields if k != 'ctimeNs')),
            'source-stage-publication-custody')
    require(essence['complete'] is True and essence['verificationMethod'] == METHOD
            and essence['outputId'] == output_id and essence['runtimeIdentity'] == RUNTIME
            and native['complete'] is True and native['identity'] == stage
            and native['outputSha256'] == essence['outputFileSha256'] == output['sha256']
            and essence['sourceEvidenceFingerprint'] == receipt['sourceProbeFingerprint']
            and essence['outputEvidenceFingerprint'] == receipt['outputProbeFingerprint']
            and receipt['verificationClaim']['interiorVideoDecoded'] is False
            and receipt['verificationClaim']['completeAudioDecoded'] is True, 'fast-evidence-and-stage-digest')

    require(all(i['status']=='completed' and i['exitCode']==0 and not i['stderrCapture']['truncated']
                for i in receipt['invocations']) and len(receipt['invocations']) > 0, 'collector-process')
    streams = essence['streams']
    exact_indices = [(a,b,'video' if codec=='h264' else 'audio') for a,b,codec in MAPPING]
    require([(x['inputIndex'],x['outputIndex'],x['codecType']) for x in streams] == exact_indices,
            'stream-mapping')
    def name(rel):
        return PurePosixPath(rel).name
    spools = {name(x['path']):x for x in receipt['artifacts']}
    require(len(spools) == len(receipt['artifacts']) and 12 <= len(spools) <= 32, 'collector-spools')
    for index, stream in enumerate(streams):
        left, right = stream['source'], stream['output']
        require(all(x['complete'] is True and x['exitCode']==0 and x['stderrComplete'] is True and
                    not x['errors'] and x['representation']==METHOD for x in (left,right))
                and all(left[k]==right[k] for k in ('unitCount','contentSha256','metadataSha256',
                                                   'decoderParametersSha256','firstPts','endPts')),
                'complete-comparison')
        if index:
            require(left['pcm'] == right['pcm'] and int(left['pcm']['samples']) > 0
                    and all(x['admission']['kind']=='aac-lc-packet-and-frozen-pcm-v1' for x in (left,right)),
                    'complete-audio')
        else:
            require(left['decodedWindows'] == right['decodedWindows']
                    and set(left['decodedWindows']) == {'start','end'}, 'bounded-video-decode')
        require(all(f'{side}-{index}.{suffix}' in spools
                    for side in ('source','output') for suffix in ('packets','identity')),
                'missing-core-collector-spool')
    for basename, meta in spools.items():
        rel = str(PurePosixPath(pins['receipt'][0]).with_name(basename))
        require(meta['path'] == str(PurePosixPath(receipt['directory']) / basename), 'spool-path')
        load([rel,meta['sha256'],meta['bytes']])
    return {
        'pair': {k:{'sha256':v[1],'bytes':v[2]} for k,v in pins['pair'].items()},
        'mapping': [{'inputIndex':a,'outputIndex':b,'codec':c} for a,b,c in MAPPING],
        'verdict': 'accept',
        'reason': 'normal-product-completion-and-frozen-collector-bridge',
        'rejectScope': None,
        'provenance': {'qaSha256':PINS['qa'][1], 'supervisorSha256':PINS['supervisor'][1],
                       'bindingSha256':PINS['binding'][1], 'releaseSha256':PINS['release'][1],
                       'collectorSha256':pins['receipt'][1], 'intentSha256':pins['intent'][1],
                       'publishedSha256':pins['published'][1], 'runtimeIdentity':RUNTIME,
                       'producerBaseCommit':qa['baseCommit'], 'producerBaseTree':qa['baseTree'],
                       'prospectiveRecordSha256':qa['candidateRecord']['sha256']},
    }


def observe_fast_witness(root, case_id):
    """Path-free observation, never a reusable receipt or execution authority."""
    known = isinstance(case_id, str) and case_id in PINS['rows']
    result = {'schema':'q-fast-witness-v1','role':ROLE,'caseId':case_id if known else 'no-comparable-negative',
              'method':METHOD,'pair':None,'verdict':'unknown','rejectScope':'unknown'}
    if not known:
        return {**result,'reason':'no-pinned-comparable-fast-verdict'}
    try:
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            result.update(_read(root_fd, (case_id,PINS['rows'][case_id]['scenario'])))
        finally:
            os.close(root_fd)
    except EvidenceError as error:
        result['reason'] = str(error)
    except (OSError, KeyError, ValueError, TypeError, IndexError):
        result['reason'] = 'retained-evidence-unavailable-or-unusable'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('retained_qa_root')
    parser.add_argument('case_id', choices=(*PINS['rows'], 'no-comparable-negative'))
    cli = parser.parse_args()
    print(json.dumps(observe_fast_witness(cli.retained_qa_root, cli.case_id), sort_keys=True))
