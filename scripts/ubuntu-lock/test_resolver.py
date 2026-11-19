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
 def test_new(self):self.assertEqual(m.transaction('Inst cmake (1 noble [amd64])\n',{}),[{'package':'cmake','version':'1'}])
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
if __name__=='__main__':unittest.main()

