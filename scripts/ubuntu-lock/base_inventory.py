"""Unbound metadata-only reader. No extraction, network or executable invocation."""
if not __debug__:
 raise RuntimeError("OPTIMIZED_PYTHON_REFUSED")
import hashlib,io,json,os,pathlib,re,stat,tarfile,time,zlib,importlib.util
BINDING=None  # Real use requires a separately reviewed immutable signature receipt binding.
COMPRESSED_CAP=64*1024**2
EXPANDED_CAP=512*1024**2
STATUS_CAP=8*1024**2
MEMBER_CAP=100000
TUPLE_CAP=2000
PARSER_SHA='35aa1cf927fae5573e43f8c2fcb419819c9cc03c4f6176f9e61e72d3a74ee798'

def digest(b):return hashlib.sha256(b).hexdigest()
def stamp(s):return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink,s.st_uid)
def open_owned(path,cap):
 p=pathlib.Path(path);assert p.is_absolute() and p.resolve(strict=True)==p,'NONCANONICAL_PATH'
 parents=[(q,stamp(q.lstat())) for q in p.parents]
 before=p.lstat()
 assert stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1 and 0<before.st_size<=cap,'FILE_BOUND_OR_TYPE'
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and 0<s.st_size<=cap,'FILE_BOUND_OR_TYPE'
  assert stamp(before)==stamp(s)==stamp(p.lstat()),'FILE_CHANGED'
  for q,old in parents:assert stamp(q.lstat())==old,'PARENT_CHANGED'
  return fd,p,stamp(s),parents
 except BaseException:os.close(fd);raise

def unchanged(handle):
 fd,p,s,parents=handle
 assert stamp(os.fstat(fd))==s==stamp(p.lstat()),'FILE_CHANGED'
 assert p.resolve(strict=True)==p,'NONCANONICAL_PATH'
 for q,old in parents:assert stamp(q.lstat())==old,'PARENT_CHANGED'

def read_owned(path,cap):
 h=open_owned(path,cap)
 try:
  b=os.read(h[0],cap+1);assert len(b)==h[2][2] and not os.read(h[0],1),'FILE_CHANGED';unchanged(h);return b
 finally:os.close(h[0])

def load_paragraphs(path):
 # Reuse the exact frozen parser source; no app/media code is invoked.
 raw=read_owned(path,128*1024);assert digest(raw)==PARSER_SHA,'PARSER_IDENTITY'
 namespace={'__name__':'base_inventory_frozen_parser','__file__':str(path)}
 exec(compile(raw,str(path),'exec'),namespace)
 return namespace['paragraphs']

class GzipStream:
 def __init__(self,fd,end):
  self.fd=fd;self.end=end;self.z=zlib.decompressobj(16+zlib.MAX_WBITS);self.pending=b'';self.buffer=bytearray();self.total=0;self.compressed=0;self.hash=hashlib.sha256();self.done=False
 def check(self):assert time.monotonic()<self.end,'DEADLINE'
 def pump(self):
  self.check()
  if self.done:return
  if not self.pending:
   chunk=os.read(self.fd,65536)
   assert chunk,'GZIP_TRUNCATED'
   self.compressed+=len(chunk);assert self.compressed<=COMPRESSED_CAP,'COMPRESSED_BOUND';self.hash.update(chunk);self.pending=chunk
  out=self.z.decompress(self.pending,65536);self.pending=self.z.unconsumed_tail
  self.total+=len(out);assert self.total<=EXPANDED_CAP,'EXPANDED_BOUND';self.buffer.extend(out)
  if self.z.eof:
   # Exactly one gzip member. Concatenated streams and trailing bytes refused.
   assert not self.z.unused_data and not self.pending and not os.read(self.fd,1),'GZIP_TRAILING_OR_CONCATENATED'
   self.done=True
 def read(self,n):
  assert 0<=n<=65536
  while len(self.buffer)<n and not self.done:self.pump()
  self.check();b=bytes(self.buffer[:n]);del self.buffer[:n];return b
 def exact(self,n):
  b=self.read(n);assert len(b)==n,'TAR_TRUNCATED';return b
 def skip(self,n):
  while n:n-=len(self.exact(min(n,65536)))

def valid_version(value):
 if not isinstance(value,str) or not 1<=len(value)<=128:return False
 if ':' in value:
  epoch,value=value.split(':',1)
  if not re.fullmatch('[0-9]+',epoch):return False
 if '-' in value:
  upstream,revision=value.rsplit('-',1)
  if not re.fullmatch('[A-Za-z0-9+.~]+',revision):return False
 else:upstream=value
 return re.fullmatch(r'[0-9][A-Za-z0-9.+~\-]*',upstream) is not None

