import unittest,unittest.mock as mock,importlib.util,pathlib,tempfile
p=pathlib.Path(__file__).with_name('resolver.py');s=importlib.util.spec_from_file_location('resolver',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_unbound(self):
  with self.assertRaises(AssertionError):m.authority({}, {})
 def test_bound(self):
  old=m.PARENT;m.PARENT='a'*40
  try:
   env={'GITHUB_REPOSITORY':'CipherVaults/FFmpeg-Encoder-Blue-Linux','GITHUB_REF':'refs/heads/blue/linux-development','GITHUB_EVENT_NAME':'push','GITHUB_RUN_ATTEMPT':'1','GITHUB_SHA':'b'*40};e={'before':m.PARENT,'after':env['GITHUB_SHA'],'forced':False,'created':False,'deleted':False};m.authority(env,e)
   for key in ['forced','created','deleted']:
    with self.assertRaises(AssertionError):m.authority(env,{**e,key:True})
  finally:m.PARENT=old
 def test_status_fields(self):
  r=m.paragraphs('Package: x\nVersion: 1\nStatus: install ok installed\nDepends: libc6\nProvides: y\n continuation\n')[0];self.assertEqual(r['Depends'],'libc6');self.assertIn('continuation',r['Provides'])
 def test_new(self):self.assertEqual(m.transaction('Inst cmake (1 noble [amd64])\nConf cmake (1 noble [amd64])\n',{}),[{'package':'cmake','version':'1'}])
 def test_upgrade(self):
  with self.assertRaises(AssertionError):m.transaction('Inst gcc [1] (2 noble [amd64])',{'gcc':{}})
 def test_remove(self):
  with self.assertRaises(AssertionError):m.transaction('Remv gcc [1]',{})
 def test_malformed(self):
  with self.assertRaises(AssertionError):m.transaction('Inst arbitrary malformed',{})
 def test_isolation(self):
  with tempfile.TemporaryDirectory()as d:
   t=m.config(pathlib.Path(d));self.assertIn('Dir::Etc::parts',t);self.assertIn('Dir::Etc::preferencesparts',t);self.assertIn('AllowRedirect "false"',t);self.assertIn('#clear APT::Update::Post-Invoke',t);self.assertNotIn('trusted=yes',(pathlib.Path(d)/'sources.list').read_text())
 def test_no_install(self):
  text=p.read_text()
  self.assertIn("'/usr/bin/apt-get','-s'",text);self.assertNotIn('sudo',text);self.assertNotIn('shell=True',text)
class Bounds(unittest.TestCase):
 def test_expired_prevents_spawn(self):
  with tempfile.TemporaryDirectory()as d,mock.patch.object(m.subprocess,'Popen')as spawn:
   with self.assertRaises(m.BoundFailure):m.run(['/usr/bin/apt-cache'],pathlib.Path(d),0)
   spawn.assert_not_called()
 def test_reused_identity_no_signal(self):
  p=type('P',(),{'pid':123})()
  with mock.patch.object(m,'proc_identity',return_value=(123,99,123,123)),mock.patch.object(m.os,'killpg')as kill:
   with self.assertRaises(m.BoundFailure):m.owned_signal(p,(123,1,123,123),15)
   kill.assert_not_called()
 def test_multiarch_refuses(self):
  with self.assertRaises(AssertionError):m.baseline([{'Package':'x','Architecture':'amd64'},{'Package':'x','Architecture':'i386'}])
 def test_foreign_refuses(self):
  with self.assertRaises(AssertionError):m.baseline([{'Package':'x','Architecture':'i386'}])
 def test_owned_logs_and_fatal_errors(self):
  text=p.read_text();self.assertIn("logs=root/'logs'",text);self.assertNotIn('TemporaryFile()',text);self.assertNotIn('except Exception:result',text);self.assertIn('os.WNOWAIT',text);self.assertNotIn('p.poll()',text)
class Lifecycle(unittest.TestCase):
 def test_normal_monitor_sleeps(self):
  child=mock.Mock(pid=123);stream=mock.Mock();stream.tell.return_value=0
  with tempfile.TemporaryDirectory()as d,mock.patch.object(m,'require_owner'),mock.patch.object(m.os,'waitid',side_effect=[None,object()]),mock.patch.object(m.time,'sleep')as sleep:
   m.monitor(child,(123,1,123,123),pathlib.Path(d),float('inf'),stream,stream)
   sleep.assert_called_once_with(.1)
 def test_exited_leader_lingering_helper_is_closed_before_reap(self):
  child=mock.Mock(pid=123);events=[]
  child.wait.side_effect=lambda **kw:events.append('reap')
  with mock.patch.object(m,'require_owner'),mock.patch.object(m,'live_group',side_effect=[[456],[],[],[]]),mock.patch.object(m,'owned_signal',side_effect=lambda *a:events.append('signal')):
   m.close_owned(child,(123,1,123,123))
  self.assertEqual(events,['signal','reap'])
 def test_reused_leader_does_not_reap_or_signal(self):
  child=mock.Mock(pid=123)
  with mock.patch.object(m,'proc_identity',return_value=(123,2,123,123)),mock.patch.object(m.os,'killpg')as kill:
   with self.assertRaises(m.BoundFailure):m.close_owned(child,(123,1,123,123))
   kill.assert_not_called();child.wait.assert_not_called()
 def test_primary_survives_cleanup_failure(self):
  child=mock.Mock(pid=123);primary=m.BoundFailure('PROCESS_BOUND')
  with tempfile.TemporaryDirectory()as d,mock.patch.object(m.subprocess,'Popen',return_value=child),mock.patch.object(m,'proc_identity',return_value=(123,1,123,123)),mock.patch.object(m,'monitor',side_effect=primary),mock.patch.object(m,'close_owned',side_effect=PermissionError('cleanup')):
   with self.assertRaises(m.BoundFailure)as caught:m.run(['/usr/bin/apt-cache'],pathlib.Path(d),float('inf'))
   self.assertIs(caught.exception,primary);self.assertEqual(caught.exception.cleanupFailureType,'PermissionError')
class PartialEvidence(unittest.TestCase):
 def test_fatal_bound_retains_transaction_and_prior_rows_and_stops(self):
  result={'ready':False,'unresolved':[]};changes=[{'package':'b','version':'2'},{'package':'c','version':'3'}]
  record=b'Package: a\nVersion: 1\nArchitecture: amd64\nFilename: pool/main/a/a.deb\nSize: 12\nSHA256: '+b'a'*64+b'\n'
  with mock.patch.object(m,'run',side_effect=[(record,b''),m.BoundFailure('DEADLINE')])as run:
   with self.assertRaises(m.BoundFailure):m.retain_mapping({'a':{'Version':'1'}},changes,pathlib.Path('/inert'),0,result)
   self.assertEqual(run.call_count,2)
  self.assertEqual(result['transaction'],changes)
  self.assertEqual([r['Package']for r in result['authenticatedCandidateRecords']],['a'])
  self.assertFalse(result['ready']);self.assertNotIn('mappingCompleted',result)
 def test_missing_version_does_not_discard_transaction(self):
  result={'ready':False,'unresolved':[]};changes=[{'package':'a','version':'1'}]
  with mock.patch.object(m,'run',return_value=(b'',b'')):
   m.retain_mapping({},changes,pathlib.Path('/inert'),0,result)
  self.assertEqual(result['transaction'],changes);self.assertEqual(len(result['unresolved']),1)
  self.assertTrue(result['mappingCompleted']);self.assertFalse(result['ready'])
class Diagnostics(unittest.TestCase):
 def test_closed_reason_and_type_no_payload(self):
  for error in [AssertionError('/private/secret'),ValueError('TOKEN=secret'),type('PrivateClassName', (Exception,), {})('secret')]:
   r={};error.cleanupFailureType='/private/cleanup';m.record_failure(r,error)
   self.assertEqual(r['failureReason'],'UNCLASSIFIED_FAILURE');self.assertIn(r['failureType'],m.FAILURE_TYPES|{'OTHER_FAILURE'});self.assertEqual(r['cleanupFailureType'],'OTHER_FAILURE');self.assertNotIn('secret',m.json.dumps(r));self.assertNotIn('PrivateClassName',m.json.dumps(r))
 def test_known_reason_primary_and_cleanup(self):
  e=m.BoundFailure('DEADLINE');e.cleanupFailureType='PermissionError';r={};m.record_failure(r,e)
  self.assertEqual(r,{'status':'blocked','failureType':'BoundFailure','failureReason':'DEADLINE','cleanupFailureType':'PermissionError'})
 def test_unknown_stage_refused_before_body(self):
  r={};called=False
  with self.assertRaises(AssertionError):
   with m.diagnostic_stage(r,'/private/secret'):called=True
  self.assertFalse(called);self.assertEqual(r,{})
 def test_stage_completion_and_partial_rows_survive_failure(self):
  r={'transaction':[{'package':'x','version':'1'}],'authenticatedCandidateRecords':[{'Package':'a'}]}
  with m.diagnostic_stage(r,'TRANSACTION_PARSE'):pass
  with self.assertRaises(m.BoundFailure)as caught:
   with m.diagnostic_stage(r,'CANDIDATE_MAPPING'):raise m.BoundFailure('DEADLINE')
  m.record_failure(r,caught.exception)
  self.assertEqual(r['completedDiagnosticStages'],['TRANSACTION_PARSE']);self.assertEqual(r['diagnosticStage'],'CANDIDATE_MAPPING');self.assertEqual(len(r['transaction']),1);self.assertEqual(len(r['authenticatedCandidateRecords']),1)
 def test_all_main_stage_failures_inert_and_bounded(self):
  original_bytes=pathlib.Path.read_bytes;original_text=pathlib.Path.read_text;real_stage=m.diagnostic_stage
  status=b'Package: x\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n\n'
  for target in m.DIAGNOSTIC_STAGES:
   with self.subTest(target=target),tempfile.TemporaryDirectory()as d:
    root=pathlib.Path(d);event=root/'event.json';event.write_text('{}');live=root/'fake-live-dpkg';live.mkdir();(live/'updates').mkdir()
    (live/'status').write_bytes(status)
    def readbytes(path,*a,**kw):
     if str(path)=='/var/lib/dpkg/status':return status
     if str(path).startswith('/usr/'):return b'inert tool identity'
     return original_bytes(path,*a,**kw)
    def readtext(path,*a,**kw):
     if str(path)=='/etc/os-release':return 'ID=ubuntu\nVERSION_ID="24.04"\n'
     return original_text(path,*a,**kw)
    def fake_run(argv,owned,end):
     if argv[0]=='/usr/bin/dpkg-query':return b'x\t1\tamd64\tinstall ok installed\n',b''
     if argv[:2]==['/usr/bin/apt-get','-s']:return b'Inst fresh-package (1 noble [amd64])\nConf fresh-package (1 noble [amd64])\n',b''
     if argv[:2]==['/usr/bin/apt-get','update']:
      for i in range(3):(owned/'lists'/f'{i}InRelease').write_text('Codename: noble\n')
     return b'',b''
    @m.contextmanager
    def injected(result,name):
     with real_stage(result,name):
      if name==target:raise AssertionError('private detail must not escape')
      yield
    with mock.patch.object(m,'ROOT',root),mock.patch.object(m,'LIVE_DB',live),mock.patch.dict(m.os.environ,{'GITHUB_EVENT_PATH':str(event),'RUNNER_TEMP':d,'GITHUB_SHA':'a'*40}),mock.patch.object(m.sys,'argv',['resolver','--resolve-once']),mock.patch.object(m,'authority'),mock.patch.object(pathlib.Path,'read_bytes',readbytes),mock.patch.object(pathlib.Path,'read_text',readtext),mock.patch.object(m,'run',side_effect=fake_run)as run,mock.patch.object(m,'diagnostic_stage',injected),mock.patch.object(m.subprocess,'Popen')as spawn:
     self.assertEqual(m.main(),2);spawn.assert_not_called()
    report=m.json.loads((root/'lock-report.json').read_text());self.assertEqual(report['diagnosticStage'],target);self.assertEqual(report.get('completedDiagnosticStages',[]),list(m.DIAGNOSTIC_STAGES[:m.DIAGNOSTIC_STAGES.index(target)]));self.assertEqual(report['failureReason'],'UNCLASSIFIED_FAILURE');self.assertFalse(report['ready']);self.assertNotIn('private detail',m.json.dumps(report));self.assertNotIn(d,m.json.dumps(report))
    if m.DIAGNOSTIC_STAGES.index(target)<m.DIAGNOSTIC_STAGES.index('METADATA_UPDATE'):self.assertFalse(any(c.args[0][:2]==['/usr/bin/apt-get','update'] for c in run.call_args_list))

class BaselineCompare(unittest.TestCase):
 def test_exact_with_noninstalled_blanks_and_epoch(self):
  installed={'alpha':{'Version':'2:1.0-2ubuntu3','Architecture':'amd64','Status':'install ok installed'},
             'data':{'Version':'4','Architecture':'all','Status':'install ok installed'}}
  result={}
  m.compare_baseline(b'data\t4\tall\tinstall ok installed\nother\t\t\tunknown ok not-installed\nalpha\t2:1.0-2ubuntu3\tamd64\tinstall ok installed\n',installed,result)
  self.assertEqual(result,{})
 def test_diffs_aggregate_and_bounded_inventory_sample(self):
  installed={n:{'Version':'1','Architecture':'amd64','Status':'install ok installed'}for n in ('secret-missing','secret-version','secret-arch','secret-hold')}
  q=b'secret-version\t2:secret-version\tamd64\tinstall ok installed\nsecret-extra\t1\tamd64\tinstall ok installed\nsecret-arch\t1\tall\tinstall ok installed\nsecret-hold\t1\tamd64\thold ok installed\n'
  result={}
  with self.assertRaisesRegex(AssertionError,'^BASELINE_SET_MISMATCH$'):m.compare_baseline(q,installed,result)
  self.assertEqual(result['baselineDifferences'],{'missingFromQuery':2,'extraInQuery':1,'versionMismatch':1,'architectureMismatch':1})
  self.assertEqual(result['baselineVersionMismatchSample']['rows'],[{'package':'secret-version','rawStatusVersion':'1','queryVersion':'2:secret-version','explicitZeroEpochOnly':False}])
  self.assertNotIn('secret-missing',m.json.dumps(result))
 def test_parse_failures_not_counts(self):
  row=b'alpha\t1\tamd64\tinstall ok installed\n'
  for q,reason in [
   (row+row,'DUPLICATE'),(b'alpha\tbad\tfield\tamd64\tinstall ok installed\n','ROW'),
   (row+b'\n','ROW'),(b'alpha:amd64\t1\tamd64\tinstall ok installed\n','NAME'),
   (b'alpha\t1\tamd64\tinstall ok installed\r\n','STATUS'),
   (b'alpha\t1\ti386\tinstall ok installed\n','ARCHITECTURE'),
   (b'alpha\t\tamd64\tinstall ok installed\n','VERSION')]:
   with self.subTest(reason=reason):
    result={}
    with self.assertRaisesRegex(AssertionError,'^BASELINE_QUERY_'+reason+'$'):m.compare_baseline(q,{},result)
    self.assertEqual(result,{})
 def test_query_count_and_byte_caps(self):
  result={}
  q=b''.join(('x%d\t1\tamd64\tinstall ok installed\n'%i).encode()for i in range(10000))
  with self.assertRaisesRegex(AssertionError,'^BASELINE_QUERY_COUNT$'):m.compare_baseline(q,{},result)
  with mock.patch.object(m,'CAP',1),self.assertRaisesRegex(AssertionError,'^LOG_BOUND$'):m.compare_baseline(q,{},result)
  self.assertEqual(result,{})
 def test_main_mismatch_never_reaches_apt(self):
  original_bytes=pathlib.Path.read_bytes;original_text=pathlib.Path.read_text
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);event=root/'event.json';event.write_text('{}');live=root/'fake-live-dpkg';live.mkdir();(live/'updates').mkdir()
   (live/'status').write_bytes(b'Package: redacted-a\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n\n')
   def readbytes(p,*a,**kw):
    if str(p)=='/var/lib/dpkg/status':return b'Package: redacted-a\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n\n'
    return original_bytes(p,*a,**kw)
   def readtext(p,*a,**kw):
    if str(p)=='/etc/os-release':return 'ID=ubuntu\nVERSION_ID="24.04"\n'
    return original_text(p,*a,**kw)
   with mock.patch.object(m,'ROOT',root),mock.patch.object(m,'LIVE_DB',live),mock.patch.dict(m.os.environ,{'GITHUB_EVENT_PATH':str(event),'RUNNER_TEMP':d,'GITHUB_SHA':'a'*40}),mock.patch.object(m.sys,'argv',['resolver','--resolve-once']),mock.patch.object(m,'authority'),mock.patch.object(pathlib.Path,'read_bytes',readbytes),mock.patch.object(pathlib.Path,'read_text',readtext),mock.patch.object(m,'run',return_value=(b'redacted-b\t1\tamd64\tinstall ok installed\n',b''))as run,mock.patch.object(m.subprocess,'Popen')as spawn:
    self.assertEqual(m.main(),2);spawn.assert_not_called();self.assertEqual([c.args[0][0] for c in run.call_args_list],['/usr/bin/dpkg-query'])
   report=(root/'lock-report.json').read_text();j=m.json.loads(report)
   self.assertFalse(j['ready']);self.assertEqual(j['failureReason'],'BASELINE_SET_MISMATCH')
   self.assertEqual(j['baselineDifferences'],{'missingFromQuery':1,'extraInQuery':1,'versionMismatch':0,'architectureMismatch':0})
   self.assertNotIn('redacted-',report)
 def test_malformed_utf8_not_serialized(self):
  r={}
  try:m.compare_baseline(b'\xffsecret',{},r)
  except UnicodeDecodeError as e:m.record_failure(r,e)
  self.assertEqual(r,{'status':'blocked','failureType':'UnicodeDecodeError','failureReason':'UNCLASSIFIED_FAILURE'})

