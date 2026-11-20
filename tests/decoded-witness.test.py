"""Retained exact pinned examples; safe to run without prior media."""
import importlib.util,os,unittest
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'scripts/qualification-tools/q-fast-oracle/decoded-witness.py'
s=importlib.util.spec_from_file_location('decoded_witness',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
BASE=[os.environ.get(k) for k in ('Q_DECODED_ORACLE_ROOT','Q_DECODED_SOURCE_RECEIPTS','Q_DECODED_QA_ROOT')]
adapter=importlib.util.spec_from_file_location('decoded_witness_normal116',p.with_name('decoded-witness-normal116.py'))
n=importlib.util.module_from_spec(adapter);adapter.loader.exec_module(n)
def case(left,right,base):
 oracle,source,fast=base
 return n.normal116_bundle(right,fast,source,oracle,source_label=left)
class Reader(unittest.TestCase):
 def test_missing_unknown(self):
  with self.assertRaises(m.WitnessUnknown):m.read_decoded_witness({}, {})
 def test_bounded_timing_and_duplicate_json(self):
  with self.assertRaises(AssertionError):m.expanded([(10000,1)],12)
  with self.assertRaises(AssertionError):m.js(b'{"a":1,"a":2}')
 @unittest.skipUnless(all(BASE),'exact archived bytes required')
 def test_held_witnesses(self):
  for name,frames in [('mixed',162),('twins',178)]:
   r=m.read_decoded_witness(*case(name,name,BASE))
   self.assertEqual(r['verdict'],'equal'); self.assertFalse(r['generalMetadataValidated'])
   self.assertEqual(r['tracks'][0]['decoded']['frames'],frames)
   self.assertNotIn(str(BASE[0]),str(r))
 @unittest.skipUnless(all(BASE),'exact archived bytes required')
 def test_true_cross_pair_different(self):
  r=m.read_decoded_witness(*case('mixed','twins',BASE))
  self.assertEqual(r['verdict'],'different')
 @unittest.skipUnless(all(BASE),'exact archived bytes required')
 def test_missing_or_wrong_bytes_unknown(self):
  b,p=case('mixed','mixed',BASE)
  b['targetPipes']['mixed-published-decode-1']=b['targetPipes']['mixed-published-decode-2']
  with self.assertRaises(m.WitnessUnknown):m.read_decoded_witness(b,p)
if __name__=='__main__':unittest.main(verbosity=2)
