"""Read-only fast-side witness of the single retained 111 swapped-audio component assay."""

import argparse
import hashlib
import json
import os
from pathlib import PurePosixPath

# Work in isolated Python without adding an evidence directory to sys.path.
import importlib.util
from pathlib import Path
_spec = importlib.util.spec_from_file_location('prior_fast_witness', Path(__file__).with_name('fast_witness.py'))
_original = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_original)
EvidenceError, open_artifact, require = _original.EvidenceError, _original.open_artifact, _original.require

RUN = 'attempt-VLadVV'
CASE = 'twins-swapped'
DIRECTORY = f'{RUN}/{CASE}/remux-evidence-cbjeoH'
PINS = {
    'driver': ['assay-r02.cjs', '1684878e866de3bf0238c19c9599fb1a13fc78329206580f3aa7d73be7020e10'],
    'prereg': ['PREREG-r02.md', '5ea016f3e6e4b5d184d40dfc4d9e3031a9d005fcd03d73f3cf89207a6e7681b0'],
    'stdout': ['r02.stdout', '6432824848fe2f7e264968c5cbea01f3daaf5c64422cc4399fb8ef29c25eb43e'],
    'exit': ['r02.exit', '9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa'],
    'report': [f'{RUN}/report.json', 'e9709ae727204708f579416bbd3f22e56195e2b70950d9677917299a647916c1'],
    'terminal': [f'{DIRECTORY}/failure.json', '61aa0261b86d8f8c38206121c4d83c733009f6ef9d99fca7f624dbac2b4e50f1'],
    'source': [f'{RUN}/{CASE}/source.mp4', '2383de2ca90a13dfccbc081e6d0211424e01b7af44ef1720290307c38faf346d', 84922],
    'output': [f'{RUN}/{CASE}/output.mp4', '39b8e3baa2f620a4979d79d7e87036ffacee6df4c91edb8c35e07b15acd46a88', 85263],
}
METHOD = 'packet-identity-v1'
RUNTIME = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13'
BASE = '01ce1634689ebb0fcadd9c3724f6c19ad1e23db2'
TREE = '4391abe775289aa4037529fecf0f37bf7f6b2431'
COLLECTOR_SHA = '76ed8963119b7217b3d94cf6058bcf9afca081cadf0d51f6166be5fbdd408a75'
FAILURE = {'code': 'REMUX_PACKET_SIZE', 'message': 'Compressed packet size changed at packet 0'}
ROLE = 'component-mp4-full-h264-two-aac-ordered-comparison-v1'
CUSTODY = 'original-private-write-once-assay-with-failure-persistence-checks'


def canonical_digest(record):
    return hashlib.sha256(json.dumps(record, sort_keys=True, separators=(',',':')).encode('utf-8')).hexdigest()


