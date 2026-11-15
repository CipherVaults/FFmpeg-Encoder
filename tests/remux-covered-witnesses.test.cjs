'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {INVENTORY,assertCoveredInventory}=require('../src/remux-native-inventory.cjs');
const {registry,registerReferences,registerParents}=require('./helpers/remux-covered-witnesses.cjs');
const {execute}=require('./helpers/remux-witness-execution.cjs');
registerReferences(INVENTORY);registerParents(INVENTORY);
require('./helpers/remux-structure-witnesses.cjs').registerStructures(registry,INVENTORY);
require('./helpers/remux-ts-witnesses.cjs').registerTransport(registry,INVENTORY);
const {registerPackets,registerFragments}=require('./helpers/remux-packet-witnesses.cjs');registerPackets(registry,INVENTORY);registerFragments(registry,INVENTORY);
test('every covered inventory claim has a witness, native comparison/default, or source refusal',()=>{
  assertCoveredInventory(INVENTORY);
});
test('covered-row certification refuses a claim with no executable witness, native check or refusal',()=>{
  const row=INVENTORY.find(r=>r.witness);assertCoveredInventory([row]);
  assert.throws(()=>assertCoveredInventory([{...row,witness:undefined}]),/Unproved/);
  assert.throws(()=>assertCoveredInventory([{...row,witnessCodes:undefined}]),/Unproved/);
  for(const annotation of [{nativeCheck:'unimplemented check'},{refusal:'unenforced refusal'},{witness:true},{witness:' '}])
    assert.throws(()=>assertCoveredInventory([{...row,witness:undefined,...annotation}]),/Unproved/);
});
test('a witness returning before fixture construction cannot pass',async()=>{
  await assert.rejects(execute({}, {id:'deliberate-early-return'},async()=>{}),/returned without constructing/);
});
for(const row of INVENTORY.filter(r=>r.witness))test('field-isolation witness: '+row.id+' ['+row.witness+']',async t=>{
  const run=registry[row.witness];assert.equal(typeof run,'function','Declared witness has no executable fixture: '+row.witness);await execute(t,row,run);
});
