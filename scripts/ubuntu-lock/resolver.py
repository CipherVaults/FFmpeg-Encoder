"""One-shot official Ubuntu metadata and simulation only. No package installation."""
import pathlib,os,sys,re,json,hashlib,subprocess,tempfile,time,signal
ROOT=pathlib.Path(__file__).resolve().parent
PARENT='6eccc9e573db1e9caf4f103058758577142bc40b'
ROOTS=['gcc','g++','make','binutils','libc6-dev','linux-libc-dev','pkgconf','cmake','meson','ninja-build','nasm','python3','patch','tar','xz-utils','gzip','coreutils','dash','findutils','sed','grep','gawk','dpkg-dev']
CAP=8*1024**2

def sha(b):return hashlib.sha256(b).hexdigest()
def authority(env,event):
 assert re.fullmatch('[a-f0-9]{40}',PARENT),'UNBOUND'
 assert env.get('GITHUB_REPOSITORY')=='CipherVaults/FFmpeg-Encoder-Blue-Linux' and env.get('GITHUB_REF')=='refs/heads/blue/linux-development'
 assert env.get('GITHUB_EVENT_NAME')=='push' and env.get('GITHUB_RUN_ATTEMPT')=='1'
 assert event['before']==PARENT and event['after']==env['GITHUB_SHA'] and re.fullmatch('[a-f0-9]{40}',env['GITHUB_SHA'])
 assert all(event.get(k) is False for k in ['forced','created','deleted'])
def paragraphs(text):
 rows=[]
 for block in text.split('\n\n'):
  row={};key=None
  for line in block.splitlines():
   if line.startswith((' ','\t')) and key:row[key]+='\n'+line
   elif ': ' in line:key,value=line.split(': ',1);assert key not in row;row[key]=value
  if row:rows.append(row)
 return rows

def transaction(text,installed):
 rows=[]
 for line in text.splitlines():
  assert not line.startswith(('Remv ','Purg ')),'REMOVAL_REFUSED'
  if not line.startswith('Inst '):continue
  m=re.fullmatch(r'Inst ([a-z0-9+.-]+)(?::amd64)?(?: \[([^]]+)\])? \((\S+) .+\)',line);assert m,'TRANSACTION_PARSE'
  name,prior,version=m.groups();assert name not in installed and prior is None,'INSTALLED_CHANGE_REQUIRES_REVIEW'
  rows.append({'package':name,'version':version})
 assert len(rows)<=1000 and len({r['package']for r in rows})==len(rows)
 return rows

def config(root):
 # APT_CONFIG is read before default config directories; redirect every mutable
 # state and hook/preferences location before apt reads those defaults.
 dirs=['lists/partial','archives/partial','empty-conf','empty-parts','empty-preferences']
 for d in dirs:(root/d).mkdir(parents=True,exist_ok=False)
 for f in ['empty-main','preferences','extended_states']:(root/f).write_text('')
 sources='\n'.join('deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://'+host+'/ubuntu '+suite+' main universe' for suite,host in [('noble','archive.ubuntu.com'),('noble-updates','archive.ubuntu.com'),('noble-security','security.ubuntu.com')])+'\n'
 (root/'sources.list').write_text(sources)
 settings={'Dir::Etc::main':str(root/'empty-main'),'Dir::Etc::parts':str(root/'empty-conf'),'Dir::Etc::sourcelist':str(root/'sources.list'),'Dir::Etc::sourceparts':str(root/'empty-parts'),'Dir::Etc::preferences':str(root/'preferences'),'Dir::Etc::preferencesparts':str(root/'empty-preferences'),'Dir::State::status':str(root/'status'),'Dir::State::lists':str(root/'lists'),'Dir::State::extended_states':str(root/'extended_states'),'Dir::Cache::archives':str(root/'archives'),'Dir::Cache::pkgcache':'','Dir::Cache::srcpkgcache':'','APT::Architecture':'amd64','APT::Install-Recommends':'false','APT::Install-Suggests':'false','Acquire::https::AllowRedirect':'false','Acquire::http::AllowRedirect':'false','Acquire::AllowInsecureRepositories':'false','Acquire::AllowDowngradeToInsecureRepositories':'false','Acquire::Check-Valid-Until':'true','Acquire::Languages':'none','Acquire::Retries':'0','Acquire::https::Timeout':'20','Dir::Log':str(root/'logs'),'APT::Get::List-Cleanup':'false'}
 text='\n'.join(k+' "'+v+'";'for k,v in settings.items())+'\n#clear DPkg::Pre-Invoke;\n#clear DPkg::Post-Invoke;\n#clear DPkg::Pre-Install-Pkgs;\n#clear APT::Update::Pre-Invoke;\n#clear APT::Update::Post-Invoke;\n#clear APT::Update::Post-Invoke-Success;\n'
 (root/'apt.conf').write_text(text);return text

