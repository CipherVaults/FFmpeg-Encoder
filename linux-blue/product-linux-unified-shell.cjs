'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {OutputAccess}=require('../src/output-access.cjs');
const {loaderGuard}=require('./product-linux-shell.cjs');
const {createUnifiedService}=require('./product-linux-unified-service.cjs');
async function createLinuxUnifiedShell(options){
  assert(options&&Object.getPrototypeOf(options)===Object.prototype);
  assert(['runtimeRoot','stateDir'].every(k=>Object.hasOwn(options,k)));
  for(const key of Reflect.ownKeys(options))assert(['runtimeRoot','stateDir','outputAccess','onChild'].includes(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value'));
  for(const key of ['runtimeRoot','stateDir'])assert(typeof options[key]==='string'&&path.isAbsolute(options[key])&&path.resolve(options[key])===options[key]&&!/[\x00-\x1f\x7f]/.test(options[key]));
  assert(options.outputAccess===undefined||options.outputAccess instanceof OutputAccess);
  assert(options.onChild===undefined||typeof options.onChild==='function');loaderGuard();
  return createUnifiedService({...options});
}
module.exports={createLinuxUnifiedShell};
