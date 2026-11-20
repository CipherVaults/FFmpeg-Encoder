"""Fixed cohort adapter. Existing archive pins are not runtime authorization."""
from pathlib import Path
def normal116_bundle(label, fast_root, source_decode_root, output_oracle_root, *, source_label=None):
 left,right=source_label or label,label
 run,prior=map(Path,(output_oracle_root,source_decode_root))
 qa=Path(fast_root)/'released-normal-116-residual-01'
 names={'mixed':'mixed-720','twins':'twins-1080'}
 sourceSha={'mixed':'d6060bf4b33f8518d41d7f4d570e395e382bb6fa64eeb16d06dd4e0b45b96978','twins':'faa0029455ee8ada0da580b2a650812db72ff089c523c8bca4b4d8a1e03edc5c'}
 outputSha={'mixed':'10274b8a4599a2187c5b434c47c6284729549b1cdbeae92ae5d5901566b77709','twins':'759ec7afd279347aff53e08cf31ebc54d2e6800cc9850865b442a636e5791537'}
 make=lambda directory,stem:{n:(directory/(n+'.stdout'),directory/(n+'.stderr')) for n in ['runtime-pre','runtime-post']+[stem+'-'+x for x in ('probe','decode-0','decode-1','decode-2')]}
 bundle=dict(targetReport=run/'oracle-report.json',sourceCalls=prior/'calls.json',
  sourceStem=names[left],label=right,sourcePipes=make(prior,names[left]),targetPipes=make(run,right+'-published'),
  sourceMedia=prior/(names[left]+'.mp4'),targetMedia=qa/names[right]/'out/original_Remux-MP4.mp4')
 pins=dict(sourceCalls='a48a272228e070a5cdd7f32660a8dc0e532e5cf8c1b59b54a00a7a1779bb3e45',
  targetReport='3a5ae3ccf6e50a2941aa36fd7b2e0ba6f4f038c08502d581e09b16f2a179a396',
  runtimeManifest='1e64bf7c4bbd7faaf70aa94f7574f8636f87319c50462ec303fac25a886db86b',
  sourceMedia=sourceSha[left],targetMedia=outputSha[right])
 return bundle,pins