def proc_identity(pid):
 try:
  text=pathlib.Path('/proc/'+str(pid)+'/stat').read_text();f=text[text.rfind(')')+2:].split()
  return (pid,int(f[19]),int(f[2]),int(f[3]))
 except (FileNotFoundError,ProcessLookupError):return None

def owned_signal(p,identity,sig):
 if identity is None or proc_identity(p.pid)!=identity or identity[2:]!=(p.pid,p.pid):raise BoundFailure('OWNERSHIP_UNCONFIRMED')
 os.killpg(p.pid,sig)

class BoundFailure(RuntimeError):pass
class ChildFailure(RuntimeError):pass

def live_group(pid):
 rows=[]
 for entry in pathlib.Path('/proc').iterdir():
  if not entry.name.isdigit():continue
  try:
   text=(entry/'stat').read_text();f=text[text.rfind(')')+2:].split()
  except (FileNotFoundError,ProcessLookupError):continue
  if int(f[2])==pid and f[0]!='Z':rows.append(int(entry.name))
 return rows

def require_owner(p,identity):
 if identity is None or identity[2:]!=(p.pid,p.pid) or proc_identity(p.pid)!=identity:
  raise BoundFailure('OWNERSHIP_UNCONFIRMED')

def close_owned(p,identity):
 # Keep the unreaped leader as the process-group ownership anchor even when
 # it exited before a helper. Never signal after losing that identity.
 require_owner(p,identity)
 for sig,seconds in [(signal.SIGTERM,5),(signal.SIGKILL,3)]:
  if not live_group(p.pid):break
  owned_signal(p,identity,sig)
  until=time.monotonic()+seconds
  while time.monotonic()<until and live_group(p.pid):time.sleep(.1)
 require_owner(p,identity)
 if live_group(p.pid):raise BoundFailure('GROUP_CLOSURE_UNCONFIRMED')
 p.wait(timeout=1)

def monitor(p,identity,root,end,out,err):
 while True:
  require_owner(p,identity)
  if os.waitid(os.P_PID,p.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT) is not None:return
  if time.monotonic()>end or out.tell()>CAP or err.tell()>CAP:raise BoundFailure('PROCESS_BOUND')
  total=sum(x.stat().st_size for x in root.rglob('*')if x.is_file())
  if total>2*1024**3:raise BoundFailure('STORAGE_BOUND')
  time.sleep(.1)


def run(argv,root,end):
 if time.monotonic()>=end:raise BoundFailure('DEADLINE')
 assert argv[0] in ['/usr/bin/apt-get','/usr/bin/apt-cache','/usr/bin/dpkg-query','/usr/bin/gpgv']
 logs=root/'logs';logs.mkdir(exist_ok=True);assert not logs.is_symlink()
 token=str(time.monotonic_ns())
 with (logs/(token+'.stdout')).open('xb+')as out,(logs/(token+'.stderr')).open('xb+')as err:
  p=subprocess.Popen(argv,stdout=out,stderr=err,env={'PATH':'/usr/bin:/bin','LC_ALL':'C','HOME':str(root),'APT_CONFIG':str(root/'apt.conf')},start_new_session=True)
  identity=None;failed=None;cleanup=None
  try:
   identity=proc_identity(p.pid)
   monitor(p,identity,root,end,out,err)
  except BaseException as e:failed=e
  finally:
   try:close_owned(p,identity)
   except BaseException as e:cleanup=e
  if failed:
   if cleanup is not None:failed.cleanupFailureType=type(cleanup).__name__
   raise failed
  if cleanup is not None:raise cleanup
  if time.monotonic()>=end:raise BoundFailure('DEADLINE')
  if sum(x.stat().st_size for x in root.rglob('*')if x.is_file())>2*1024**3:raise BoundFailure('STORAGE_BOUND')
  out.seek(0);err.seek(0);a=out.read(CAP+1);b=err.read(CAP+1);
  if len(a)>CAP or len(b)>CAP:raise BoundFailure('LOG_BOUND')
  
  if p.returncode!=0:raise ChildFailure('CHILD_FAILED')
  return a,b

def baseline(records):
 names=[r['Package']for r in records]
 assert len(names)==len(set(names)),'MULTIARCH_OR_DUPLICATE_PACKAGE'
 assert all(r['Architecture']in ['amd64','all']for r in records),'FOREIGN_ARCHITECTURE'
 return {r['Package']:r for r in records}

