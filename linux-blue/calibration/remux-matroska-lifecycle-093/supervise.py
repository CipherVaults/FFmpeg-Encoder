import os,sys,json,time,stat,hashlib,subprocess,signal
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SCOPE='current092-private-matroska-lifecycle093'
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def limits():
 st=os.statvfs(ROOT);assert st.f_bavail*st.f_frsize>=27*1024**3
 total=0
 owned=ROOT/'owned-attempt1'
 if owned.exists():
  for p in owned.rglob('*'):
   s=p.lstat();assert not stat.S_ISLNK(s.st_mode)
   assert s.st_uid==os.getuid()
   if stat.S_ISREG(s.st_mode):total+=s.st_size
   else:assert stat.S_ISDIR(s.st_mode)
 assert total<=512*1024**2
 for n in ['RUN.stdout','RUN.stderr']:
  p=ROOT/n
  if p.exists():assert p.stat().st_size<=8*1024**2
 return total
def group_rows(group):
 rows=[]
 for f in Path('/proc').iterdir():
  if not f.name.isdigit():continue
  try:
   if f.stat().st_uid!=os.getuid():continue
   v=(f/'stat').read_text();fields=v[v.rfind(')')+2:].split()
   if int(fields[2])==group and int(fields[3])==group:
    rows.append({'pid':int(f.name),'startTicks':int(fields[19]),'state':fields[0]})
  except (FileNotFoundError,ProcessLookupError):continue
 return rows

def leader_identity(pid):
 f=Path('/proc')/str(pid);assert f.stat().st_uid==os.getuid()
 text=(f/'stat').read_text();v=text[text.rfind(')')+2:].split()
 assert int(v[2])==pid and int(v[3])==pid,'Leader session/group changed'
 return (pid,int(v[19]))

def require_owner(identity):
 assert identity is not None and leader_identity(identity[0])==identity,'Leader identity unavailable/changed'

def exited_unreaped(pid):
 return os.waitid(os.P_PID,pid,os.WEXITED|os.WNOHANG|os.WNOWAIT) is not None

def loader_guard():
 assert not os.environ.get('NODE_OPTIONS') and not any(v for k,v in os.environ.items()if k.startswith('LD_'))
 for name in ['ELECTRON_RUN_AS_NODE','ELECTRON_FORCE_IS_PACKAGED','ELECTRON_DISABLE_SANDBOX']:
  assert name not in os.environ,'Electron execution override refused'

def write_once(name,value):
 with (ROOT/name).open('x')as f:json.dump(value,f,indent=2);f.write('\n')

def main():
 assert sys.argv[1:]==['--execute-reviewed-once']
 assert sys.platform=='linux' and os.uname().machine=='x86_64'
 loader_guard()
 gate=json.loads((ROOT/'LEAD_RELEASE.json').read_text())
 assert gate['scope']==SCOPE and gate['approved'] is True and gate['independentReviewApproved'] is True and gate['preservationVerified'] is True
 assert gate['supervisorSha256']==digest(Path(__file__).resolve())
 for key in ['reviewReceipt','preservationReceipt']:
  pin=gate[key];assert digest(Path(pin['path']))==pin['sha256']
 binding=json.loads((ROOT/'BINDING.json').read_text())
 assert digest(ROOT/'BINDING.json')==gate['binding']['sha256']
 node=Path(binding['node']['path']);assert digest(node)==binding['node']['sha256']
 assert digest(ROOT/'runner.cjs')==binding['helpers']['runner.cjs']['sha256']
 assert not (ROOT/'owned-attempt1').exists() and not (ROOT/'ATTEMPT_STARTED.json').exists()
 limits()
 write_once('OUTER_STARTED.json',{'scope':SCOPE,'atUtc':time.time()})
 result={'scope':SCOPE,'status':'starting','sampledOnly':True,'terminationRequested':False,'errors':[]};proc=None;owner=None;observed={};started=time.monotonic()
 try:
  with (ROOT/'RUN.stdout').open('xb')as out,(ROOT/'RUN.stderr').open('xb')as err:
   proc=subprocess.Popen([str(node),str(ROOT/'runner.cjs'),'--execute-reviewed-once'],cwd=str(ROOT),stdout=out,stderr=err,start_new_session=True)
   result['leaderPid']=proc.pid;owner=leader_identity(proc.pid)
   result['leaderIdentity']=owner
   while not exited_unreaped(proc.pid):
    require_owner(owner)
    for r in group_rows(proc.pid):observed[(r['pid'],r['startTicks'])]=r
    limits();assert time.monotonic()-started<600,'Acquisition outer lifetime exceeded600seconds'
    time.sleep(.5)
   require_owner(owner)
   result['leaderExitObservedUnreaped']=True
 except BaseException as e:result['errors'].append({'phase':'execution','type':type(e).__name__,'message':str(e)[:1000]})
 finally:
  if proc is not None:
   try:
    require_owner(owner)
    live=[r for r in group_rows(proc.pid)if r['state']!='Z']
    if live:
     result['terminationRequested']=True
     for sig,seconds in [(signal.SIGTERM,5),(signal.SIGKILL,3)]:
      require_owner(owner)
      if not [r for r in group_rows(proc.pid)if r['state']!='Z']:break
      os.killpg(proc.pid,sig)
      until=time.monotonic()+seconds
      while time.monotonic()<until and [r for r in group_rows(proc.pid)if r['state']!='Z']:time.sleep(.1)
    require_owner(owner)
    result['remainingGroupRows']=group_rows(proc.pid)
    result['closureObserved']=not any(r['state']!='Z'for r in result['remainingGroupRows'])
    if result['closureObserved']:
     proc.wait(timeout=1) # Reap only after identity-bound group closure.
     result['exitCode']=proc.returncode
     if proc.returncode!=0:result['errors'].append({'phase':'exit','message':'Acquisition exited nonzero'})
   except BaseException as e:
    result['closureObserved']=False
    result['errors'].append({'phase':'closure-unverifiable','type':type(e).__name__,'message':str(e)[:1000]})
  for phase,fn in [('storage',limits)]:
   try:result[phase+'Verified']=fn()
   except BaseException as e:result['errors'].append({'phase':phase,'type':type(e).__name__,'message':str(e)[:1000]})
  result['sampledIdentities']=list(observed.values());result['elapsedSeconds']=time.monotonic()-started
  result['status']='closed-awaiting-evidence-audit'if not result['errors'] and result.get('closureObserved') and not result['terminationRequested'] else 'failed-or-terminated-retained'
  write_once('CLOSURE.json',result)
 if result['status']!='closed-awaiting-evidence-audit':raise SystemExit(1)
if __name__=='__main__':main()
