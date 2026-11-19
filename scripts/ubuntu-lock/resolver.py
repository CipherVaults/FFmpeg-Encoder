"""One-shot official Ubuntu metadata and simulation only. No package installation."""
import pathlib,os,sys,re,json,hashlib,subprocess,tempfile,time,signal,stat
from contextlib import contextmanager
ROOT=pathlib.Path(__file__).resolve().parent
PARENT='7ddb7bfd3b3448ec7918085eaf406ab02556f1cd'
ROOTS=['gcc','g++','make','binutils','libc6-dev','linux-libc-dev','pkgconf','cmake','meson','ninja-build','nasm','python3','patch','tar','xz-utils','gzip','coreutils','dash','findutils','sed','grep','gawk','dpkg-dev']
CAP=8*1024**2
STATUS_CAP=32*1024**2
LIVE_DB=pathlib.Path('/var/lib/dpkg')

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
  row={};key=None;seen=set()
  for line in block.splitlines():
   if not line:
    if row:rows.append(row)
    row={};key=None;seen=set();continue
   if line.startswith((' ','\t')):
    assert key is not None,'ORPHAN_CONTINUATION'
    row[key]+='\n'+line
   else:
    key,separator,value=line.partition(':')
    assert separator and re.fullmatch(r'[!-9;-~]+',key) and not key.startswith(('#','-')),'CONTROL_HEADER'
    assert key.lower() not in seen,'DUPLICATE_FIELD'
    seen.add(key.lower());row[key]=value.lstrip(' \t')
  if row:rows.append(row)
 return rows