class LiveBaseline(unittest.TestCase):
 def setUp(self):
  guard=tempfile.TemporaryDirectory();self.addCleanup(guard.cleanup)
  self.root=pathlib.Path(guard.name).resolve()
  self.live=self.root/'live';self.live.mkdir()
  self.snapshot=self.root/'owned';self.snapshot.mkdir()
  self.updates=self.live/'updates';self.updates.mkdir()
  self.status=b'baseline-status-bytes'
  for d in (self.live,self.snapshot):(d/'status').write_bytes(self.status)
  patcher=mock.patch.object(m,'LIVE_DB',self.live);patcher.start(); self.addCleanup(patcher.stop)
 def test_exact_admin_dir_and_equal_views(self):
  with mock.patch.dict(m.os.environ,{'DPKG_ADMINDIR':'/inert/other','DPKG_ROOT':'/inert/root'}),mock.patch.object(m,'run',return_value=(b'known',b''))as run:
   self.assertEqual(m.query_live_baseline(self.snapshot,self.status,{},0),b'known')
   argv=run.call_args.args[0]
   self.assertEqual(argv[:3],['/usr/bin/dpkg-query','--admindir='+str(self.live),'-W'])
  child=mock.Mock(pid=52,returncode=0)
  with mock.patch.dict(m.os.environ,{'DPKG_ADMINDIR':'/inert/other','DPKG_ROOT':'/inert/root'}),mock.patch.object(m.subprocess,'Popen',return_value=child)as spawn,mock.patch.object(m,'proc_identity'),mock.patch.object(m,'monitor'),mock.patch.object(m,'close_owned'):
   m.run(argv,self.snapshot,float('inf'))
   self.assertEqual(set(spawn.call_args.kwargs['env']),{'PATH','LC_ALL','HOME','APT_CONFIG'})
 def test_fragment_refuses_even_with_unchanged_status(self):
  (self.updates/'0000').write_text('inert fragment')
  r={}
  with mock.patch.object(m,'run')as run,self.assertRaisesRegex(AssertionError,'^BASELINE_UPDATES_PENDING$'):
   m.query_live_baseline(self.snapshot,self.status,r,0)
  run.assert_not_called()
  self.assertEqual(r,{'pendingUpdateEntriesAtLeast':1})
 def test_mid_query_mutation_refuses(self):
  for relative,reason in [('live/status','BASELINE_STATUS_CHANGED'),('owned/status','BASELINE_COPY_CHANGED'),('live/updates/0001','BASELINE_UPDATES_PENDING')]:
   with self.subTest(relative=relative):
    f=self.root/relative
    def run(*_):f.write_bytes(b'mutated');return b'unchanged query',b''
    with mock.patch.object(m,'run',side_effect=run),self.assertRaisesRegex(AssertionError,'^'+reason+'$'):
     m.query_live_baseline(self.snapshot,self.status,{},0)
    if f.parent==self.updates:f.unlink()
    else:f.write_bytes(self.status)
 def test_symlinked_updates_and_status_refused(self):
  self.updates.rmdir();self.updates.symlink_to(self.snapshot,target_is_directory=True)
  with self.assertRaisesRegex(AssertionError,'BASELINE_UPDATES_UNSAFE'):m.require_empty_updates({})
  f=self.live/'status';f.unlink();f.symlink_to(self.snapshot/'status')
  with self.assertRaisesRegex(AssertionError,'BASELINE_STATUS_UNSAFE'):m.read_status(f)
 def test_status_size_bound_and_unreadable_updates(self):
  with mock.patch.object(m,'STATUS_CAP',1),self.assertRaisesRegex(AssertionError,'BASELINE_STATUS_BOUND'):m.read_status(self.live/'status')
  with mock.patch.object(m.os,'scandir',side_effect=PermissionError),self.assertRaises(PermissionError):m.require_empty_updates({})

 def test_main_keeps_exact_final_live_tuple_gate(self):
  (self.live/'status').write_bytes(b'Package: alpha\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n\n')
  event=self.root/'event.json';event.write_text('{}')
  real_text=pathlib.Path.read_text; real_bytes=pathlib.Path.read_bytes
  def readtext(p,*a,**kw):
   if str(p)=='/etc/os-release':return 'ID=ubuntu\nVERSION_ID="24.04"\n'
   return real_text(p,*a,**kw)
  def readbytes(p,*a,**kw):
   if str(p).startswith('/usr/'):return b'inert tool identity'
   return real_bytes(p,*a,**kw)
  for final_ver,expected in [(b'1',0),(b'2',2)]:
   with self.subTest(final_ver=final_ver):
    seen=[]
    def fake_run(argv,root,end):
     if argv[0]=='/usr/bin/dpkg-query':
      seen.append(argv)
      ver=b'1' if len(seen)==1 else final_ver
      return (b'alpha\t'+ver+b'\tamd64\tinstall ok installed\n',b'')
     if argv[:2]==['/usr/bin/apt-get','-s']:return b'Inst fresh-package (1 noble [amd64])\nConf fresh-package (1 noble [amd64])\n',b''
     if argv[:2]==['/usr/bin/apt-get','update']:
      for i in range(3):(root/'lists'/f'inert{i}InRelease').write_text('Codename: noble\n')
     return b'',b''
    with mock.patch.object(m,'ROOT',self.root),mock.patch.dict(m.os.environ,{'GITHUB_EVENT_PATH':str(event),'RUNNER_TEMP':str(self.root),'GITHUB_SHA':'a'*40}),mock.patch.object(m.sys,'argv',['resolver','--resolve-once']),mock.patch.object(m,'authority'),mock.patch.object(pathlib.Path,'read_text',readtext),mock.patch.object(pathlib.Path,'read_bytes',readbytes),mock.patch.object(m,'run',side_effect=fake_run),mock.patch.object(m.subprocess,'Popen')as spawn:
     self.assertEqual(m.main(),expected);spawn.assert_not_called()
    self.assertEqual(len(seen),2);self.assertEqual(seen[0],seen[1])
    j=m.json.loads((self.root/'lock-report.json').read_text());self.assertFalse(j['ready'])
    if expected:
     self.assertEqual(j['diagnosticStage'],'FINAL_BASELINE_CHECK')
     self.assertEqual(j['failureReason'],'BASELINE_SET_MISMATCH')
     self.assertEqual(j['baselineDifferences'],{'missingFromQuery':0,'extraInQuery':0,'versionMismatch':1,'architectureMismatch':0})

