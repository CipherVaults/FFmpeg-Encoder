"""Portable fail-closed checks; no authentic run artifacts required."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest

import importlib.util
_spec = importlib.util.spec_from_file_location('fast_witness', Path(__file__).with_name('fast_witness.py'))
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
MAX_BYTES, PINS, EvidenceError = _module.MAX_BYTES, _module.PINS, _module.EvidenceError
observe_fast_witness, open_artifact = _module.observe_fast_witness, _module.open_artifact


class FastWitnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fd = os.open(self.root, os.O_DIRECTORY | os.O_RDONLY)
        self.addCleanup(os.close, self.fd)

    def test_unmatched_is_unknown_and_copies_no_paths(self):
        verdict = observe_fast_witness(self.root, '/temporary/path')
        self.assertEqual(verdict['verdict'], 'unknown')
        self.assertEqual(verdict['rejectScope'], 'unknown')
        self.assertIsNone(verdict['pair'])
        self.assertNotIn('/temporary/path', repr(verdict))

    def test_missing_and_self_asserted_success_never_accept(self):
        self.assertEqual(observe_fast_witness(self.root,'mixed')['verdict'],'unknown')
        report = self.root / PINS['qa'][0]
        report.parent.mkdir()
        report.write_text('{"verdict":"accept","rows":[]}')
        verdict = observe_fast_witness(self.root,'mixed')
        self.assertEqual(verdict['verdict'],'unknown')
        self.assertEqual(verdict['reason'],'artifact-digest')
        self.assertIsNone(verdict['pair'])

    def test_exact_regular_byte_binding_and_ordinary_change(self):
        file = self.root / 'file.json'
        file.write_bytes(b'{}')
        pin = [file.name,hashlib.sha256(b'{}').hexdigest(),2]
        self.assertEqual(open_artifact(self.fd,pin),{})
        file.write_bytes(b'[]')
        with self.assertRaisesRegex(EvidenceError,'artifact-digest'):
            open_artifact(self.fd,pin)

    def test_links_and_oversize_do_not_become_evidence(self):
        leaf = self.root / 'leaf'
        leaf.write_bytes(b'x')
        pin = [leaf.name,hashlib.sha256(b'x').hexdigest()]
        os.link(leaf, self.root / 'alias')
        with self.assertRaisesRegex(EvidenceError,'artifact-shape'):
            open_artifact(self.fd,pin)
        (self.root / 'alias').unlink()
        os.symlink(leaf, self.root / 'link')
        with self.assertRaises(OSError):
            open_artifact(self.fd,['link',pin[1]])
        os.symlink(self.root, self.root / 'other-dir')
        with self.assertRaises(OSError):
            open_artifact(self.fd,['other-dir/leaf',pin[1]])
        with leaf.open('wb') as handle:
            handle.truncate(MAX_BYTES + 1)
        with self.assertRaisesRegex(EvidenceError,'artifact-shape'):
            open_artifact(self.fd,pin)


if __name__ == '__main__':
    unittest.main()
