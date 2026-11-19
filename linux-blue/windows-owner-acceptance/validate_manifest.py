"""Validate draft structure only. Never launches software or writes external state."""
import json,pathlib
p=pathlib.Path(__file__).resolve().parent
m=json.loads((p/'case-manifest.json').read_text())
r=json.loads((p/'requirement-map.json').read_text())
assert m['not_execution_authority'] is True
ids=[c['id'] for c in m['cases']]
assert len(ids)==len(set(ids))==28
expected={f'{letter}{i:02d}' for letter,n in [('N',4),('O',8),('P',9),('Q',8),('R',8),('S',6)] for i in range(1,n+1)}
assert set(r)==expected and len(r)==43
for c in m['cases']:
 assert c['status']=='NOT_RUN' and c['evidence']==[] and c['observed'] is None
 assert set(c['requirements'])<=expected
 assert c['priority'] in ['P0','P1'] and 0<=c['stage']<=5
 assert c['procedure'] and c['expected']
for req,entry in r.items():
 assert set(entry['cases'])<=set(ids)
 assert entry['cases'] or entry['disposition']=='deferred-owner-scope'
print('PASS: 28 unique NOT_RUN cases; all43 requirement IDs accounted for; no execution claims.')
orig=json.loads((p/'original-requirements.json').read_text())
assert len(orig['requirements'])==43
assert m['execution_ready'] is False
assert m['candidate_binding']['status']=='UNBOUND'
for key,value in m['candidate_binding'].items():
 if key!='status':assert value is None
for row in orig['requirements']:
 entry=r[row['id']]
 assert entry['original_requirement']==row['text']
 assert entry['source_git_blob']==orig['git_blob']
 assert set(entry['cases'])=={c['id'] for c in m['cases'] if row['id'] in c['requirements']}
 assert entry['lanes'] and entry['closure_status']
for c in m['cases']:
 assert c['binding_status']=='UNBOUND'
 assert c['execution_lane']
print('PASS: reciprocal case mappings, exact43 texts, source identity, lanes and explicit UNBOUND release inputs.')