def inspect_unverified(path,expected,paragraphs,seconds=60):
 """Pure metadata inspection; pins are identity, NOT signature authentication."""
 assert set(expected)=={'bytes','sha256'} and type(expected['bytes'])is int and 0<expected['bytes']<=COMPRESSED_CAP
 assert re.fullmatch('[a-f0-9]{64}',expected['sha256'])
 assert 0<seconds<=60
 end=time.monotonic()+seconds;h=open_owned(path,COMPRESSED_CAP)
 try:
  assert h[2][2]==expected['bytes'],'ARCHIVE_SIZE'
  s=GzipStream(h[0],end);selected=None;seen=set();count=0
  while True:
   raw=s.exact(512)
   if raw==bytes(512):
    assert s.exact(512)==bytes(512),'TAR_END_MARKER'
    while True:
     b=s.read(65536)
     if not b:break
     assert not any(b),'TAR_TRAILING_DATA'
    break
   count+=1;assert count<=MEMBER_CAP,'MEMBER_BOUND'
   rawname=raw[:100].split(b'\0',1)[0];rawprefix=raw[345:500].split(b'\0',1)[0]
   assert not rawname.startswith(b'/') and not rawprefix.startswith(b'/'),'TAR_PATH'
   info=tarfile.TarInfo.frombuf(raw,'utf-8','strict')
   assert info.isdir() or not info.name.endswith('/'),'TAR_PATH'
   name=(info.name[2:] if info.name.startswith('./') else info.name).rstrip('/')
   if name in ('','.') and info.isdir():
    assert rawname in (b'.',b'./') and not rawprefix,'TAR_PATH'
    name='.'
   else:assert name and not name.startswith('/') and all(x not in ('','..','.') for x in name.rstrip('/').split('/')),'TAR_PATH'
   assert name not in seen,'DUPLICATE_MEMBER';seen.add(name)
   assert 0<=info.size<=EXPANDED_CAP,'MEMBER_SIZE'
   # Fail closed on PAX/GNU extensions rather than interpreting hidden overrides.
   assert info.type in (tarfile.REGTYPE,tarfile.AREGTYPE,tarfile.DIRTYPE,tarfile.SYMTYPE,tarfile.LNKTYPE),'TAR_EXTENSION_OR_SPECIAL'
   if not info.isreg():assert info.size==0,'NONREGULAR_PAYLOAD'
   if name in ('var','var/lib','var/lib/dpkg'):assert info.isdir(),'STATUS_ANCESTOR_TYPE'
   if name=='var/lib/dpkg/status':
    assert info.isreg() and 0<info.size<=STATUS_CAP,'STATUS_TYPE_OR_BOUND'
    chunks=[];left=info.size
    while left:
     b=s.exact(min(left,65536));chunks.append(b);left-=len(b)
    selected=b''.join(chunks)
   else:s.skip(info.size)
   s.skip((-info.size)%512)
  assert selected is not None,'STATUS_MISSING'
  assert s.hash.hexdigest()==expected['sha256'] and s.compressed==expected['bytes'],'ARCHIVE_DIGEST'
  unchanged(h);s.check()
  rows=paragraphs(selected.decode('utf-8'));assert 0<len(rows)<=TUPLE_CAP,'TUPLE_BOUND'
  tuples=set();projection=[]
  for r in rows:
   s.check();assert r.get('Status')=='install ok installed','STATUS_NOT_INSTALLED'
   assert re.fullmatch('[a-z0-9][a-z0-9+.-]{0,95}',r.get('Package','')),'PACKAGE'
   assert valid_version(r.get('Version')),'VERSION'
   assert r.get('Architecture')in ('amd64','all'),'ARCHITECTURE'
   assert r.get('Essential','no')in ('yes','no'),'ESSENTIAL'
   key=(r['Package'],r['Architecture']);assert key not in tuples,'DUPLICATE_TUPLE';tuples.add(key)
   projection.append({k:r[k] for k in ('Package','Version','Architecture','Essential','Pre-Depends','Depends','Provides','Multi-Arch') if k in r})
  unchanged(h);s.check()
  return {'ready':False,'authentication':'unverified identity-pinned archive; no signature claim','archive':expected,'statusSha256':digest(selected),'statusBytes':len(selected),'members':count,'expandedBytes':s.total,'packages':projection},selected
 finally:os.close(h[0])

def verify_recorded_prerequisite(binding):
 """Verify pinned evidence bytes, not a replacement for genuine gpgv acquisition."""
 assert set(binding)=={'receiptPath','receiptSha256','artifacts','signerFingerprint'},'PREREQUISITE_SCHEMA'
 raw=read_owned(binding['receiptPath'],65536)
 assert digest(raw)==binding['receiptSha256'],'RECEIPT_IDENTITY'
 receipt=json.loads(raw)
 assert set(receipt)=={'schema','exitCode','signerFingerprint','artifacts'},'RECEIPT_SCHEMA'
 assert receipt['schema']=='ubuntu-base-signature-prerequisite/v1'
 assert type(receipt['exitCode'])is int and receipt['exitCode']==0,'SIGNATURE_RECEIPT_FAILURE'
 assert re.fullmatch('[A-F0-9]{40,64}',binding['signerFingerprint'])
 assert receipt['signerFingerprint']==binding['signerFingerprint'],'SIGNER_IDENTITY'
 assert receipt['artifacts']==binding['artifacts'],'PREREQUISITE_PINS'
 assert set(binding['artifacts'])=={'checksumManifest','detachedSignature','keyring','verifier'},'PREREQUISITE_ARTIFACTS'
 for pin in binding['artifacts'].values():
  assert set(pin)=={'path','bytes','sha256'}
  b=read_owned(pin['path'],16*1024**2)
  assert len(b)==pin['bytes'] and digest(b)==pin['sha256'],'PREREQUISITE_ARTIFACT_IDENTITY'
 return {'receiptSha256':digest(raw),'signerFingerprint':binding['signerFingerprint'],
  'authentication':'recorded signature prerequisite identities verified; signature not reexecuted here',
  'ready':False}

def inspect_bound():
 # No authentication boolean or caller-selected receipt can activate this module.
 assert BINDING is not None,'UNBOUND_SIGNATURE_PREREQUISITE'
 verify_recorded_prerequisite(BINDING)
 raise AssertionError('BOUND_ADAPTER_REQUIRES_SEPARATE_REVIEW')
if __name__=='__main__':inspect_bound()