def _transaction(text,installed,result=None,*,review_changes=None):
 # APT pkgSimulate emits intermediate ShortBreaks, not a terminal lock verdict.
 # Accept only its exact finite package-list form; independently require complete
 # successful configuration, including a final configuration with no suffix.
 assert len(text.encode())<=CAP,'LOG_BOUND'
 rows=[];installed_rows={};installed_arches={};configured=set();suffix_count=0;last_suffix=None
 name=r'[a-z0-9][a-z0-9+.-]*'
 token=name+r'(?::(?:amd64|all))?'
 version=r'[0-9][A-Za-z0-9.+:~\-]*'
 pattern=re.compile(r'(Inst|Conf) ('+name+r')(?::(?:amd64|all))?(?: \[([^]\r\n]+)\])? \(('+version+r') ([A-Za-z0-9][A-Za-z0-9.+:~/,= _\-]* \[(?:amd64|all)\])\)( \[(?:'+token+r' )*\])?')
 for line in text.splitlines():
  assert not line.startswith(('Remv ','Purg ')),'REMOVAL_REFUSED'
  if not line.startswith(('Inst','Conf')):continue
  m=pattern.fullmatch(line) if len(line)<=4096 and line.isascii() and not any(ord(c)<32 or ord(c)==127 for c in line) else None
  if m is None:
   if result is not None:
    result['transactionParseObservation']={'schema':1,'lineBytes':len(line.encode()),
     'lineSha256':sha(line.encode()),'asciiOnly':line.isascii(),
     'endsWithCandidateClose':line.endswith(')'),
     'candidateCloseThenBracket':bool(re.search(r'\) \[[^\r\n]*\]$',line)),
     'containsControl':any(ord(c)<32 or ord(c)==127 for c in line)}
   raise AssertionError('TRANSACTION_PARSE')
  kind,pkg,prior,ver,origin,suffix=m.groups()
  assert len(pkg)<=96 and len(ver)<=128,'TRANSACTION_TOKEN_BOUND'
  assert prior is None or (len(prior)<=128 and re.fullmatch(version,prior)),'TRANSACTION_TOKEN_BOUND'
  arch=re.search(r'\[(amd64|all)\]$',origin).group(1)
  explicit_arch=re.match(r'(?:Inst|Conf) [^ :]+:(amd64|all)(?: |$)',line)
  assert explicit_arch is None or explicit_arch.group(1)==arch,'FOREIGN_ARCHITECTURE'
  if suffix is not None:
   suffix_tokens=suffix[2:-1].split()
   assert len(suffix_tokens)<=100 and all(len(t)<=102 for t in suffix_tokens),'TRANSACTION_SUFFIX_BOUND'
   assert len(set(suffix_tokens))==len(suffix_tokens),'TRANSACTION_SUFFIX_DUPLICATE'
   assert 'on' not in suffix_tokens,'TRANSACTION_SUFFIX_RELATION'
   suffix_count+=1
  if kind=='Inst':
   if pkg in installed or prior is not None:
    assert review_changes is not None,'INSTALLED_CHANGE_REQUIRES_REVIEW'
    base=installed.get(pkg)
    if base is not None:
     assert type(base.get('Version'))is str and len(base['Version'])<=128 and re.fullmatch(version,base['Version']),'TRANSACTION_TOKEN_BOUND'
     assert base.get('Architecture')in ['amd64','all'],'FOREIGN_ARCHITECTURE'
    review_changes.append({'package':pkg,'baselineVersion':base['Version'] if base is not None else None,
     'baselineArchitecture':base['Architecture'] if base is not None else None,'simulatedPriorVersion':prior,
     'proposedVersion':ver,'proposedArchitecture':arch,'baselinePresent':base is not None,
     'priorMatchesBaseline':None if prior is None or base is None else prior==base['Version'],
     'architectureMatchesBaseline':None if base is None else arch==base['Architecture'],
     'authenticatedCandidateAssociation':'unresolved','associationReason':'EXACT_AUTHENTICATED_INDEX_LINKAGE_NOT_ACQUIRED'})
    assert len(review_changes)<=32,'INSTALLED_REVIEW_BOUND'
   assert pkg not in installed_rows,'TRANSACTION_DUPLICATE'
   installed_rows[pkg]=ver;installed_arches[pkg]=arch;rows.append({'package':pkg,'version':ver})
   assert len(rows)<=1000,'TRANSACTION_COUNT'
  else:
   assert prior is None and pkg in installed_rows,'CONFIGURATION_UNKNOWN'
   assert pkg not in configured,'CONFIGURATION_DUPLICATE'
   assert ver==installed_rows[pkg],'CONFIGURATION_VERSION'
   assert arch==installed_arches[pkg],'FOREIGN_ARCHITECTURE'
   configured.add(pkg);last_suffix=suffix
 assert rows and configured==set(installed_rows),'CONFIGURATION_INCOMPLETE'
 assert last_suffix is None,'CONFIGURATION_FINAL_BREAKS'
 if result is not None:
  result['transactionCompletion']={'installed':len(rows),'configured':len(configured),
   'intermediateSuffixes':suffix_count,'finalConfigurationWithoutBreaks':True}
 return rows


def transaction(text,installed,result=None):
 # Admission remains unchanged: a review projection cannot return accepted rows.
 return _transaction(text,installed,result)

def observe_installed_changes(text,installed):
 # Same grammar and terminal configuration obligations, evidence only. Never
 # expose a partial prefix as a complete transaction or an accepted candidate.
 observation={'schema':1,'reviewOnly':True,'ready':False,'complete':False,
  'simulationSha256':sha(text.encode()),'simulationExitCode':0,
  'authenticatedCandidateAssociation':'unresolved'}
 changes=[];completion={}
 try:
  rows=_transaction(text,installed,completion,review_changes=changes)
  observation.update(complete=True,transactionCompletion=completion['transactionCompletion'],
   installedChangeCount=len(changes),changes=changes)
  assert len(json.dumps(observation,indent=2).encode())<=16*1024,'INSTALLED_REVIEW_BOUND'
 except AssertionError as error:
  reason=error.args[0] if len(error.args)==1 else None
  # No raw error or line. Failure never leaves a partial changes list behind.
  observation={'schema':1,'reviewOnly':True,'ready':False,'complete':False,
   'simulationSha256':sha(text.encode()),'simulationExitCode':0,
   'authenticatedCandidateAssociation':'unresolved',
   'reason':reason if reason in DIAGNOSTIC_REASONS else 'UNCLASSIFIED_FAILURE'}
 return observation