class VersionMismatchDiagnostics(unittest.TestCase):
 def observe(self,raw,live,name='pkg'):
  result={};installed={name:{'Version':raw,'Architecture':'amd64','Status':'install ok installed'}}
  with self.assertRaisesRegex(AssertionError,'^BASELINE_SET_MISMATCH$'):
   m.compare_baseline((name+'\t'+live+'\tamd64\tinstall ok installed\n').encode(),installed,result)
  return result['baselineVersionMismatchSample']
 def test_zero_epoch_hypothesis_does_not_admit(self):
  row=self.observe('0:1.2-3ubuntu1','1.2-3ubuntu1')['rows'][0]
  self.assertEqual(row,{'package':'pkg','rawStatusVersion':'0:1.2-3ubuntu1','queryVersion':'1.2-3ubuntu1','explicitZeroEpochOnly':True})
 def test_real_version_change_is_not_epoch(self):
  self.assertFalse(self.observe('1.2-3','1.2-4')['rows'][0]['explicitZeroEpochOnly'])
 def test_unsafe_and_long_tokens_never_exposed(self):
  for raw in ['1/secret','1'+('a'*128),'1\x1bsecret']:
   sample=self.observe(raw,'2');self.assertEqual(sample['rows'],[{'omitted':'UNSAFE_OR_OVERLONG_TOKEN'}]);self.assertNotIn(raw,str(sample))
 def test_deterministic_sample_cap(self):
  installed={f'pkg{i:02}':{'Version':'1','Architecture':'amd64','Status':'install ok installed'} for i in range(12)}
  query=''.join(f'{n}\t2\tamd64\tinstall ok installed\n' for n in reversed(installed)).encode();result={}
  with self.assertRaisesRegex(AssertionError,'BASELINE_SET_MISMATCH'):m.compare_baseline(query,installed,result)
  sample=result['baselineVersionMismatchSample'];self.assertEqual(len(sample['rows']),8);self.assertTrue(sample['truncated']);self.assertEqual(sample['rows'][0]['package'],'pkg00');self.assertEqual(result['baselineDifferences']['versionMismatch'],12)

