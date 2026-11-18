'use strict';
const assert=require('node:assert/strict');const path=require('node:path');const {execFileSync}=require('node:child_process');
const {authority}=require('./windows-packaged-integration.cjs');
const {readHostedEvent,preflight,createPreflightDiagnostic}=require('./windows-hosted-package-check.cjs');
const {expectedCandidateManifest}=require('../src/candidate-runtime.cjs');
async function main(){const root=path.resolve(__dirname,'..'),d=createPreflightDiagnostic();try{const id=authority(process.env,await readHostedEvent(process.env.GITHUB_EVENT_PATH));assert(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024}).trim()===id.head);execFileSync('git',['diff','--exit-code','HEAD','--'],{cwd:root,timeout:10000,maxBuffer:1024});await preflight(root,process.env.RUNNER_TEMP,expectedCandidateManifest(),d);}catch(error){console.error(JSON.stringify(d.failure(error)));process.exitCode=1;}}
if(require.main===module)main();
