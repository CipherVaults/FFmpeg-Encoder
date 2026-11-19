import unittest,tempfile,pathlib,lzma,hashlib,importlib.util
from types import SimpleNamespace
from unittest.mock import patch
import signed_index as m
spec=importlib.util.spec_from_file_location('resolver',pathlib.Path(__file__).with_name('resolver.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Tests(unittest.TestCase):
 def exercise(self,mutate=None,signature=True,expiry=False,changes=None):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);(root/'lists').mkdir();data={};calls=[]
   for suite,host in m.ORIGINS:
    rows=[]
    for component in ('main','universe'):
     text='Package: locales\nVersion: 2.39-0ubuntu8.12\nArchitecture: all\nFilename: pool/main/g/glibc/locales.deb\nSize: 123\nSHA256: '+'a'*64+'\nSource: glibc\n\n'
     if mutate:text=mutate(text,suite,component)
     packed=lzma.compress(text.encode());rel=component+'/binary-amd64/Packages.xz'
     rows.append(' '+m.sha(packed)+' '+str(len(packed))+' '+rel)
     data['https://'+host+'/ubuntu/dists/'+suite+'/'+rel]=packed
    (root/'lists'/(host+'_ubuntu_dists_'+suite+'_InRelease')).write_text('-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nSuite: '+suite+'\nCodename: noble\nSHA256:\n'+'\n'.join(rows)+'\n-----BEGIN PGP SIGNATURE-----\nINERT')
   def run(argv,*args):
    calls.append(argv)
    if not signature:raise AssertionError('bad signature')
   def check(_):
    if expiry:raise AssertionError('expired')
   result=m.associate(changes or [{'package':'locales','proposedVersion':'2.39-0ubuntu8.12','proposedArchitecture':'all'}],root,1,run,r.paragraphs,check,lambda u,c,*_:data[u])
   return result,calls
 def test_all_origins_and_exact_tuple(self):
  out,calls=self.exercise();self.assertTrue(out['complete']);self.assertFalse(out['ready']);self.assertEqual(len(out['records'][0]['origins']),6);self.assertEqual(len(calls),3)
 def test_wrong_arch_missing_not_substituted(self):
  out,_=self.exercise(changes=[{'package':'locales','proposedVersion':'2.39-0ubuntu8.12','proposedArchitecture':'amd64'}]);self.assertFalse(out['complete']);self.assertIsNone(out['records'][0]['archive'])
 def test_wrong_version_missing(self):
  out,_=self.exercise(changes=[{'package':'locales','proposedVersion':'2.39-0ubuntu8.9','proposedArchitecture':'all'}]);self.assertFalse(out['complete'])
 def test_conflicting_origins(self):
  with self.assertRaisesRegex(AssertionError,'INDEX_CONFLICT'):self.exercise(lambda t,s,c:t.replace('a'*64,'b'*64)if s=='noble-security'else t)
 def test_duplicate_tuple(self):
  with self.assertRaisesRegex(AssertionError,'INDEX_DUPLICATE_TUPLE'):self.exercise(lambda t,s,c:t+t)
 def test_duplicate_field(self):
  with self.assertRaisesRegex(AssertionError,'DUPLICATE_FIELD'):self.exercise(lambda t,s,c:t.replace('Version:','version: 9\nVersion:'))
 def test_unsafe_path(self):
  with self.assertRaisesRegex(AssertionError,'INDEX_ARCHIVE_PATH'):self.exercise(lambda t,s,c:t.replace('pool/main/','pool/../'))
 def test_signature_failure(self):
  with self.assertRaises(AssertionError):self.exercise(signature=False)
 def test_deadline(self):
  with self.assertRaises(AssertionError):self.exercise(expiry=True)
 def test_index_cap(self):
  with patch.object(m,'INDEX_CAP',1):
   with self.assertRaisesRegex(AssertionError,'INDEX_BOUND'):self.exercise()
 def test_changed_index_bytes(self):
  # Corrupt the fetched bytes after their Release digest was formed.
  orig=m.associate
  def wrapped(*args):
   f=args[-1]
   return orig(*args[:-1],lambda u,c,*rest:f(u,c,*rest)+b'x')
  with patch.object(m,'associate',side_effect=wrapped):
   with self.assertRaisesRegex(AssertionError,'INDEX_IDENTITY'):self.exercise()
 def test_no_transaction_authorization(self):
  base={'locales':{'Version':'2.39-0ubuntu8.9','Architecture':'all'}}
  text='Inst locales [2.39-0ubuntu8.9] (2.39-0ubuntu8.12 noble [all])\nConf locales (2.39-0ubuntu8.12 noble [all])'
  with self.assertRaisesRegex(AssertionError,'INSTALLED_CHANGE_REQUIRES_REVIEW'):r.transaction(text,base)


class ResourceTests(unittest.TestCase):
 def test_drip_body_absolute_deadline(self):
  class Response:
   url='https://archive.ubuntu.com/ubuntu/dists/noble/main/binary-amd64/Packages.xz'
   count=0
   fp=SimpleNamespace(raw=SimpleNamespace(_sock=SimpleNamespace(settimeout=lambda n:None)))
   def isclosed(self):return False
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def read1(self,n):self.count+=1;return b'x'
  response=Response();timeouts=[]
  response.fp=SimpleNamespace(raw=SimpleNamespace(_sock=SimpleNamespace(settimeout=timeouts.append)))
  def check(end):
   if response.count>=3:raise AssertionError('deadline')
  with patch.object(m.urllib.request,'build_opener',return_value=SimpleNamespace(open=lambda *a,**k:response)),patch.object(m.time,'monotonic',return_value=0):
   with self.assertRaisesRegex(AssertionError,'deadline'):m.fetch(response.url,100,1,check)
  self.assertEqual(response.count,3);self.assertEqual(timeouts,[1,1,1])
 def test_post_read_deadline_even_eof(self):
  class Response:
   url='https://archive.ubuntu.com/ubuntu/dists/noble/main/binary-amd64/Packages.xz'
   done=False
   fp=SimpleNamespace(raw=SimpleNamespace(_sock=SimpleNamespace(settimeout=lambda n:None)))
   def isclosed(self):return False
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def read1(self,n):self.done=True;return b''
  response=Response()
  def check(_):
   if response.done:raise AssertionError('expired')
  with patch.object(m.urllib.request,'build_opener',return_value=SimpleNamespace(open=lambda *a,**k:response)),patch.object(m.time,'monotonic',return_value=0):
   with self.assertRaisesRegex(AssertionError,'expired'):m.fetch(response.url,10,1,check)
 def test_actual_xz_dictionary_limit(self):
  packed=lzma.compress(b'x',filters=[{'id':lzma.FILTER_LZMA2,'dict_size':128*1024**2}])
  with self.assertRaises(lzma.LZMAError):
   lzma.LZMADecompressor(format=lzma.FORMAT_XZ,memlimit=m.DECODER_MEMORY).decompress(packed,max_length=m.DECODE_CAP+1)
 def test_association_uses_decoder_limit(self):
  original=m.lzma.LZMADecompressor
  seen=[]
  def decoder(*a,**kw):seen.append(kw);return original(*a,**kw)
  with patch.object(m.lzma,'LZMADecompressor',side_effect=decoder):Tests().exercise()
  self.assertEqual(len(seen),6)
  self.assertTrue(all(k=={'format':lzma.FORMAT_XZ,'memlimit':m.DECODER_MEMORY}for k in seen))
 def test_earlier_release_mutated_on_last_fetch(self):
  original=m.associate
  def wrapped(changes,root,end,run,paragraphs,check,fetch):
   calls=0
   def altered(*args):
    nonlocal calls
    calls+=1;data=fetch(*args)
    if calls==6:
     p=root/'lists'/'archive.ubuntu.com_ubuntu_dists_noble_InRelease'
     p.write_bytes(p.read_bytes()+b'changed')
    return data
   return original(changes,root,end,run,paragraphs,check,altered)
  with patch.object(m,'associate',side_effect=wrapped):
   with self.assertRaisesRegex(AssertionError,'INDEX_RELEASE_CHANGED'):Tests().exercise()
 def test_same_bytes_replaced_release_refused(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d)/'InRelease';p.write_bytes(b'x')
   raw,identity=m.release_snapshot(p)
   q=p.with_name('replacement');q.write_bytes(raw);q.replace(p)
   with self.assertRaisesRegex(AssertionError,'INDEX_RELEASE_CHANGED'):m.unchanged_releases([(p,raw,identity)])
if __name__=='__main__':unittest.main()
