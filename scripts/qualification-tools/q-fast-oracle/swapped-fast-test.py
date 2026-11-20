"""Portable fail-closed and scope-isolation checks."""
from pathlib import Path
import runpy
import tempfile
import unittest

import importlib.util
_spec=importlib.util.spec_from_file_location('swapped_fast',Path(__file__).with_name('swapped_fast.py'))
_m=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
CASE, METHOD, PINS, ROLE, observe_swapped_fast = _m.CASE, _m.METHOD, _m.PINS, _m.ROLE, _m.observe_swapped_fast


class SwappedFastTests(unittest.TestCase):
    def test_missing_provenance_is_not_a_fast_reject(self):
        with tempfile.TemporaryDirectory() as tmp:
            observed = observe_swapped_fast(tmp)
        self.assertEqual(observed['verdict'],'unknown')
        self.assertEqual(observed['rejectScope'],'unknown')
        self.assertEqual(observed['study'],'component-only')
        self.assertIsNone(observed['pair'])
        self.assertIsNone(observed['decodedEquality'])
        self.assertFalse(observed['normalComparable'])
        self.assertNotIn(tmp,repr(observed))

    def test_ordinary_tampered_outer_driver_is_not_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp)/PINS['driver'][0]).write_text('/* substitute */')
            observed = observe_swapped_fast(tmp)
        self.assertEqual(observed['verdict'],'unknown')
        self.assertEqual(observed['reason'],'artifact-digest')

    def test_root_link_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            link = Path(tmp)/'link'
            link.symlink_to(tmp, target_is_directory=True)
            self.assertEqual(observe_swapped_fast(link)['verdict'],'unknown')

    def test_even_component_reject_shape_is_not_comparable_by_normal_denominator(self):
        comparator = runpy.run_path(str(Path(__file__).with_name('check-sample.py')))
        # Exercise only schema discrimination; neither side is laboratory evidence here.
        fabricated_example = {'schema':'q-fast-component-reject-v1', 'role':ROLE, 'caseId':CASE,
                              'method':METHOD, 'verdict':'reject', 'rejectScope':'compressed-packet-size'}
        self.assertEqual(comparator['compare']('twins',fabricated_example,{'verdict':'different'})['reason'],
                         'fast-method-or-sample-not-comparable')
        with self.assertRaises(ValueError):
            comparator['compare'](CASE,fabricated_example,{'verdict':'different'})


if __name__ == '__main__':
    unittest.main()