class ControlHeaders(unittest.TestCase):
 def test_empty_multiline_header_does_not_contaminate_version(self):
  row=m.paragraphs('Package: fixture\nVersion: 1.0\nConffiles:\n /etc/fixture.conf abc123\nStatus: install ok installed')[0]
  self.assertEqual(row['Version'],'1.0');self.assertEqual(row['Conffiles'],'\n /etc/fixture.conf abc123')
 def test_no_space_and_tab_header_values(self):
  self.assertEqual(m.paragraphs('Package:fixture\nVersion:\t1.0')[0],{'Package':'fixture','Version':'1.0'})
 def test_continuation_stays_with_current_header(self):
  self.assertEqual(m.paragraphs('Description: text\n first\n\tsecond')[0]['Description'],'text\n first\n\tsecond')
 def test_duplicate_empty_header_refused(self):
  for value in ['Conffiles:\nConffiles: x','Version:1\nversion:2']:
   with self.assertRaises(AssertionError):m.paragraphs(value)
 def test_orphan_and_malformed_refused(self):
  for value in [' orphan','Version: 1\nbad header\n continuation','Bad Field: x',': x','#Comment: x']:
   with self.assertRaises(AssertionError):m.paragraphs(value)
 def test_paragraph_boundary_resets_continuation_owner(self):
  self.assertEqual(len(m.paragraphs('Package:a\n\nPackage:b')),2)
  with self.assertRaises(AssertionError):m.paragraphs('Package:a\n\n orphan')