def transaction_with_review(text,installed,result):
 try:return transaction(text,installed,result)
 except AssertionError as error:
  if error.args==('INSTALLED_CHANGE_REQUIRES_REVIEW',):
   result['installedChangeReview']=observe_installed_changes(text,installed)
  raise

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


UPDATE_MARKERS={
 'NAME_RESOLUTION_MARKER':(b"Temporary failure resolving '",b"Could not resolve '"),
 'TLS_CERTIFICATE_MARKER':(b'Certificate verification failed:',),
 'HASH_MISMATCH_MARKER':(b'Hash Sum mismatch',),
 'SIGNATURE_ERROR_MARKER':(b'Signature error',)
}

def child_failure(argv,code,out,err):
 error=ChildFailure('CHILD_FAILED')
 if argv!=['/usr/bin/apt-get','update','--error-on=any']:return error
 assert type(code)is int and code!=0
 if len(out)>CAP or len(err)>CAP:raise BoundFailure('LOG_BOUND')
 # Complete bounded streams only; marker presence is not a root-cause verdict.
 classes=sorted(k for k,needles in UPDATE_MARKERS.items() if any(n in out or n in err for n in needles))
 error.metadataUpdateObservation={'schema':1,'exitCode':code,
  'stdoutBytes':len(out),'stderrBytes':len(err),'stdoutSha256':sha(out),'stderrSha256':sha(err),
  'observedMarkerClasses':classes or ['UNCLASSIFIED'],'completeBoundedStreams':True}
 return error


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
  
  if p.returncode!=0:raise child_failure(argv,p.returncode,a,b)
  return a,b

def baseline(records):
 names=[r['Package']for r in records]
 assert len(names)==len(set(names)),'MULTIARCH_OR_DUPLICATE_PACKAGE'
 assert all(r['Architecture']in ['amd64','all']for r in records),'FOREIGN_ARCHITECTURE'
 return {r['Package']:r for r in records}

def compare_baseline(query,installed,result):
 # Non-installed rows may lack version/architecture. Do not admit them or
 # normalize installed fields. Diagnostic samples contain only bounded package/version tokens.
 queried={}
 assert len(query)<=CAP,'LOG_BOUND'
 for line in query.decode().removesuffix('\n').split('\n') if query else []:
  fields=line.split('\t')
  assert len(fields)==4,'BASELINE_QUERY_ROW'
  name,version,arch,status=fields
  assert re.fullmatch(r'[a-z0-9][a-z0-9+.-]*',name),'BASELINE_QUERY_NAME'
  assert re.fullmatch(r'(unknown|install|hold|deinstall|purge) (ok|reinstreq) (not-installed|config-files|half-installed|unpacked|half-configured|triggers-awaited|triggers-pending|installed)',status),'BASELINE_QUERY_STATUS'
  if status!='install ok installed':continue
  assert version and not any(c.isspace() for c in version),'BASELINE_QUERY_VERSION'
  assert arch in ['amd64','all'],'BASELINE_QUERY_ARCHITECTURE'
  assert name not in queried,'BASELINE_QUERY_DUPLICATE'
  queried[name]=[version,arch,status]
  assert len(queried)<10000,'BASELINE_QUERY_COUNT'
 expected={n:[r['Version'],r['Architecture'],r['Status']]for n,r in installed.items()}
 if queried!=expected:
  common=queried.keys()&expected.keys()
  result['baselineDifferences']={
   'missingFromQuery':len(expected.keys()-queried.keys()),
   'extraInQuery':len(queried.keys()-expected.keys()),
   'versionMismatch':sum(queried[n][0]!=expected[n][0]for n in common),
   'architectureMismatch':sum(queried[n][1]!=expected[n][1]for n in common)
  }
  # Observation only: exact equality below remains authoritative. Never use
  # a serialization hypothesis to admit different baseline values.
  mismatches=sorted(n for n in common if queried[n][0]!=expected[n][0])
  samples=[]
  for name in mismatches[:8]:
   raw,live=expected[name][0],queried[name][0]
   safe=(len(name)<=96 and re.fullmatch(r'[a-z0-9][a-z0-9+.-]*',name)
     and all(len(v)<=128 and re.fullmatch(r'[0-9][A-Za-z0-9.+:~\-]*',v) for v in [raw,live]))
   if safe:
    samples.append({'package':name,'rawStatusVersion':raw,'queryVersion':live,
     'explicitZeroEpochOnly':raw=='0:'+live or live=='0:'+raw})
   else:samples.append({'omitted':'UNSAFE_OR_OVERLONG_TOKEN'})
  result['baselineVersionMismatchSample']={'limit':8,'rows':samples,
   'truncated':len(mismatches)>8,'semantics':'diagnostic-only-exact-equality-still-required'}
  raise AssertionError('BASELINE_SET_MISMATCH')


