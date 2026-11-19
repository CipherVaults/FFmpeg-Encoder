import unittest,tempfile,pathlib,io,tarfile,gzip,hashlib,json,os,subprocess,sys
from unittest.mock import patch
import base_inventory as m
PARSER=pathlib.Path(__file__).resolve().parent/'resolver.py'
STATUS=b'Package: dash\nStatus: install ok installed\nVersion: 1:0.5.12-6ubuntu5\nArchitecture: amd64\nEssential: yes\nDepends: libc6 (>= 2.34)\n\n'
def archive(entries):
 b=io.BytesIO()
 with tarfile.open(fileobj=b,mode='w',format=tarfile.USTAR_FORMAT)as t:
  for name,data,typ in entries:
   x=tarfile.TarInfo(name);x.type=typ;x.size=len(data);t.addfile(x,io.BytesIO(data))
 return gzip.compress(b.getvalue())
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.parser=m.load_paragraphs(PARSER)
 def tearDown(self):self.tmp.cleanup()
 def check(self,b):
  p=self.root/'archive.gz';p.write_bytes(b);return m.inspect_unverified(p,{'bytes':len(b),'sha256':m.digest(b)},self.parser)
 def good(self,status=STATUS):return archive([('var/lib/dpkg/status',status,tarfile.REGTYPE)])
 def test_optimized_python_refused(self):
  p=subprocess.run([sys.executable,'-O','-c','import base_inventory'],cwd=pathlib.Path(__file__).parent,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,timeout=5)
  self.assertNotEqual(p.returncode,0);self.assertIn(b'OPTIMIZED_PYTHON_REFUSED',p.stderr)
 def test_fifo_refused_before_open(self):
  p=self.root/'fifo';os.mkfifo(p)
  with patch.object(m.os,'open',side_effect=AssertionError('MUST_NOT_OPEN')),self.assertRaisesRegex(AssertionError,'FILE_BOUND_OR_TYPE'):m.open_owned(p,100)
 def test_raced_fifo_nonblocking_refusal(self):
  p=self.root/'file';p.write_bytes(b'x');real_open=os.open
  def swap(path,flags):
   self.assertTrue(flags&os.O_NONBLOCK);p.unlink();os.mkfifo(p);return real_open(path,flags)
  with patch.object(m.os,'open',side_effect=swap),self.assertRaisesRegex(AssertionError,'FILE_BOUND_OR_TYPE'):m.open_owned(p,100)
 def test_version_grammar(self):
  for v in ['1::garbage','1.2-','x:1.2','1.2-abc-','1.2\\bad']:
   with self.subTest(version=v):self.assertFalse(m.valid_version(v))
  for v in ['1:0.5.12-6ubuntu5','2.39-0ubuntu8.12','1.2~rc1','1.0-git-2','0:1.2+3']:
   with self.subTest(version=v):self.assertTrue(m.valid_version(v))
 def test_archived_ancestor_both_orders(self):
  for ancestor in ['var','var/lib','var/lib/dpkg']:
   for reverse in [False,True]:
    entries=[(ancestor,b'',tarfile.SYMTYPE),('var/lib/dpkg/status',STATUS,tarfile.REGTYPE)]
    if reverse:entries.reverse()
    with self.subTest(ancestor=ancestor,reverse=reverse),self.assertRaisesRegex(AssertionError,'STATUS_ANCESTOR_TYPE'):self.check(archive(entries))
 def test_nonregular_payload(self):
  with self.assertRaisesRegex(AssertionError,'NONREGULAR_PAYLOAD'):self.check(archive([('other',b'x',tarfile.DIRTYPE)]))
 def test_regular_trailing_slash_refused(self):
  with self.assertRaisesRegex(AssertionError,'TAR_PATH'):self.check(archive([('var/lib/dpkg/status/',STATUS,tarfile.REGTYPE)]))
 def test_absolute_root_and_prefix_refused(self):
  for name in ['/', '//', '/var/lib/dpkg/status']:
   with self.subTest(name=name),self.assertRaisesRegex(AssertionError,'TAR_PATH'):self.check(archive([(name,b'',tarfile.DIRTYPE)]))
 def test_regular_inventory_unverified(self):
  r,b=self.check(self.good());self.assertFalse(r['ready']);self.assertIn('unverified',r['authentication']);self.assertEqual(b,STATUS);self.assertEqual(r['packages'][0]['Essential'],'yes')
 def test_root_directory_header(self):
  r,_=self.check(archive([('./',b'',tarfile.DIRTYPE),('var/lib/dpkg/status',STATUS,tarfile.REGTYPE)]));self.assertEqual(r['members'],2)
 def test_sparse_extension_refused(self):
  with self.assertRaisesRegex(AssertionError,'TAR_EXTENSION'):self.check(archive([('var/lib/dpkg/status',b'',tarfile.GNUTYPE_SPARSE)]))
 def test_no_auth_boolean_or_unbound_activation(self):
  with self.assertRaisesRegex(AssertionError,'UNBOUND'):m.inspect_bound()
 def test_missing(self):
  with self.assertRaisesRegex(AssertionError,'STATUS_MISSING'):self.check(archive([('other',b'hi',tarfile.REGTYPE)]))
 def test_duplicate(self):
  with self.assertRaisesRegex(AssertionError,'DUPLICATE'):self.check(archive([('var/lib/dpkg/status',STATUS,tarfile.REGTYPE),('./var/lib/dpkg/status',STATUS,tarfile.REGTYPE)]))
 def test_selected_link(self):
  with self.assertRaisesRegex(AssertionError,'STATUS_TYPE'):self.check(archive([('var/lib/dpkg/status',b'',tarfile.SYMTYPE)]))
 def test_unselected_link_not_followed(self):
  r,_=self.check(archive([('lib',b'',tarfile.SYMTYPE),('var/lib/dpkg/status',STATUS,tarfile.REGTYPE)]));self.assertEqual(r['members'],2)
 def test_traversal(self):
  with self.assertRaisesRegex(AssertionError,'TAR_PATH'):self.check(archive([('../x',b'',tarfile.REGTYPE)]))
 def test_concatenated_and_trailing(self):
  for tail in [gzip.compress(b'x'),b'garbage']:
   with self.subTest(tail=tail),self.assertRaisesRegex(AssertionError,'GZIP_TRAILING'):self.check(self.good()+tail)
 def test_truncated_gzip(self):
  with self.assertRaisesRegex(AssertionError,'GZIP_TRUNCATED'):self.check(self.good()[:-4])
 def test_tar_trailing(self):
  raw=gzip.decompress(self.good());
  with self.assertRaisesRegex(AssertionError,'TAR_TRAILING'):self.check(gzip.compress(raw+b'notzero'))
 def test_expansion_cap(self):
  with patch.object(m,'EXPANDED_CAP',1024),self.assertRaisesRegex(AssertionError,'EXPANDED_BOUND'):self.check(self.good())
 def test_member_cap(self):
  with patch.object(m,'MEMBER_CAP',0),self.assertRaisesRegex(AssertionError,'MEMBER_BOUND'):self.check(self.good())
 def test_status_bound(self):
  with patch.object(m,'STATUS_CAP',1),self.assertRaisesRegex(AssertionError,'STATUS_TYPE'):self.check(self.good())
 def test_duplicate_fields(self):
  with self.assertRaisesRegex(AssertionError,'DUPLICATE_FIELD'):self.check(self.good(STATUS.replace(b'Package: dash',b'Package: dash\nPackage: bash')))
 def test_foreign_arch(self):
  with self.assertRaisesRegex(AssertionError,'ARCHITECTURE'):self.check(self.good(STATUS.replace(b'amd64',b'arm64')))
 def test_duplicate_tuple(self):
  with self.assertRaisesRegex(AssertionError,'DUPLICATE_TUPLE'):self.check(self.good(STATUS+STATUS))
 def test_not_installed(self):
  with self.assertRaisesRegex(AssertionError,'STATUS_NOT_INSTALLED'):self.check(self.good(STATUS.replace(b'install ok installed',b'deinstall ok config-files')))
 def test_symlink_input(self):
  p=self.root/'data';p.write_bytes(self.good());q=self.root/'link';q.symlink_to(p)
  with self.assertRaisesRegex(AssertionError,'NONCANONICAL'):m.inspect_unverified(q,{'bytes':p.stat().st_size,'sha256':m.digest(p.read_bytes())},self.parser)
 def test_digest_mismatch(self):
  p=self.root/'data';p.write_bytes(self.good())
  with self.assertRaisesRegex(AssertionError,'ARCHIVE_DIGEST'):m.inspect_unverified(p,{'bytes':p.stat().st_size,'sha256':'0'*64},self.parser)
 def test_expired_finalization(self):
  def late(text):
   result=self.parser(text);mock.return_value=1000;return result
  p=self.root/'data';p.write_bytes(self.good())
  with patch.object(m.time,'monotonic',return_value=1)as mock,self.assertRaisesRegex(AssertionError,'DEADLINE'):
   m.inspect_unverified(p,{'bytes':p.stat().st_size,'sha256':m.digest(p.read_bytes())},late)
 def test_mutation_finalization(self):
  def mutate(text):
   out=self.parser(text);os.utime(self.root/'archive.gz',ns=(1,1));return out
  b=self.good();p=self.root/'archive.gz';p.write_bytes(b)
  with self.assertRaisesRegex(AssertionError,'FILE_CHANGED'):m.inspect_unverified(p,{'bytes':len(b),'sha256':m.digest(b)},mutate)
 def test_receipt_pins_not_auth_boolean(self):
  artifacts={}
  for name in ['checksumManifest','detachedSignature','keyring','verifier']:
   p=self.root/name;p.write_bytes(name.encode());artifacts[name]={'path':str(p),'bytes':len(name),'sha256':m.digest(name.encode())}
  p=self.root/'receipt';r={'schema':'ubuntu-base-signature-prerequisite/v1','exitCode':0,'signerFingerprint':'A'*40,'artifacts':artifacts};p.write_text(json.dumps(r));binding={'receiptPath':str(p),'receiptSha256':m.digest(p.read_bytes()),'artifacts':artifacts,'signerFingerprint':'A'*40}
  result=m.verify_recorded_prerequisite(binding);self.assertFalse(result['ready']);self.assertIn('not reexecuted',result['authentication'])
  (self.root/'keyring').write_bytes(b'bad')
  with self.assertRaisesRegex(AssertionError,'ARTIFACT_IDENTITY'):m.verify_recorded_prerequisite(binding)
if __name__=='__main__':unittest.main()