class EmptySeparators(unittest.TestCase):
 def test_repeated_leading_trailing_empty_lines(self):
  expected=[{'Package':'a','Version':'1'},{'Package':'b','Version':'2'}]
  for gap in [2,3,4,5,6]:
   text='\n'*gap+'Package:a\nVersion:1'+'\n'*gap+'Package:b\nVersion:2'+'\n'*gap
   self.assertEqual(m.paragraphs(text),expected)
 def test_blank_does_not_preserve_continuation_owner(self):
  with self.assertRaises(AssertionError):m.paragraphs('Package:a\n\n\n orphan')

class TransactionDiagnostics(unittest.TestCase):
 def test_intermediate_suffix_requires_configuration(self):
  for suffix in [' []',' [pending-package ]']:
   line='Inst new-package (1.0 noble [amd64])'+suffix;r={}
   with self.assertRaisesRegex(AssertionError,'CONFIGURATION_INCOMPLETE'):m.transaction(line,{},r)
   self.assertNotIn('transactionCompletion',r)
 def test_unclassified_shape_retained_without_raw_text(self):
  r={};line='Inst PRIVATE_SECRET\tmalformed'
  with self.assertRaisesRegex(AssertionError,'^TRANSACTION_PARSE$'):m.transaction(line,{},r)
  d=r['transactionParseObservation'];self.assertTrue(d['containsControl']);self.assertFalse(d['candidateCloseThenBracket']);self.assertNotIn('PRIVATE_SECRET',str(d))
 def test_existing_acceptance_and_refusals_unchanged(self):
  r={};self.assertEqual(m.transaction('Inst new-package (1 noble [amd64])\nConf new-package (1 noble [amd64])',{},r),[{'package':'new-package','version':'1'}]);self.assertTrue(r['transactionCompletion']['finalConfigurationWithoutBreaks'])
  for line in ['Remv package [1]','Purg package [1]','Inst package [1] (2 noble [amd64])']:
   with self.assertRaises(AssertionError):m.transaction(line,{'package':{}},r)
  self.assertTrue(r['transactionCompletion']['finalConfigurationWithoutBreaks'])
 def test_actual_main_passes_result_to_transaction(self):
  self.assertIn('changes=transaction_with_review(simulated.decode(),installed,result)',p.read_text())