def db_identity(st):
 return st.st_dev,st.st_ino,st.st_mode,st.st_size,st.st_mtime_ns,st.st_ctime_ns

def read_status(path):
 assert path.resolve(strict=True)==path,'BASELINE_STATUS_UNSAFE'
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as stream:
  before=os.fstat(stream.fileno())
  assert stat.S_ISREG(before.st_mode),'BASELINE_STATUS_UNSAFE'
  assert before.st_size<=STATUS_CAP,'BASELINE_STATUS_BOUND'
  data=stream.read(STATUS_CAP+1)
  assert len(data)<=STATUS_CAP,'BASELINE_STATUS_BOUND'
  after=os.fstat(stream.fileno())
  assert db_identity(before)==db_identity(after)==db_identity(path.lstat()) and len(data)==after.st_size,'BASELINE_STATUS_CHANGED'
 return data

def require_empty_updates(result):
 path=LIVE_DB/'updates'
 assert path.resolve(strict=True)==path,'BASELINE_UPDATES_UNSAFE'
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd)
  with os.scandir(fd) as rows:
   if next(rows,None) is not None:
    # A lower bound, not a scan or disclosure of pending entry names.
    result['pendingUpdateEntriesAtLeast']=1
    raise AssertionError('BASELINE_UPDATES_PENDING')
  assert db_identity(before)==db_identity(os.fstat(fd))==db_identity(path.lstat()),'BASELINE_UPDATES_CHANGED'
 finally:os.close(fd)

def require_stable_baseline(root,status,result):
 require_empty_updates(result)
 assert read_status(LIVE_DB/'status')==status,'BASELINE_STATUS_CHANGED'
 assert read_status(root/'status')==status,'BASELINE_COPY_CHANGED'
 require_empty_updates(result)

def query_live_baseline(root,status,result,end):
 require_stable_baseline(root,status,result)
 # run() supplies only its fixed allowlisted environment, never DPKG_ROOT
 # or DPKG_ADMINDIR. Retain the full live read-only view as authority.
 query,_=run(['/usr/bin/dpkg-query','--admindir='+str(LIVE_DB),'-W','-f=${Package}\t${Version}\t${Architecture}\t${Status}\n'],root,end)
 require_stable_baseline(root,status,result)
 return query


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