def retain_mapping(installed,changes,root,end,result):
 # Publish incremental evidence before acquisition. Fatal bounds propagate and
 # stop work, but must not discard an already parsed transaction or exact rows.
 result['transaction']=changes
 result['authenticatedCandidateRecords']=[]
 result['dependencyClosure']='incomplete conservative-installed-plus-transaction-superset; provider graph and tool payload integrity still require review'
 requested={n:r['Version']for n,r in installed.items()}
 requested.update({r['package']:r['version']for r in changes})
 mapped=result['authenticatedCandidateRecords']
 for name,version in sorted(requested.items()):
  try:
   data,_=run(['/usr/bin/apt-cache','show','--no-all-versions',name+'='+version],root,end);records=paragraphs(data.decode());matches=[r for r in records if r.get('Package')==name and r.get('Version')==version and r.get('Architecture')in ['amd64','all'] and re.fullmatch('[a-f0-9]{64}',r.get('SHA256',''))]
   assert len(matches)==1;r=matches[0];filename=r['Filename'];assert filename.startswith('pool/') and '..'not in filename.split('/')
   mapped.append({k:r[k]for k in ['Package','Version','Architecture','Filename','Size','SHA256']})
  except (ChildFailure,AssertionError,KeyError,ValueError):result['unresolved'].append({'package':name,'version':version,'reason':'EXACT_SIGNED_METADATA_UNRESOLVED'})
 result['mappingCompleted']=True

def main():
 assert sys.argv[1:]==['--resolve-once'];eventPath=pathlib.Path(os.environ['GITHUB_EVENT_PATH']);assert eventPath.stat().st_size<1024**2;authority(os.environ,json.loads(eventPath.read_text()))
 assert 'ID=ubuntu' in pathlib.Path('/etc/os-release').read_text() and 'VERSION_ID="24.04"' in pathlib.Path('/etc/os-release').read_text()
 root=pathlib.Path(tempfile.mkdtemp(prefix='ubuntu-lock-',dir=os.environ['RUNNER_TEMP']));end=time.monotonic()+1200
 result={'schema':'ubuntu-lock-candidate/v1','ready':False,'head':os.environ['GITHUB_SHA'],'scope':'metadata-and-simulation-only','unresolved':[]}
 try:
  status=pathlib.Path('/var/lib/dpkg/status').read_bytes();assert len(status)<=32*1024**2;(root/'status').write_bytes(status);config(root)
  installedRecords=[r for r in paragraphs(status.decode())if r.get('Status')=='install ok installed']
  installed=baseline(installedRecords);assert len(installed)<10000
  query,_=run(['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\t${Status}\n'],root,end)
  queried={line.split('\t')[0]:line.split('\t')[1:] for line in query.decode().splitlines()if line.endswith('\tinstall ok installed')}
  assert queried=={n:[r['Version'],r['Architecture'],r['Status']]for n,r in installed.items()},'BASELINE_SET_MISMATCH'
  result['baselineStatusSha256']=sha(status);result['baselineInstalledCount']=len(installed)
  result['toolIdentities']={p:sha(pathlib.Path(p).resolve().read_bytes())for p in ['/usr/bin/apt-get','/usr/bin/apt-cache','/usr/bin/gpgv','/usr/share/keyrings/ubuntu-archive-keyring.gpg']}
  run(['/usr/bin/apt-get','update','--error-on=any'],root,end)
  releases=[]
  for p in sorted((root/'lists').glob('*InRelease')):
   run(['/usr/bin/gpgv','--keyring','/usr/share/keyrings/ubuntu-archive-keyring.gpg',str(p)],root,end);text=p.read_text();assert 'Codename: noble' in text
   releases.append({'sha256':sha(p.read_bytes()),'dateFields':[l for l in text.splitlines()if l.startswith(('Date:','Valid-Until:','Suite:','Codename:'))]})
  assert len(releases)==3;result['signedReleases']=releases
  simulated,_=run(['/usr/bin/apt-get','-s','--no-install-recommends','install',*ROOTS],root,end);changes=transaction(simulated.decode(),installed)
  retain_mapping(installed,changes,root,end,result)
  result['status']='candidate-for-review'
  assert pathlib.Path('/var/lib/dpkg/status').read_bytes()==status
 except Exception as e:
  result.update(status='blocked',failureType=type(e).__name__)
  if hasattr(e,'cleanupFailureType'):result['cleanupFailureType']=e.cleanupFailureType
 result['ready']=False
 (ROOT/'lock-report.json').write_text(json.dumps(result,indent=2)+'\n')
 return 0 if result.get('status')=='candidate-for-review' else 2
if __name__=='__main__':raise SystemExit(main())