class StrictCompletion(unittest.TestCase):
 def test_benign_intermediate_breaks_complete(self):
  r={};text='Inst alpha (1 noble [amd64]) [beta:amd64 ]\nInst beta (2 noble [amd64]) []\nConf alpha (1 noble [amd64]) []\nConf beta (2 noble [amd64])'
  self.assertEqual(m.transaction(text,{},r),[{'package':'alpha','version':'1'},{'package':'beta','version':'2'}])
  self.assertEqual(r['transactionCompletion'],{'installed':2,'configured':2,'intermediateSuffixes':3,'finalConfigurationWithoutBreaks':True})
 def test_final_breaks_and_incomplete_refused(self):
  inst='Inst alpha (1 noble [amd64])'
  for tail in ['', '\nConf alpha (1 noble [amd64]) []','\nConf alpha (1 noble [amd64]) [beta ]','\nConf alpha broken','\nConf beta (1 noble [amd64])','\nConf alpha (2 noble [amd64])','\nConf alpha (1 noble [amd64])\nConf alpha (1 noble [amd64])']:
   with self.subTest(tail=tail),self.assertRaises(AssertionError):m.transaction(inst+tail,{})
 def test_unknown_suffixes_and_bounds_refused(self):
  for suffix in [' [alpha on beta]',' [alpha on beta ]',' [alpha:arm64 ]',' [alpha]',' [[]]',' [] []',' [alpha alpha ]',' [a; ]',' ['+'a '*101+']',' ['+'a'*103+' ]','\t[]']:
   with self.subTest(suffix=suffix),self.assertRaises(AssertionError):m.transaction('Inst beta (1 noble [amd64])'+suffix+'\nConf beta (1 noble [amd64])',{})
 def test_unknown_arch_and_duplicate_or_installed_refused(self):
  for text in ['Inst alpha:arm64 (1 noble [amd64])','Inst alpha (1 noble [arm64])','Inst alpha (1 noble [amd64])\nInst alpha (1 noble [amd64])','Inst alpha [0] (1 noble [amd64])','Remv alpha [1]','Purg alpha [1]','InstSomething else']:
   with self.subTest(text=text),self.assertRaises(AssertionError):m.transaction(text+'\nConf alpha (1 noble [amd64])',{})
  with self.assertRaises(AssertionError):m.transaction('Inst alpha (1 noble [amd64])\nConf alpha (1 noble [amd64])',{'alpha':{}})
 def test_empty_transaction_refused(self):
  with self.assertRaisesRegex(AssertionError,'CONFIGURATION_INCOMPLETE'):m.transaction('Reading lists...',{})

