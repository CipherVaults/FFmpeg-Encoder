"""Compare retained full-copy fast decisions against exact independent decoded evidence.

This is an offline developer instrument. It never reads a user-supplied verdict,
runs a media executable, writes a file, grants a route, or estimates accuracy.
"""
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import sys

FAST_ROLE = 'mp4-full-h264-two-aac-exact-ordered-copy-v1'
FAST_METHOD = 'packet-identity-v1'
DECODE_SCOPE = 'complete-offline-h264-aac-mp4-only'
RUNTIME = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13'
FAST_EVIDENCE = ('qaSha256', 'supervisorSha256', 'bindingSha256', 'releaseSha256',
                 'collectorSha256', 'intentSha256', 'publishedSha256', 'prospectiveRecordSha256')
DECODE_EVIDENCE = ('sourceInvocationSha256', 'targetInvocationSha256', 'runtimeManifestSha256')
TRACK_INVENTORY = [[1, 'video'], [2, 'audio'], [3, 'audio']]
MAPPING = [{'inputIndex': i, 'outputIndex': i, 'codec': codec}
           for i, codec in enumerate(('h264', 'aac', 'aac'))]
SHA = re.compile(r'[0-9a-f]{64}')
CLAIM = 'ordered full decoded H.264 picture content and presentation times; full per-channel AAC PCM and presented sample interval'
CODES = {
    ('accept', 'equal'): 'agree-on-decoded-media',
    ('accept', 'different'): 'fast-accepted-when-decoded-media-differed',
    ('reject', 'equal'): 'fast-refused-when-decoded-media-matched',
    ('reject', 'different'): 'both-detected-decoded-media-difference',
}


