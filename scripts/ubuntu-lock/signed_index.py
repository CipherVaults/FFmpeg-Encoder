"""Metadata-only exact tuple association. Never admits a transaction or installs."""
import hashlib,lzma,pathlib,re,urllib.request,time,os,stat
RELEASE_CAP=1024**2
INDEX_CAP=64*1024**2
TOTAL_CAP=192*1024**2
DECODE_CAP=256*1024**2
DECODER_MEMORY=64*1024**2
READ_CHUNK=64*1024
ORIGINS=(('noble','archive.ubuntu.com'),('noble-updates','archive.ubuntu.com'),('noble-security','security.ubuntu.com'))
def sha(b):return hashlib.sha256(b).hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise AssertionError('INDEX_REDIRECT')
def fetch(url,cap,end,check_time):
 assert any(url.startswith('https://'+host+'/ubuntu/dists/'+suite+'/')for suite,host in ORIGINS)
 check_time(end);remaining=end-time.monotonic();assert remaining>0,'INDEX_DEADLINE'
 with urllib.request.build_opener(NoRedirect()).open(url,timeout=min(20,remaining))as response:
  assert response.url==url
  data=bytearray();sock=response.fp.raw._sock
  while True:
   check_time(end)
   remaining=end-time.monotonic();assert remaining>0,'INDEX_DEADLINE'
   if response.isclosed():break
   sock.settimeout(min(20,remaining))
   # read1 performs at most one underlying read, rather than waiting to fill
   # a large requested body while a peer drip-feeds before socket inactivity.
   block=response.read1(min(READ_CHUNK,cap+1-len(data)))
   check_time(end)
   if not block:break
   data.extend(block);assert len(data)<=cap,'INDEX_BOUND'
  check_time(end)
 return bytes(data)
def release_snapshot(path):
 assert path.parent.resolve()==path.parent and path.resolve()==path
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1 and before.st_size<=RELEASE_CAP
  raw=bytearray()
  while True:
   b=os.read(fd,min(65536,RELEASE_CAP+1-len(raw)))
   if not b:break
   raw.extend(b);assert len(raw)<=RELEASE_CAP
  after=os.fstat(fd);named=path.lstat()
  stamp=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns,x.st_nlink)
  assert stamp(before)==stamp(after)==stamp(named),'INDEX_RELEASE_CHANGED'
  return bytes(raw),stamp(before)
 finally:os.close(fd)
def unchanged_releases(snapshots):
 for path,raw,identity in snapshots:
  current,stamp=release_snapshot(path)
  assert stamp==identity and current==raw,'INDEX_RELEASE_CHANGED'
def token(row):
 name,version,arch=row['package'],row['proposedVersion'],row['proposedArchitecture']
 assert re.fullmatch('[a-z0-9][a-z0-9+.-]{0,95}',name)
 assert len(version)<=128 and re.fullmatch('[0-9][A-Za-z0-9.+:~\\-]*',version)
 assert arch in ('amd64','all')
 return name,version,arch
def release_checks(raw,suite):
 assert len(raw)<=RELEASE_CAP
 text=raw.decode('utf-8')
 assert text.startswith('-----BEGIN PGP SIGNED MESSAGE-----\n') and '\n-----BEGIN PGP SIGNATURE-----'in text
 body=text.split('\n\n',1)[1].split('\n-----BEGIN PGP SIGNATURE-----',1)[0]
 # Cleartext dash escaping is irrelevant to these closed fields; refuse ambiguity.
 lines=body.splitlines();assert lines.count('Suite: '+suite)==1 and lines.count('Codename: noble')==1
 assert sum(x.startswith('Suite:')for x in lines)==1 and sum(x.startswith('Codename:')for x in lines)==1
 assert lines.count('SHA256:')==1
 checks={};active=False
 for line in lines:
  if line=='SHA256:':active=True;continue
  if active:
   if not line.startswith(' '):break
   m=re.fullmatch(r' ([a-f0-9]{64}) +([1-9][0-9]*) +([^\s]+)',line);assert m,'INDEX_RELEASE_ROW'
   digest,size,name=m.groups();assert name not in checks,'INDEX_DUPLICATE_PATH'
   checks[name]=(digest,int(size))
 return checks