class UpdateFailureObservation(unittest.TestCase):
 def test_unknown_and_multiple_private_bytes_never_escape(self):
  for out,err,expected in [(b'private.invalid/token /secret',b'?', ['UNCLASSIFIED']), (b"Temporary failure resolving 'private.invalid'",b'Certificate verification failed: /secret',['NAME_RESOLUTION_MARKER','TLS_CERTIFICATE_MARKER'])]:
   e=m.child_failure(['/usr/bin/apt-get','update','--error-on=any'],100,out,err);r={'ready':False,'diagnosticStage':'METADATA_UPDATE'};m.record_failure(r,e)
   d=r['metadataUpdateObservation'];self.assertEqual(d['observedMarkerClasses'],expected);self.assertEqual(d['stdoutSha256'],m.sha(out));self.assertTrue(d['completeBoundedStreams']);self.assertFalse(r['ready']);self.assertEqual(r['failureReason'],'CHILD_FAILED');self.assertNotIn('private.invalid',str(r));self.assertNotIn('/secret',str(r))
 def test_each_verified_marker_and_other_commands(self):
  for k,needles in m.UPDATE_MARKERS.items():
   for n in needles:self.assertEqual(m.child_failure(['/usr/bin/apt-get','update','--error-on=any'],100,n,b'').metadataUpdateObservation['observedMarkerClasses'],[k])
  for argv in [['/usr/bin/apt-get','update'],['/usr/bin/apt-get','-s','install'],['/usr/bin/apt-cache','show'],['/usr/bin/apt-get','update','extra']]:self.assertFalse(hasattr(m.child_failure(argv,100,b'Hash Sum mismatch',b''),'metadataUpdateObservation'))
 def test_overlimit_not_truncated_and_wrong_stage_not_copied(self):
  with mock.patch.object(m,'CAP',2),self.assertRaisesRegex(m.BoundFailure,'LOG_BOUND'):m.child_failure(['/usr/bin/apt-get','update','--error-on=any'],100,b'abc',b'')
  e=m.child_failure(['/usr/bin/apt-get','update','--error-on=any'],100,b'Hash Sum mismatch',b'');r={'diagnosticStage':'TRANSACTION_SIMULATION'};m.record_failure(r,e);self.assertNotIn('metadataUpdateObservation',r)
 def test_forged_private_observation_refused(self):
  e=m.ChildFailure('CHILD_FAILED');e.metadataUpdateObservation={'raw':'private'};r={'diagnosticStage':'METADATA_UPDATE'};m.record_failure(r,e);self.assertNotIn('metadataUpdateObservation',r)
 def test_actual_main_update_argv_matches_diagnostic(self):
  import ast,inspect
  calls=[n for n in ast.walk(ast.parse(inspect.getsource(m.main))) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='run' and n.args and isinstance(n.args[0],ast.List)]
  argv=[ast.literal_eval(n.args[0]) for n in calls if all(isinstance(x,ast.Constant) for x in n.args[0].elts)]
  update=[x for x in argv if x[:2]==['/usr/bin/apt-get','update']]
  self.assertEqual(update,[['/usr/bin/apt-get','update','--error-on=any']])
  self.assertTrue(hasattr(m.child_failure(update[0],100,b'',b''),'metadataUpdateObservation'))
 def test_actual_failure_path_remains_after_all_bounds_and_cleanup(self):
  import inspect
  source=inspect.getsource(m.run)
  self.assertLess(source.index('if cleanup is not None:raise cleanup'),source.index('raise child_failure('))
  self.assertLess(source.index("raise BoundFailure('LOG_BOUND')"),source.index('raise child_failure('))
  self.assertLess(source.index("raise BoundFailure('DEADLINE')"),source.index('raise child_failure('))


class InstalledReview(unittest.TestCase):
 def base(self,n='gcc',v='1',a='amd64'):return {n:{'Version':v,'Architecture':a}}
 def text(self,n='gcc',prior='1',v='2',arch='amd64'):
  return f'Inst {n} [{prior}] ({v} noble [{arch}])\nConf {n} ({v} noble [{arch}])\n'
 def test_normal_refusal_and_complete_review(self):
  result={};text=self.text()
  with self.assertRaisesRegex(AssertionError,'INSTALLED_CHANGE_REQUIRES_REVIEW'):m.transaction_with_review(text,self.base(),result)
  r=result['installedChangeReview'];self.assertTrue(r['complete']);self.assertFalse(r['ready']);self.assertEqual(r['installedChangeCount'],1)
  x=r['changes'][0];self.assertEqual((x['package'],x['baselineVersion'],x['simulatedPriorVersion'],x['proposedVersion']),('gcc','1','1','2'))
  self.assertTrue(x['priorMatchesBaseline']);self.assertEqual(x['authenticatedCandidateAssociation'],'unresolved')
 def test_exact_prior_and_arch_disagreement_visible(self):
  r=m.observe_installed_changes(self.text(prior='0:1',arch='all'),self.base())
  self.assertTrue(r['complete']);self.assertFalse(r['changes'][0]['priorMatchesBaseline']);self.assertFalse(r['changes'][0]['architectureMatchesBaseline'])
 def test_multiple_and_no_version_order_claim(self):
  text=self.text()+self.text('make','9','1');r=m.observe_installed_changes(text,{**self.base(),**self.base('make','9')})
  self.assertEqual(r['installedChangeCount'],2);self.assertEqual(r['transactionCompletion']['configured'],2)
  self.assertNotIn('upgrade',str(r));self.assertNotIn('downgrade',str(r))
 def test_prior_without_baseline_and_no_prior(self):
  r=m.observe_installed_changes(self.text(),{});self.assertFalse(r['changes'][0]['baselinePresent']);self.assertIsNone(r['changes'][0]['priorMatchesBaseline'])
  r=m.observe_installed_changes('Inst gcc (2 noble [amd64])\nConf gcc (2 noble [amd64])',self.base());self.assertIsNone(r['changes'][0]['simulatedPriorVersion'])
 def test_incomplete_never_keeps_partial_rows(self):
  for text in [self.text()+'Inst make [1] (2 noble [amd64])',self.text()+'Conf gcc (2 noble [amd64])',self.text().replace('Conf gcc (2','Conf gcc (3'),self.text().replace('Conf gcc (2 noble [amd64])','Conf gcc (2 noble [all])'),self.text()+'Remv other [1]',self.text()+'Inst malformed']:
   with self.subTest(text=text):
    r=m.observe_installed_changes(text,self.base());self.assertFalse(r['complete']);self.assertNotIn('changes',r)
 def test_final_breaks_refused(self):
  r=m.observe_installed_changes(self.text().rstrip()+' [gcc ]',self.base());self.assertFalse(r['complete']);self.assertEqual(r['reason'],'CONFIGURATION_FINAL_BREAKS')
 def test_count_overflow_not_prefix_complete(self):
  text=''.join(self.text('p'+str(i))for i in range(33));r=m.observe_installed_changes(text,{})
  self.assertFalse(r['complete']);self.assertEqual(r['reason'],'INSTALLED_REVIEW_BOUND');self.assertNotIn('changes',r)
 def test_byte_overflow_not_prefix_complete(self):
  text=''.join(self.text('package'+str(i)+'x'*75,'1'+'a'*120,'2'+'b'*120)for i in range(32));r=m.observe_installed_changes(text,{})
  self.assertFalse(r['complete']);self.assertEqual(r['reason'],'INSTALLED_REVIEW_BOUND');self.assertNotIn('changes',r)
 def test_privacy_unknown_association_no_subprocess(self):
  text='private log /home/person https://secret.example\n'+self.text();result={}
  with mock.patch.object(m,'run')as run:
   with self.assertRaisesRegex(AssertionError,'INSTALLED_CHANGE_REQUIRES_REVIEW'):m.transaction_with_review(text,self.base(),result)
   run.assert_not_called()
  serialized=str(result);self.assertNotIn('secret',serialized);self.assertNotIn('/home',serialized);self.assertNotIn('noble',serialized)
 def test_other_failure_and_new_packages_unchanged(self):
  result={}
  with self.assertRaisesRegex(AssertionError,'TRANSACTION_PARSE'):m.transaction_with_review('Inst malformed',{},result)
  self.assertNotIn('installedChangeReview',result)
  self.assertEqual(m.transaction_with_review('Inst gcc (1 noble [amd64])\nConf gcc (1 noble [amd64])',{},{}),[{'package':'gcc','version':'1'}])
 def test_architecture_and_prior_fields_bound(self):
  for text in [self.text().replace('Inst gcc','Inst gcc:all'),self.text(arch='i386'),self.text(prior='/private/path'),self.text(prior='1'*129)]:
   r=m.observe_installed_changes(text,self.base());self.assertFalse(r['complete']);self.assertNotIn('changes',r)


