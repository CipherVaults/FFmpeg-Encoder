import importlib.util
from pathlib import Path
import unittest
from copy import deepcopy

MOD = Path(__file__).resolve().parents[1] / 'scripts/qualification-tools/q-fast-oracle/check-sample.py'
spec = importlib.util.spec_from_file_location('compare_sample', MOD)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def pair():
    return {'source': {'bytes': 200, 'sha256': 'a' * 64},
            'output': {'bytes': 225, 'sha256': 'b' * 64}}


def models():
    mapping = [{'inputIndex': i, 'outputIndex': i, 'codec': name}
               for i, name in enumerate(('h264', 'aac', 'aac'))]
    fast = {'schema': 'q-fast-witness-v1', 'role': check.FAST_ROLE, 'caseId': 'mixed',
            'pair': pair(), 'method': check.FAST_METHOD, 'mapping': mapping,
            'verdict': 'accept', 'rejectScope': None,
            'provenance': {name: '3' * 64 for name in check.FAST_EVIDENCE}}
    fast['provenance']['runtimeIdentity'] = check.RUNTIME
    inv = [[1, 'video'], [2, 'audio'], [3, 'audio']]
    decoded = {'scope': check.DECODE_SCOPE, 'pair': pair(), 'runtimeIdentity': check.RUNTIME,
               'trackInventory': [deepcopy(inv), deepcopy(inv)], 'executionAuthorized': False,
               'generalMetadataValidated': False, 'verdict': 'equal',
               **{name: '4' * 64 for name in check.DECODE_EVIDENCE}}
    return fast, decoded


class Comparison(unittest.TestCase):
    def test_four_decoded_question_combinations(self):
        codes = {('accept', 'equal'): 'agree-on-decoded-media',
                 ('accept', 'different'): 'fast-accepted-when-decoded-media-differed',
                 ('reject', 'equal'): 'fast-refused-when-decoded-media-matched',
                 ('reject', 'different'): 'both-detected-decoded-media-difference'}
        for (fv, dv), code in codes.items():
            with self.subTest(fast=fv, oracle=dv):
                f, d = models(); f['verdict'] = fv; d['verdict'] = dv
                f['rejectScope'] = 'decoded-media' if fv == 'reject' else None
                row = check.compare('mixed', f, d)
                self.assertEqual(row['comparison'], code)
                self.assertEqual(row['pair'], pair())
                self.assertFalse(row['routeAuthorized'])
                self.assertFalse(row['generalPreservationEstablished'])

    def test_unknown_and_out_of_domain_are_not_verifier_errors(self):
        mutations = [lambda f, d: f.update(verdict='unknown', pair=None),
                     lambda f, d: d.update(verdict='unknown'),
                     lambda f, d: d['pair']['output'].update(bytes=224),
                     lambda f, d: d.update(pair={'source':pair()['output'],'output':pair()['source']}),
                     lambda f, d: f.update(role='different-file-family'),
                     lambda f, d: f.update(caseId='twins'),
                     lambda f, d: d.update(runtimeIdentity='9'*64),
                     lambda f, d: f['mapping'][1].update(outputIndex=2),
                     lambda f, d: f['mapping'][1].update(outputIndex=True),
                     lambda f, d: d['trackInventory'][1].reverse(),
                     lambda f, d: f['provenance'].pop('qaSha256'),
                     lambda f, d: d.update(runtimeManifestSha256='wrong'),
                     lambda f, d: d.update(executionAuthorized=True),
                     lambda f, d: d.update(generalMetadataValidated=True)]
        for n, mutate in enumerate(mutations):
            with self.subTest(case=n):
                f, d = models(); mutate(f, d)
                self.assertEqual(check.compare('mixed', f, d)['comparison'], 'not-comparable')
        for reason in ('other-preservation', 'operational', 'unknown'):
            for dv in ('equal', 'different'):
                f, d = models(); f.update(verdict='reject',rejectScope=reason); d['verdict']=dv
                self.assertEqual(check.compare('mixed', f, d)['comparison'], 'not-comparable')

    def test_path_free_projection_does_not_relay_evidence_text(self):
        f,d=models()
        for value in (f,d,f['provenance']):
            value['message']='/private/input/metadata'; value['stderr']='ignored'
        r=check.compare('mixed', f,d)
        self.assertEqual(r['comparison'],'agree-on-decoded-media')
        self.assertNotIn('/private/',str(r));self.assertNotIn('stderr',str(r))
        self.assertFalse(r['generalPreservationEstablished'])

    def test_vote_table_retains_uncompared_pairs_without_fabricating_negative_coverage(self):
        f,d=models(); a=check.compare('mixed',f,d)
        unknown=check.compare('twins',{'verdict':'unknown'},{'verdict':'unknown'})
        v=check.summarize([a,unknown]);self.assertEqual(v['comparablePairs'],1)
        self.assertEqual(v['nonComparablePairs'],1);self.assertEqual(v['comparableFastRejects'],0)
        self.assertEqual(v['fastAcceptedDecodedDifferent'],0)
        self.assertFalse(v['sensitivityOrSpecificityEstimated'])

if __name__=='__main__':unittest.main(verbosity=2)