# Diagnostics are closed enums, never exception text, environment or host data.
DIAGNOSTIC_STAGES=('BASELINE_COPY','CONFIGURE_ISOLATION','BASELINE_PARSE','BASELINE_VALIDATE','BASELINE_QUERY','BASELINE_COMPARE','TOOL_IDENTITIES','METADATA_UPDATE','RELEASE_AUTHENTICATION','TRANSACTION_SIMULATION','TRANSACTION_PARSE','CANDIDATE_MAPPING','FINAL_BASELINE_CHECK')
DIAGNOSTIC_REASONS=frozenset(('MULTIARCH_OR_DUPLICATE_PACKAGE','FOREIGN_ARCHITECTURE','BASELINE_SET_MISMATCH','BASELINE_STATUS_UNSAFE','BASELINE_STATUS_BOUND','BASELINE_STATUS_CHANGED','BASELINE_COPY_CHANGED','BASELINE_UPDATES_UNSAFE','BASELINE_UPDATES_PENDING','BASELINE_UPDATES_CHANGED','BASELINE_QUERY_ROW','BASELINE_QUERY_NAME','BASELINE_QUERY_STATUS','BASELINE_QUERY_VERSION','BASELINE_QUERY_ARCHITECTURE','BASELINE_QUERY_DUPLICATE','BASELINE_QUERY_COUNT','REMOVAL_REFUSED','TRANSACTION_PARSE','TRANSACTION_TOKEN_BOUND','TRANSACTION_SUFFIX_BOUND','TRANSACTION_SUFFIX_DUPLICATE','TRANSACTION_SUFFIX_RELATION','TRANSACTION_DUPLICATE','TRANSACTION_COUNT','CONFIGURATION_UNKNOWN','CONFIGURATION_DUPLICATE','CONFIGURATION_VERSION','CONFIGURATION_INCOMPLETE','CONFIGURATION_FINAL_BREAKS','INSTALLED_CHANGE_REQUIRES_REVIEW','INSTALLED_REVIEW_BOUND','OWNERSHIP_UNCONFIRMED','GROUP_CLOSURE_UNCONFIRMED','PROCESS_BOUND','STORAGE_BOUND','DEADLINE','LOG_BOUND','CHILD_FAILED'))
FAILURE_TYPES=frozenset(('AssertionError','BoundFailure','ChildFailure','KeyError','ValueError','UnicodeDecodeError','FileNotFoundError','PermissionError','OSError','TimeoutExpired'))

@contextmanager
def diagnostic_stage(result,name):
 assert name in DIAGNOSTIC_STAGES
 result['diagnosticStage']=name
 try:
  yield
 except BaseException:
  raise
 else:
  result.setdefault('completedDiagnosticStages',[]).append(name)

def record_failure(result,error):
 # Accept only exact known class names/reason constants. No repr/str fallback.
 kind=type(error).__name__
 reason=error.args[0] if len(error.args)==1 and type(error.args[0]) is str else None
 result.update(status='blocked',failureType=kind if kind in FAILURE_TYPES else 'OTHER_FAILURE',failureReason=reason if reason in DIAGNOSTIC_REASONS else 'UNCLASSIFIED_FAILURE')
 observation=getattr(error,'metadataUpdateObservation',None)
 if result.get('diagnosticStage')=='METADATA_UPDATE' and type(error)is ChildFailure and type(observation)is dict:
  keys={'schema','exitCode','stdoutBytes','stderrBytes','stdoutSha256','stderrSha256','observedMarkerClasses','completeBoundedStreams'}
  classes=observation.get('observedMarkerClasses')
  safe=(set(observation)==keys and observation.get('schema')==1 and observation.get('completeBoundedStreams')is True
   and type(observation.get('exitCode'))is int and -128<=observation['exitCode']<=255 and observation['exitCode']!=0
   and all(type(observation.get(k))is int and 0<=observation[k]<=CAP for k in ['stdoutBytes','stderrBytes'])
   and all(type(observation.get(k))is str and re.fullmatch('[a-f0-9]{64}',observation[k]) for k in ['stdoutSha256','stderrSha256'])
   and type(classes)is list and 1<=len(classes)<=len(UPDATE_MARKERS) and all(type(c)is str and c in set(UPDATE_MARKERS)|{'UNCLASSIFIED'} for c in classes)
   and len(set(classes))==len(classes) and ('UNCLASSIFIED'not in classes or classes==['UNCLASSIFIED']))
  if safe:result['metadataUpdateObservation']={**observation,'observedMarkerClasses':list(classes)}

 cleanup=getattr(error,'cleanupFailureType',None)
 if cleanup is not None:result['cleanupFailureType']=cleanup if type(cleanup) is str and cleanup in FAILURE_TYPES else 'OTHER_FAILURE'