class UpdateMarkerSuccessor(unittest.TestCase):
 argv=['/usr/bin/apt-get','update','--error-on=any']
 additions={
  'CONNECTION_FAILURE_MARKER':b'Could not connect to ',
  'CONNECTION_TIMEOUT_MARKER':b'connection timed out',
  'TLS_SYSTEM_CERTIFICATE_MARKER':b'Could not load system TLS certificates:',
  'RELEASE_UNSIGNED_MARKER':b' is not signed.',
  'RELEASE_MISSING_MARKER':b' does not have a Release file.',
  'RELEASE_EXPIRED_MARKER':b' is expired (invalid since ',
  'RELEASE_NOT_YET_VALID_MARKER':b' is not valid yet (invalid for another ',
  'LOCK_FAILURE_MARKER':b'Could not get lock '}
 def test_each_new_fixed_marker_and_safe_projection(self):
  import json
  for name,marker in self.additions.items():
   for stream in [0,1]:
    with self.subTest(name=name,stream=stream):
     text=b'https://private.example:9876/private/secret '+marker+b' user-token-SECRET 999999'
     out,err=(text,b'')if stream==0 else(b'',text)
     failure=m.child_failure(self.argv,100,out,err);result={'diagnosticStage':'METADATA_UPDATE'};m.record_failure(result,failure)
     observation=result['metadataUpdateObservation'];self.assertEqual(observation['observedMarkerClasses'],[name]);self.assertTrue(observation['completeBoundedStreams'])
     serialized=json.dumps(result)
     for private in ['private.example','/private/secret','SECRET','999999','9876']:self.assertNotIn(private,serialized)
     self.assertEqual(result['failureReason'],'CHILD_FAILED');self.assertEqual(result['status'],'blocked')
 def test_multiple_sorted_unique_observations_only(self):
  text=b' '.join(self.additions.values())*2
  o=m.child_failure(self.argv,100,text,b'').metadataUpdateObservation
  self.assertEqual(o['observedMarkerClasses'],sorted(self.additions));self.assertNotIn('rootCause',o)
 def test_numeric_http_path_hostname_never_guessed(self):
  o=m.child_failure(self.argv,100,b'403 404 429 500 503 https://host.invalid /private/lock errno 28',b'unknown').metadataUpdateObservation
  self.assertEqual(o['observedMarkerClasses'],['UNCLASSIFIED'])
 def test_exact_nonzero_update_failure_gate(self):
  for argv in [self.argv[:2],self.argv+['--quiet'],['/usr/bin/apt-cache','update']]:
   self.assertFalse(hasattr(m.child_failure(argv,100,b'Could not get lock ',b''),'metadataUpdateObservation'))
  with self.assertRaises(AssertionError):m.child_failure(self.argv,0,b'Could not get lock ',b'')
 def test_no_truncated_prefix_classification(self):
  for out,err in [(b'Could not get lock '+b'x'*m.CAP,b''),(b'',b'Could not connect to '+b'x'*m.CAP)]:
   with self.assertRaisesRegex(m.BoundFailure,'LOG_BOUND'):m.child_failure(self.argv,100,out,err)

if __name__=='__main__':unittest.main()