def associate(changes,root,end,run,paragraphs,check_time,fetch_index=fetch):
 """Main-only adapters: run retains existing bounded gpgv ownership; no supplied auth boolean."""
 assert 1<=len(changes)<=32
 requested=[token(x)for x in changes];assert len(set(requested))==len(requested)
 matches={k:None for k in requested};origins={k:[]for k in requested};total=0;snapshots=[]
 for suite,host in ORIGINS:
  check_time(end)
  # Exact allowlisted APT list name, no ambiguous glob or cache-origin text.
  p=root/'lists'/(host+'_ubuntu_dists_'+suite+'_InRelease')
  raw,identity=release_snapshot(p);snapshots.append((p,raw,identity))
  run(['/usr/bin/gpgv','--keyring','/usr/share/keyrings/ubuntu-archive-keyring.gpg',str(p)],root,end)
  unchanged_releases(snapshots)
  checks=release_checks(raw,suite)
  for component in ('main','universe'):
   check_time(end);relative=component+'/binary-amd64/Packages.xz';assert relative in checks,'INDEX_NOT_SIGNED'
   digest,size=checks[relative];assert 0<size<=INDEX_CAP and total+size<=TOTAL_CAP,'INDEX_BOUND'
   unchanged_releases(snapshots)
   compressed=fetch_index('https://'+host+'/ubuntu/dists/'+suite+'/'+relative,size,end,check_time);total+=len(compressed)
   unchanged_releases(snapshots)
   check_time(end);assert len(compressed)==size and sha(compressed)==digest,'INDEX_IDENTITY'
   decoder=lzma.LZMADecompressor(format=lzma.FORMAT_XZ,memlimit=DECODER_MEMORY);plain=decoder.decompress(compressed,max_length=DECODE_CAP+1)
   assert len(plain)<=DECODE_CAP and decoder.eof and not decoder.unused_data,'INDEX_EXPANSION'
   seen=set()
   for row in paragraphs(plain.decode('utf-8')):
    key=(row.get('Package'),row.get('Version'),row.get('Architecture'))
    if key not in matches:continue
    assert key not in seen,'INDEX_DUPLICATE_TUPLE';seen.add(key)
    filename=row.get('Filename','');size_text=row.get('Size','');archive_sha=row.get('SHA256','')
    assert re.fullmatch(r'pool/[A-Za-z0-9+._~/-]+',filename) and all(x not in ('','..','.')for x in filename.split('/')),'INDEX_ARCHIVE_PATH'
    assert re.fullmatch('[1-9][0-9]{0,18}',size_text) and int(size_text)<=2**53-1 and re.fullmatch('[a-f0-9]{64}',archive_sha),'INDEX_ARCHIVE_IDENTITY'
    source=row.get('Source',key[0])
    assert len(source)<=256 and re.fullmatch(r'[a-z0-9][a-z0-9+.-]*(?: \([0-9][A-Za-z0-9.+:~\-]*\))?',source),'INDEX_SOURCE'
    value={'package':key[0],'version':key[1],'architecture':key[2],'filename':filename,'bytes':int(size_text),'sha256':archive_sha,'source':source}
    assert matches[key] is None or matches[key]==value,'INDEX_CONFLICT'
    matches[key]=value;origins[key].append({'suite':suite,'component':component,'host':host,'inReleaseSha256':sha(raw),'indexPath':relative,'indexBytes':size,'indexSha256':digest})
   check_time(end)
 unchanged_releases(snapshots);check_time(end)
 return {'schema':1,'ready':False,'scope':'repository-correspondence-only-not-installed-integrity-or-change-approval',
  'complete':all(matches.values()),'records':[{'requested':dict(zip(('package','version','architecture'),k)),'archive':matches[k],'origins':origins[k]}for k in requested],
  'compressedBytes':total,'representation':'signed-original-Packages.xz; local APT transformed lists deliberately not compared'}