def digest(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def valid_pair(pair):
    if not isinstance(pair, dict) or set(pair) != {'source', 'output'}:
        return False
    for media in pair.values():
        if (not isinstance(media, dict) or set(media) != {'sha256', 'bytes'}
                or not digest(media['sha256']) or type(media['bytes']) is not int
                or not 0 < media['bytes'] <= 8 * 1024**2):
            return False
    return True


def compare(case, fast, decoded):
    """Join two adapter observations, *not* an authentication API for arbitrary JSON."""
    if case not in ('mixed', 'twins'):
        raise ValueError('Unrecognized frozen study sample.')
    row = {'sample': case, 'comparison': 'not-comparable', 'claim': CLAIM,
           'generalPreservationEstablished': False, 'routeAuthorized': False}

    def unknown(reason):
        return {**row, 'reason': reason}

    if not isinstance(fast, dict) or fast.get('verdict') not in ('accept', 'reject'):
        return unknown('no-bound-fast-media-verdict')
    if not isinstance(decoded, dict) or decoded.get('verdict') not in ('equal', 'different'):
        return unknown('no-complete-independent-decode')
    if (fast.get('schema') != 'q-fast-witness-v1' or fast.get('role') != FAST_ROLE
            or fast.get('caseId') != case or fast.get('method') != FAST_METHOD):
        return unknown('fast-method-or-sample-not-comparable')
    if not valid_pair(fast.get('pair')) or not valid_pair(decoded.get('pair')) or fast['pair'] != decoded['pair']:
        return unknown('different-or-unproved-file-pair')
    prov = fast.get('provenance')
    if (not isinstance(prov, dict) or any(not digest(prov.get(k)) for k in FAST_EVIDENCE)
            or any(not digest(decoded.get(k)) for k in DECODE_EVIDENCE)):
        return unknown('unbound-observation')
    if (decoded.get('scope') != DECODE_SCOPE or decoded.get('executionAuthorized') is not False
            or decoded.get('generalMetadataValidated') is not False or decoded.get('runtimeIdentity') != RUNTIME
            or prov.get('runtimeIdentity') != RUNTIME):
        return unknown('incompatible-domain-or-runtime')
    # JSON true and the integer 1 compare equal in Python but are not an
    # interchangeable stream identity. Check the canonical closed shapes.
    if (json.dumps(fast.get('mapping'), sort_keys=True) != json.dumps(MAPPING, sort_keys=True)
            or json.dumps(decoded.get('trackInventory')) != json.dumps([TRACK_INVENTORY, TRACK_INVENTORY])):
        return unknown('different-or-unproved-track-correspondence')
    fv, dv = fast['verdict'], decoded['verdict']
    if (fv == 'accept' and fast.get('rejectScope') is not None
            or fv == 'reject' and fast.get('rejectScope') != 'decoded-media'):
        return unknown('refusal-is-not-a-decoded-media-verdict')
    return {**row, 'comparison': CODES[(fv, dv)], 'pair': fast['pair'],
            'fast': {'verdict': fv, 'method': FAST_METHOD, **{k:prov[k] for k in FAST_EVIDENCE}},
            'independentDecode': {'verdict': dv, **{k:decoded[k] for k in DECODE_EVIDENCE}},
            'runtimeIdentity': RUNTIME}


def summarize(rows):
    c = Counter(r['comparison'] for r in rows)
    n = len(rows) - c['not-comparable']
    return {'requestedPairs': len(rows), 'comparablePairs': n, 'nonComparablePairs': len(rows)-n,
            'comparableFastRejects': c[CODES['reject','equal']] + c[CODES['reject','different']],
            'fastAcceptedDecodedDifferent': c[CODES['accept','different']],
            'fastRefusedDecodedEqual': c[CODES['reject','equal']],
            'bothDetectedDifference': c[CODES['reject','different']],
            'agreedOnDecodedMedia': c[CODES['accept','equal']],
            'sensitivityOrSpecificityEstimated': False}


def local_module(name):
    # Only the fixed sibling modules shipped with this tool are eligible. No
    # supplied manifest may name code, paths to import, or a process to spawn.
    if name not in ('fast_witness', 'decoded-witness', 'decoded-witness-normal116'):
        raise ValueError('Unknown adapter.')
    target = Path(__file__).resolve().with_name(name + '.py')
    spec = importlib.util.spec_from_file_location('q_checker_'+name.replace('-', '_'), target)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


def run(fast_root, source_root, oracle_root):
    fast = local_module('fast_witness'); full = local_module('decoded-witness'); corpus = local_module('decoded-witness-normal116')

    def oracle(label, source_label=None):
        try:
            bundle, pins = corpus.normal116_bundle(label, fast_root, source_root, oracle_root, source_label=source_label)
            return full.read_decoded_witness(bundle, pins)
        except (full.WitnessUnknown, OSError, ValueError):
            return {'verdict': 'unknown'}

    results = {}
    rows = []
    for label in ('mixed', 'twins'):
        results[label] = fast.observe_fast_witness(fast_root, label)
        decoded = oracle(label)
        row = compare(label, results[label], decoded)
        # Derived values only, not metadata, paths, errors, or review strings.
        if row['comparison'] != 'not-comparable':
            witness = row['independentDecode']
            witness['orderedTrackUnits'] = [
                {'trackId': index+1, 'unit': 'decoded-video-frames' if index == 0 else 'PCM-sample-frames-per-channel',
                 'source': tr['decodedSource']['frames' if index == 0 else 'sampleFrames'],
                 'output': tr['decoded']['frames' if index == 0 else 'sampleFrames']}
                for index, tr in enumerate(decoded['tracks'])]
        rows.append(row)
    # A real negative *oracle discrimination control*, deliberately not the
    # pair decided on by the fast checker. It is never counted as such a case.
    crossed = oracle('twins', source_label='mixed')
    joined = compare('twins', results['twins'], crossed)
    source_pair, target_pair = results['mixed'].get('pair'), results['twins'].get('pair')
    control_matches = (valid_pair(source_pair) and valid_pair(target_pair)
                       and crossed.get('pair') == {'source':source_pair['source'], 'output':target_pair['output']}
                       and joined.get('reason') == 'different-or-unproved-file-pair')
    control = {'sourceFrom':'mixed', 'outputFrom':'twins',
               'decodedDifferentOnExactCrossPair': crossed.get('verdict') == 'different' and control_matches,
               'attributedToFastChecker': joined['comparison'] != 'not-comparable',
               'countsAsFastNegative': False}
    summary = summarize(rows)
    report = {'schema':'q-fast-independent-sample-v1', 'corpus':'regular-116-two-AAC-prospective-synthetic',
              'mode':'retained offline evidence; no new media run', 'claim':CLAIM,
              'samples':rows, 'crossPairControl':control, 'summary':summary,
              'limitations':['Two bounded synthetic full-copy pairs from one pinned Linux runtime.',
                             'Container metadata, player behavior, seeking and complete preservation are not certified by a decode match.',
                             'No authentic in-domain fast-rejected pair here. The cross-pair control is not one.',
                             'Not evidence of current route enablement, Windows, owner media or release qualification.']}
    if summary['fastAcceptedDecodedDifferent'] or summary['fastRefusedDecodedEqual'] or control['attributedToFastChecker']:
        return report, 1
    if summary['nonComparablePairs'] or not control['decodedDifferentOnExactCrossPair']:
        return report, 2
    # A verified reject/different can be valid evidence, but cannot satisfy this
    # predeclared *positive* cohort's expected accept/equal verdict.
    return report, 0 if summary['agreedOnDecodedMedia'] == len(rows) else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    for name, helptext in [('fast-root', 'Restored 116 normal QA root containing its binding, receipts, and media.'),
                           ('source-decode-root', 'Restored source decode pipes directory containing calls.json.'),
                           ('output-oracle-root', 'Restored output oracle directory containing oracle-report.json.')]:
        ap.add_argument('--'+name, type=Path, required=True, help=helptext)
    args = ap.parse_args()
    if not sys.platform.startswith('linux'):
        ap.error('The retained file-evidence reader currently requires Linux.')
    if not __debug__:
        ap.error('Optimized Python is not accepted.')
    sys.dont_write_bytecode = True
    report, status = run(args.fast_root,args.source_decode_root,args.output_oracle_root)
    print(json.dumps(report, indent=2, sort_keys=True))
    return status

if __name__ == '__main__':
    sys.exit(main())
