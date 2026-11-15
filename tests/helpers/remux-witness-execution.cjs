'use strict';
const assert=require('node:assert/strict'),runs=new WeakMap();
function mark(t,step){let state=runs.get(t);if(!state)runs.set(t,state={fixture:0,neutral:0,refusal:0});state[step]++;}
async function execute(t,row,run){await run(t,row);const s=runs.get(t);assert.ok(s?.fixture>0&&s?.neutral>0&&s?.refusal>0,'Witness returned without constructing a fixture, passing its neutral pair and observing enforcement: '+row.id);}
module.exports={mark,execute};
