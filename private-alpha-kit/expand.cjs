'use strict';
const A=require('node:assert/strict'),F=require('node:fs/promises'),P=require('node:path');
const {execFileSync}=require('node:child_process'),{inventory}=require('./installer.cjs');
async function main(){
 const [source,stage,zip,dest]=process.argv.slice(2);A.equal(process.platform,'win32');A.equal(process.env.GITHUB_ACTIONS,'true');
 A([source,stage,zip,dest].every(P.isAbsolute));A.equal(P.resolve(P.dirname(zip),'..'),P.resolve(stage,'..','..'));
 A.equal(P.resolve(dest),P.resolve(process.env.RUNNER_TEMP,'alpha-private-prep-20261121','fresh portable'));
 const rows=await inventory(stage);const seven='C:\\Program Files\\7-Zip\\7z.exe';
 const run=args=>execFileSync(seven,args,{cwd:source,encoding:'utf8',timeout:160000,maxBuffer:3*1024*1024});
 run(['t','-bd','-bb0','--',zip]);
 const stagePolicy=require(P.join(process.env.GITHUB_WORKSPACE,'trusted-helpers','scripts/windows-package-policy.cjs'));
 const listing=stagePolicy.inspectElectronListing(run(['l','-slt','-ba','-sccUTF-8','--',zip]),[]).entries;
 A.deepEqual(listing.filter(x=>!x.directory).map(x=>[x.name,x.size]).sort(),rows.map(x=>[x.path,x.bytes]).sort());
 await F.mkdir(dest);run(['x','-bd','-bb0','-aos','-o'+dest,'--',zip]);A.deepEqual(await inventory(dest),rows);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
