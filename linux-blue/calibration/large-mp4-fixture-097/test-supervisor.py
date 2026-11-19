import unittest,importlib.util,pathlib,unittest.mock as mock,os
p=pathlib.Path(__file__).with_name('supervise.py');s=importlib.util.spec_from_file_location('supervisor',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_wnowait(self):
  with mock.patch.object(m.os,'waitid',return_value=object()) as w:
   self.assertTrue(m.exited_unreaped(123));self.assertTrue(w.call_args.args[2]&os.WNOWAIT)
 def test_wrong_owner_refuses(self):
  with mock.patch.object(m,'leader_identity',return_value=(123,2)):
   with self.assertRaises(AssertionError):m.require_owner((123,1))
 def test_permission_failure_not_suppressed(self):
  with mock.patch.object(m.Path,'iterdir',side_effect=PermissionError('inert')):
   with self.assertRaises(PermissionError):m.group_rows(123)
 def test_missing_gate_refuses(self):
  with mock.patch.object(m.sys,'argv',['supervise.py','--execute-reviewed-once']),mock.patch.object(m,'loader_guard'),mock.patch.object(m.subprocess,'Popen') as spawn:
   with self.assertRaises(FileNotFoundError):m.main()
   spawn.assert_not_called()
 def test_loader_overrides(self):
  for key in ['NODE_OPTIONS','LD_PRELOAD','ELECTRON_RUN_AS_NODE','ELECTRON_FORCE_IS_PACKAGED','ELECTRON_DISABLE_SANDBOX']:
   with mock.patch.dict(m.os.environ,{key:'x'}):
    with self.assertRaises(AssertionError):m.loader_guard()
 def test_exact_limits(self):
  text=p.read_text();self.assertIn('total<=2*1024**3',text);self.assertIn('>=27*1024**3',text);self.assertIn('started<600',text);self.assertIn('signal.SIGTERM,5',text);self.assertNotIn('proc.poll()',text)
if __name__=='__main__':unittest.main()
