'use strict';
// Same immutable evidence contract as evidence-run, with an explicit Node
// concurrency flag in the saved command. The toolkit runner accepts file paths
// only; no toolkit copy, package script or machine setting is changed here.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function plan(label,suite){
  if(typeof label!=='string'||!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(label))throw Error('Invalid evidence label.');
  if(!['remux','full'].includes(suite))throw Error('Evidence suite must be remux or full.');
  const tests=fs.readdirSync(path.join(root,'tests')).filter(n=>/\.test\.cjs$/.test(n)&&(suite==='full'||n.startsWith('remux-'))).sort().map(n=>'tests/'+n);
  if(!tests.length)throw Error('No test files selected.');
  const covers=fs.readdirSync(path.join(root,'src')).filter(n=>n.endsWith('.cjs')).map(n=>'src/'+n)
    .concat(fs.readdirSync(path.join(root,'tests/helpers')).filter(n=>/\.(cjs|json)$/.test(n)).map(n=>'tests/helpers/'+n),fs.readdirSync(path.join(root,'scripts')).filter(n=>/^v07-remux-.*\.(cjs|json|md)$/.test(n)).map(n=>'scripts/'+n)).sort();
  return{label,suite,tests,covers,args:['--test','--test-concurrency=4',...tests]};
}
function identity(files){return files.map(file=>{const b=fs.readFileSync(path.join(root,file));return{file,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};});}
function run(label,suite){
  const p=plan(label,suite),stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z'),dir=path.join(root,'artifacts/v0.7/evidence',stamp+'_'+label);
  fs.mkdirSync(dir);const before={tests:identity(p.tests),covers:identity(p.covers)},startedAt=new Date().toISOString(),start=process.hrtime.bigint();
  const child=spawnSync(process.execPath,p.args,{cwd:root,encoding:'utf8',maxBuffer:256*1024**2,windowsHide:true}),durationMs=Number(process.hrtime.bigint()-start)/1e6;
  const after={tests:identity(p.tests),covers:identity(p.covers)},summary={};
  for(const key of ['tests','suites','pass','fail','cancelled','skipped','todo']){const m=(child.stdout||'').match(new RegExp('^(?:# |\\u2139 )'+key+' (\\d+)\\s*$','m'));if(m)summary[key]=Number(m[1]);}
  const git=(...a)=>spawnSync('git',a,{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim();
  const receipt={schema:1,label,startedAt,durationMs:Math.round(durationMs*1000)/1000,node:process.version,platform:process.platform,head:git('rev-parse','HEAD'),
    dirtyPaths:git('status','--porcelain=v1').split('\n').filter(Boolean).length,command:['node',...p.args],exitCode:child.status,signal:child.signal,spawnError:child.error?String(child.error):null,
    summary,bytesChangedDuringRun:JSON.stringify(before)!==JSON.stringify(after),files:after};
  fs.writeFileSync(path.join(dir,'stdout.txt'),child.stdout||'');fs.writeFileSync(path.join(dir,'stderr.txt'),child.stderr||'');fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  const passed=child.status===0&&!receipt.bytesChangedDuringRun&&summary.tests>0;console.log((passed?'PASS ':'FAIL ')+label+': '+JSON.stringify(summary)+' exit='+child.status+' '+receipt.durationMs+'ms');console.log('receipt: '+path.relative(root,dir));return{passed,receipt,dir};
}
if(require.main===module){try{const r=run(...process.argv.slice(2));process.exitCode=r.passed?0:1;}catch(e){console.error(e);process.exitCode=1;}}
module.exports={plan,run};