def _check(root):
    def load(key):
        return open_artifact(root, PINS[key])
    for key in ('driver', 'prereg', 'stdout', 'exit'):
        load(key)
    report, terminal = load('report'), load('terminal')
    require(report['success'] is True and not report.get('finalFailure') and not report.get('failure')
            and report['scope'] == 'native Linux media-only; not app Prepare/Start or production qualification'
            and report['commit'] == BASE and report['driverSha256'] == PINS['driver'][1]
            and report['preregSha256'] == PINS['prereg'][1] and report['runtime']['runtimeIdentity'] == RUNTIME
            and report['sourceClosure'] == report['finalSourceClosure'], 'historical-driver-run-binding')
    rows = [r for r in report['cases'] if r['swap'] is True and r['label'] == 'twins']
    require(len(rows) == 1, 'exactly-one-swap-case')
    row = rows[0]
    assessment, copied = row['assessment'], row['copy']
    collection = row['collection']
    expected_streams = [(0,'video','h264'), (1,'audio','aac'), (2,'audio','aac')]

    def streams(probe):
        return [(s['index'], s['codec_type'], s['codec_name']) for s in probe['streams']]

    require(row['status'] == 'refused-as-planned'
            and row['mediaHash'] == PINS['source'][1] == assessment['sourceFingerprint']
            and row['outputSha256'] == PINS['output'][1]
            and assessment['status'] == 'qualification-required' and assessment['inputFamily'] == 'isobmff'
            and assessment['target'] == 'mp4' and assessment['request']['range'] is None
            and assessment['request']['omissionRequestIds'] == []
            and [s['inputIndex'] for s in assessment['expectedOutput']['streams']] == [0,1,2]
            and streams(row['sourceProbe']) == streams(row['outputProbe']) == expected_streams,
            'exact-pair-and-ordered-comparison-role')
    require(copied['code'] == 0 and copied['stderr'] == '' and 'progress=end' in copied['stdout'].splitlines()
            and 'total_size=' + str(PINS['output'][2]) in copied['stdout'].splitlines(), 'copy-process-capture')
    require(row['source'] == terminal['sourcePath'] and row['output'] == terminal['outputPath']
            and terminal['sourceProbeFingerprint'] == assessment['sourceEvidenceFingerprint']
            and terminal['directory'] == collection['directory']
            and all(terminal[k+'Before']['size'] == str(PINS[k][2]) and
                    terminal[k+'Before']['nlink'] == '1' for k in ('source','output'))
            and terminal['sourceAfter'] is None and terminal['outputAfter'] is None
            and 'persistenceFailure' not in terminal, 'original-failure-custody')
    require(terminal['status'] == collection['status'] == 'failed'
            and terminal['failure'] == collection['failure'] == FAILURE
            and terminal['verificationMethod'] == METHOD and terminal['runtimeIdentity'] == RUNTIME
            and terminal['essenceEvidence'] is None and terminal['comparisons'] == collection['comparisons'] == []
            and terminal['publicationAuthorized'] is False and terminal['qualificationGranted'] is False,
            'scoped-terminal-media-rejection')
    children = [x for x in report['children'] if x['case'] == CASE]
    phases = ['source-inspection','isolated-copy','output-inspection','shared-collector','shared-collector']
    require([x['phase'] for x in children] == phases
            and [x['tool'] for x in children] == ['ffprobe','ffmpeg','ffprobe','ffprobe','ffprobe']
            and all(x['child']['code'] == 0 and x['child']['signal'] is None for x in children),
            'single-writer-then-readers')
    argv = children[1]['argv']

    def values(option):
        return [argv[i+1] for i,p in enumerate(argv[:-1]) if p == option]

    require(values('-i') == [row['source']] and argv[-1] == row['output']
            and values('-map') == ['0:0','0:2','0:1'] and values('-c') == ['copy']
            and values('-f') == ['mp4'] and '-n' in argv
            and 'FFMPEG_ENCODER_OUTPUT_ID='+terminal['outputId'] in values('-metadata'),
            'deliberate-audio-permutation-not-comparison-map')
    reads = terminal['invocations']
    require(len(reads) == collection['invocationCount'] == 2, 'two-packet-reads')
    for key, observed, child in zip(('source','output'), reads, children[3:]):
        require(observed['label'] == key+'-all-packets' and observed['args'] == child['argv']
                and observed['args'][-2:] == ['-i',row[key]]
                and observed['executable'] == report['runtime']['pins']['ffprobe']['path']
                and observed['status'] == 'completed' and observed['exitCode'] == 0
                and observed['stderr'] == '' and observed['stderrCapture'] == {'totalBytes':0,'truncated':False}
                and observed['stdoutCapture'] == {'totalBytes':observed['bytes'], 'truncated':False, 'streamed':True}
                and observed['bytes'] > 0 and len(observed['sha256']) == 64, 'clean-streamed-packet-read')
    expected_spools = {f'{side}-{i}.packets' for side in ('source','output') for i in range(3)}
    artifacts = {PurePosixPath(a['path']).name:a for a in terminal['artifacts']}
    require(len(terminal['artifacts']) == 6 and set(artifacts) == expected_spools, 'six-terminal-spools')
    for name, artifact in artifacts.items():
        require(artifact['path'] == str(PurePosixPath(terminal['directory']) / name)
                and artifact['identity']['size'] == str(artifact['bytes']), 'spool-report-binding')
        open_artifact(root, [f'{DIRECTORY}/{name}', artifact['sha256'], artifact['bytes']])
    require(all(artifacts[f'source-{left}.packets']['sha256'] ==
                artifacts[f'output-{right}.packets']['sha256'] for left,right in ((0,0),(1,2),(2,1)))
            and artifacts['source-1.packets']['sha256'] != artifacts['output-1.packets']['sha256'],
            'swapped-spool-cross-match')
    load('source')
    load('output')
    return {
        'pair': {k:{'sha256':PINS[k][1], 'bytes':PINS[k][2]} for k in ('source','output')},
        'verdict':'reject',
        'rejectScope':'compressed-packet-size',
        'reason':FAILURE['code'],
        'mapping':[{'inputIndex':n,'outputIndex':n,'codec':codec} for n,_,codec in expected_streams],
        'observedWriterMap':[0,2,1],
        'provenance':{
            'producerCommit':BASE, 'producerTree':TREE, 'collectorSourceSha256':COLLECTOR_SHA,
            'runtimeIdentity':RUNTIME, 'historicalReportSha256':PINS['report'][1],
            'terminalFailureSha256':PINS['terminal'][1], 'driverSha256':PINS['driver'][1],
            'preRegistrationSha256':PINS['prereg'][1], 'outerStdoutSha256':PINS['stdout'][1],
            'outerExitSha256':PINS['exit'][1], 'packetProbeStdoutSha256':[r['sha256'] for r in reads],
            'copyArgvSha256':canonical_digest(argv), 'runtimeManifestSha256':canonical_digest(report['runtime']),
            'copyStdoutSha256':hashlib.sha256(copied['stdout'].encode('utf-8')).hexdigest(),
            'packetSpoolSha256':{name:a['sha256'] for name,a in sorted(artifacts.items())},
        },
        'custody': CUSTODY,
        'terminalMediaAfterStampsPresent': False,
        'completeCollection': False,
    }


def observe_swapped_fast(root):
    """Return a path-free component witness; never enter a normal-product denominator."""
    result = {'schema':'q-fast-component-reject-v1', 'study':'component-only', 'role':ROLE,
              'caseId':CASE, 'method':METHOD, 'pair':None, 'verdict':'unknown', 'rejectScope':'unknown',
              'normalComparable':False, 'decodedEquality':None}
    try:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            result.update(_check(fd))
        finally:
            os.close(fd)
    except EvidenceError as error:
        result['reason'] = str(error)
    except (OSError, KeyError, ValueError, TypeError, IndexError):
        result['reason'] = 'retained-evidence-unavailable-or-unusable'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('retained_assay_root')
    print(json.dumps(observe_swapped_fast(parser.parse_args().retained_assay_root), sort_keys=True))
