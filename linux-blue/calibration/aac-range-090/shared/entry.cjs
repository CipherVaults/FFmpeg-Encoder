'use strict';
require('./driver.cjs').runOnce().then(result=>{process.stdout.write(JSON.stringify({status:result.status,cases:result.cases.map(c=>({id:c.spec.id,status:c.status})),runtimeClosed:result.runtimeClosed})+'\n');}).catch(error=>{process.stderr.write(JSON.stringify({code:error.code,message:error.message})+'\n');process.exitCode=1;});
