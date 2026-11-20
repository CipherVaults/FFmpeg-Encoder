from copy import deepcopy
import importlib.util
import os
import tempfile
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[1]/'scripts/qualification-tools/q-fast-oracle/swapped_content.py'
s=importlib.util.spec_from_file_location('qswap_content',p)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def model():
    a=[{'id':1,'kind':'video','frames':56,'rowDigest':'9'*64,'edit':['28/15','1/15']}]
    for i,d in enumerate(('1','2'),2):
        a.append({'id':i,'kind':'audio','rate':48000,'channels':2,'sampleFrames':88176,
                  'pcmSha256':d*64,'channelHashes':[d*64,('a' if i==2 else 'b')*64],
                  'language':'eng' if i==2 else 'ara','default':int(i==3),'edit':['1837/1000','8/375']})
    return {'role':m.ROLE,'source':m.PAIR['source'],'tracks':a},{'role':m.ROLE,'output':m.PAIR['output'],'tracks':deepcopy(a)}

class Swap(unittest.TestCase):
    def test_equal_pcm_results_are_not_called_a_swap(self):
        source,target=model();result=m.compare_tracks(source,target)
        self.assertTrue(result['equalOrderedAudio']);self.assertFalse(result['fullySwappedAudio'])
        self.assertFalse(result['sourceRawDecodeRetained'])
    def test_only_the_full_opposite_pcm_and_both_channels_establish_a_swap(self):
        source,target=model()
        for n in (1,2):
            for name in ('pcmSha256','channelHashes'):
                target['tracks'][n][name]=deepcopy(source['tracks'][3-n][name])
        r=m.compare_tracks(source,target)
        self.assertTrue(r['fullySwappedAudio']);self.assertEqual(r['mappedFullPcmMatches'],[False,False])
        target['tracks'][2]['channelHashes'][1]='9'*64
        self.assertFalse(m.compare_tracks(source,target)['fullySwappedAudio'])
    def test_labels_or_times_changed_are_not_content_order_proof(self):
        for n,field,v in ((1,'language','ara'),(1,'default',1),(2,'edit',['2','1/25']),(1,'sampleFrames',88175)):
            source,target=model();target['tracks'][n][field]=v
            with self.assertRaises(m.core.WitnessUnknown):m.compare_tracks(source,target)
    def test_unknown_pair_invalid_digest_incomplete_channel_data_refuse(self):
        source,target=model()
        target['output']={'sha256':'7'*64,'bytes':85263}
        with self.assertRaises(m.core.WitnessUnknown):m.compare_tracks(source,target)
        for k,v in (('pcmSha256','wrong'),('channelHashes',['1'*64])):
            source,target=model();target['tracks'][1][k]=v
            with self.assertRaises(m.core.WitnessUnknown):m.compare_tracks(source,target)
p2=p.with_name('check-swapped-component.py')
sp=importlib.util.spec_from_file_location('qswap_offline',p2)
reader=importlib.util.module_from_spec(sp);sp.loader.exec_module(reader)

class Evidence(unittest.TestCase):
    def test_absent_evidence_is_unknown_not_a_negative(self):
        with tempfile.TemporaryDirectory() as empty:
            observation,status=reader.report(empty,empty)
        self.assertEqual(status,2)
        self.assertEqual(observation['status'],'not-comparable')
        self.assertFalse(observation['contributesToNormalFastAccuracy'])
        self.assertNotIn('fastCodedVerdict',observation)

    @unittest.skipUnless(os.environ.get('Q_COMPONENT_ASSAY') and os.environ.get('Q_SWAPPED_OUTPUT_DECODE'),
                         'original component assay and independent output-only decoder receipts not supplied')
    def test_actual_retained_pair_and_withheld_output_oracle(self):
        old=os.environ['Q_COMPONENT_ASSAY']; fresh=os.environ['Q_SWAPPED_OUTPUT_DECODE']
        observation,status=reader.report(old,fresh)
        self.assertEqual(status,0); self.assertEqual(observation['fastReason'],'REMUX_PACKET_SIZE')
        self.assertEqual(observation['decodedMediaObservation']['mappedFullPcmMatches'],[False,False])
        self.assertEqual(observation['decodedMediaObservation']['oppositeTrackFullPcmMatches'],[True,True])
        self.assertFalse(observation['contributesToNormalFastAccuracy'])
        self.assertIsNone(observation['normalProductVerdict'])
        with tempfile.TemporaryDirectory() as empty:
            incomplete,exit_code=reader.report(old,empty)
        self.assertEqual(exit_code,2)
        self.assertEqual(incomplete['reason'],'missing-incomplete-or-mismatched-independent-evidence')
        self.assertNotIn('decodedMediaObservation',incomplete)

if __name__=='__main__':unittest.main(verbosity=2)
