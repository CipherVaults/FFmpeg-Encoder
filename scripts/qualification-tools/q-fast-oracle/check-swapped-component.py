"""Separate finite study: a recorded compressed-copy rejection and independently observed ordered decoded content."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys


def sibling(name):
    spec = importlib.util.spec_from_file_location('swap_'+name, Path(__file__).resolve().with_name(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Fingerprints of the one retained, independently scoped observation. They
# select a historical receipt, not authority to run another checker or writer.
SEAL = {
    'binding': '94f171f8b18f41f85983ecd13f1bd69ac0d44b3903e5a418f9beb8dc52a786e4',
    'release': '241225bdb98e7584e2014d27c6e051a9a9d0d0f1c9e49fce1f84fe035fb4dc4a',
    'report': '36da96c9eef3a34f600367b2083ed5e859d2b0be70d56e6ba3021e8f80d5b0be',
}
LIMITATIONS = [
    'The fast decision occurred in a component assay, not a normal app job.',
    'It rejected compressed packet size, not decoded equivalence. These are separate predicates.',
    'The original source decode retained full PCM, per-channel and picture-row digests, not the raw source decoder pipes.',
    'The failed collector has no success-only terminal source/output after-stamps or completed collection.',
    'No Windows, player, release, accuracy estimate, or production policy follows.',
]


def report(assay_root, oracle_root):
    historical, decoder = sibling('swapped_fast'), sibling('swapped_content')
    core=decoder.core
    result={'study':'separate-component-only-swapped-synthetic', 'status':'not-comparable',
            'contributesToNormalFastAccuracy':False, 'productAdmission':False, 'limitations':LIMITATIONS}
    fast=historical.observe_swapped_fast(assay_root)
    if fast.get('pair')!=decoder.PAIR or fast.get('verdict')!='reject' or fast.get('rejectScope')!='compressed-packet-size':
        return {**result,'reason':'unbound-compressed-packet-refusal'},2
    try:
        seal=SEAL
        root=Path(oracle_root); assay=Path(assay_root)
        read=lambda rel,cap,h:core.raw(root/rel,cap,h)
        binding=core.js(read('BINDING.json',32768,seal['binding']))
        release=core.js(read('LEAD-ORACLE.json',8192,seal['release']))
        assert release=={'decision':'authorize-one-swapped-output-only-native-oracle','bindingSha256':seal['binding']}
        for f in ('oracle','parser','runtime'):
            n=f+'.json' if f=='runtime' else f+'.py';p=binding['materials'][f]
            read(n,p['bytes'],p['sha256'])
        assert binding['materials']['historicalMedia']['sha256']==decoder.SOURCE and binding['output']['sha256']==decoder.OUTPUT
        old=decoder.old_source(assay)
        doc=core.js(read('attempt/report.json',131072,seal['report']))
        assert doc['bindingSha256']==seal['binding'] and doc['releaseSha256']==seal['release']
        assert doc['allObservedChildrenClosed'] is True and doc['executionAuthorized'] is False
        assert doc['sourceSha256']==decoder.SOURCE and doc['outputSha256']==decoder.OUTPUT
        before,after=doc['identitiesBefore'],doc['identitiesAfter']
        assert before==after and before['held']==before['named'] and before['held'][2]==decoder.PAIR['output']['bytes']
        assert set(before['tools'])=={'ffmpeg','ffprobe'}
        assert all(t['held']==t['named'] for t in before['tools'].values())
        rig=core.js(read('runtime.json',8192,binding['materials']['runtime']['sha256']))
        assert rig['runtimeIdentity']==core.RUNTIME and all(t['sha256']==rig['pins'][k]['sha256'] for k,t in before['tools'].items())
        calls=doc['calls'];stem=decoder.fixed_pipe_commands(calls)
        blobs=[]
        for call in calls:
            name=call['name']
            data=read('attempt/'+name+'.stdout',2097152,call['stdoutSha256'])
            assert read('attempt/'+name+'.stderr',4096,core.EMPTY)==b''
            blobs.append(data)
        media=core.raw(assay/'attempt-VLadVV/twins-swapped/output.mp4',131072,decoder.OUTPUT)
        observed=decoder.target_tracks(media,core.js(blobs[0]),blobs[1:],stem)
        answer=decoder.compare_tracks(old,observed)
    except (OSError, KeyError, ValueError, TypeError, AssertionError, IndexError, UnicodeError):
        return {**result,'reason':'missing-incomplete-or-mismatched-independent-evidence'},2
    # The two verdicts stay distinct even when both agree the output is bad.
    checked={**result,'pair':decoder.PAIR,'status':'compared','fastCodedVerdict':'reject',
        'fastReason':'REMUX_PACKET_SIZE','completeFastCollection':False,
        'fastFailureReceiptSha256':fast['provenance']['terminalFailureSha256'],'outputOnlyReportSha256':seal['report'],
        'historicalIndependentSourceReportSha256':old['historicalOracleSha256'],
        'completeFrames':56,'presentedSamplesPerChannelByTrack':[88176,88176],'audioHz':[48000,48000],
        'decodedMediaObservation':answer,'normalProductVerdict':None,'falseRefusalAssessment':None}
    return checked, 0 if answer['fullySwappedAudio'] and answer['wholePictureRowsMatchEarlierDigest'] else 1


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--assay-root', type=Path, required=True)
    ap.add_argument('--output-oracle-root', type=Path, required=True)
    args=ap.parse_args()
    if not sys.platform.startswith('linux') or not __debug__:
        ap.error('Requires ordinary non-optimized Python on Linux.')
    sys.dont_write_bytecode=True
    value,status=report(args.assay_root,args.output_oracle_root)
    print(json.dumps(value,indent=2,sort_keys=True))
    return status

if __name__=='__main__':
    sys.exit(main())