def main():
 assert sys.argv[1:]==['--resolve-once'];eventPath=pathlib.Path(os.environ['GITHUB_EVENT_PATH']);assert eventPath.stat().st_size<1024**2;authority(os.environ,json.loads(eventPath.read_text()))
 assert 'ID=ubuntu' in pathlib.Path('/etc/os-release').read_text() and 'VERSION_ID="24.04"' in pathlib.Path('/etc/os-release').read_text()
 root=pathlib.Path(tempfile.mkdtemp(prefix='ubuntu-lock-',dir=os.environ['RUNNER_TEMP']));end=time.monotonic()+1200
 result={'schema':'ubuntu-lock-candidate/v1','ready':False,'head':os.environ['GITHUB_SHA'],'scope':'metadata-and-simulation-only','unresolved':[]}
 try:
  with diagnostic_stage(result,'BASELINE_COPY'):
   require_empty_updates(result)
   status=read_status(LIVE_DB/'status')
   with (root/'status').open('xb') as snapshot:snapshot.write(status)
   require_stable_baseline(root,status,result)
  with diagnostic_stage(result,'CONFIGURE_ISOLATION'):
   config(root)
  with diagnostic_stage(result,'BASELINE_PARSE'):
   installedRecords=[r for r in paragraphs(status.decode())if r.get('Status')=='install ok installed']
  with diagnostic_stage(result,'BASELINE_VALIDATE'):
   installed=baseline(installedRecords);assert len(installed)<10000
  with diagnostic_stage(result,'BASELINE_QUERY'):
   query=query_live_baseline(root,status,result,end)
  with diagnostic_stage(result,'BASELINE_COMPARE'):
   compare_baseline(query,installed,result)
   result['baselineStatusSha256']=sha(status);result['baselineInstalledCount']=len(installed)
  with diagnostic_stage(result,'TOOL_IDENTITIES'):
   result['toolIdentities']={p:sha(pathlib.Path(p).resolve().read_bytes())for p in ['/usr/bin/apt-get','/usr/bin/apt-cache','/usr/bin/gpgv','/usr/share/keyrings/ubuntu-archive-keyring.gpg']}
  with diagnostic_stage(result,'METADATA_UPDATE'):
   run(['/usr/bin/apt-get','update','--error-on=any'],root,end)
  with diagnostic_stage(result,'RELEASE_AUTHENTICATION'):
   releases=[]
   for p in sorted((root/'lists').glob('*InRelease')):
    run(['/usr/bin/gpgv','--keyring','/usr/share/keyrings/ubuntu-archive-keyring.gpg',str(p)],root,end);text=p.read_text();assert 'Codename: noble' in text
    releases.append({'sha256':sha(p.read_bytes()),'dateFields':[l for l in text.splitlines()if l.startswith(('Date:','Valid-Until:','Suite:','Codename:'))]})
   assert len(releases)==3;result['signedReleases']=releases
  with diagnostic_stage(result,'TRANSACTION_SIMULATION'):
   simulated,_=run(['/usr/bin/apt-get','-s','--no-install-recommends','install',*ROOTS],root,end)
  with diagnostic_stage(result,'TRANSACTION_PARSE'):
   changes=transaction_with_review(simulated.decode(),installed,result)
  with diagnostic_stage(result,'CANDIDATE_MAPPING'):
   retain_mapping(installed,changes,root,end,result)
  with diagnostic_stage(result,'FINAL_BASELINE_CHECK'):
   compare_baseline(query_live_baseline(root,status,result,end),installed,result)
  result['status']='candidate-for-review'
 except Exception as e:
  record_failure(result,e)
 result['ready']=False
 (ROOT/'lock-report.json').write_text(json.dumps(result,indent=2)+'\n')
 return 0 if result.get('status')=='candidate-for-review' else 2
if __name__=='__main__':raise SystemExit(main())
