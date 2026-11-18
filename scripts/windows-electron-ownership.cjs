'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const {verifyPinnedFile}=require('../src/candidate-runtime.cjs');
const CODES=Object.freeze(['LAUNCHER_IDENTITY','MAIN_IDENTITY','MAIN_ANCESTRY','EXECUTABLE_PATH','EXECUTABLE_PIN','FIRST_WINDOW']);
function need(ok,code){if(!ok)throw Object.assign(new Error('Packaged launch ownership refused.'),{code});}
function canonical(value){need(typeof value==='string'&&value.length<1024&&!/[\x00-\x1f\x7f]/.test(value)&&/^[A-Za-z]:[\\/]/.test(value),'EXECUTABLE_PATH');need(!value.slice(2).includes(':')&&!value.startsWith('\\\\'),'EXECUTABLE_PATH');return path.win32.normalize(value).toLowerCase();}
function createdAt(value){
  // Windows PowerShell ConvertTo-Json serializes CIM DateTime as /Date(ms)/.
  const match=typeof value==='string'&&/^\/Date\((\d{1,15})(?:[+-]\d{4})?\)\/$/.exec(value);
  const number=match?Number(match[1]):NaN;
  return Number.isSafeInteger(number)&&number>=0&&number<=8640000000000000?number:null;
}
function validIdentity(row){return !!row&&Number.isSafeInteger(row.ProcessId)&&row.ProcessId>0&&Number.isSafeInteger(row.ParentProcessId)&&row.ParentProcessId>=0&&createdAt(row.CreationDate)!==null&&typeof row.ExecutablePath==='string';}
function sameIdentity(a,b){return validIdentity(a)&&validIdentity(b)&&a.ProcessId===b.ProcessId&&a.ParentProcessId===b.ParentProcessId&&a.CreationDate===b.CreationDate&&a.ExecutablePath===b.ExecutablePath;}
function requireLauncher(row,pid,shell,parentPid,child){need(validIdentity(row)&&row.ProcessId===pid&&Number.isSafeInteger(parentPid)&&parentPid>0&&row.ParentProcessId===parentPid&&child&&child.pid===pid&&child.exitCode===null&&child.signalCode===null,'LAUNCHER_IDENTITY');need(canonical(row.ExecutablePath)===canonical(shell),'LAUNCHER_IDENTITY');return row;}
function requireMain({launcher,main,pid,execPath,appExe,expected,rows}){
  need(validIdentity(main)&&main.ProcessId===pid,'MAIN_IDENTITY');
  need([main.ExecutablePath,execPath,appExe].every(p=>canonical(p)===canonical(expected)),'EXECUTABLE_PATH');
  need(Array.isArray(rows)&&rows.length>0&&rows.length<=10000,'MAIN_ANCESTRY');
  const map=new Map();for(const row of rows){need(row&&Number.isSafeInteger(row.ProcessId)&&row.ProcessId>=0&&!map.has(row.ProcessId),'MAIN_ANCESTRY');map.set(row.ProcessId,row);}
  need(sameIdentity(map.get(launcher.ProcessId),launcher)&&sameIdentity(map.get(main.ProcessId),main),'MAIN_ANCESTRY');
  let current=main;const seen=new Set();
  for(let depth=0;depth<8;depth++){
    if(sameIdentity(current,launcher))return {launcher,main};
    need(!seen.has(current.ProcessId),'MAIN_ANCESTRY');seen.add(current.ProcessId);
    const child=current;current=map.get(child.ParentProcessId);need(validIdentity(current)&&createdAt(current.CreationDate)<=createdAt(child.CreationDate),'MAIN_ANCESTRY');
  }
  need(false,'MAIN_ANCESTRY');
}
async function verifyMainFile(actual,expected,pin,{realpath=fs.realpath,verify=verifyPinnedFile}={}){
  need(canonical(actual)===canonical(expected),'EXECUTABLE_PATH');
  need(canonical(await realpath(actual))===canonical(await realpath(expected)),'EXECUTABLE_PATH');
  try{await verify(actual,pin);}catch{need(false,'EXECUTABLE_PIN');}
}
function cleanupRoot(owners,rows){
  const matching=row=>rows.find(current=>sameIdentity(current,row));
  // The main fallback is authorized only by a previously verified owner pair.
  if(owners.launcher&&matching(owners.launcher))return owners.launcher;
  if(owners.main&&matching(owners.main))return owners.main;
  return null;
}
module.exports={CODES,need,canonical,createdAt,validIdentity,sameIdentity,requireLauncher,requireMain,verifyMainFile,cleanupRoot};
