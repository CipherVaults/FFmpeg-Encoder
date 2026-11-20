'use strict';
// Read-only PE resource verification: match the active group to the exact seven ICO image payloads.
const A=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function matches(pe,ico,expectedGroup=null){
 A.equal(pe.subarray(0,2).toString('ascii'),'MZ');const u16=o=>pe.readUInt16LE(o),u32=o=>pe.readUInt32LE(o),p=u32(0x3c);
 A.equal(pe.subarray(p,p+4).toString('hex'),'50450000');
 const opt=p+24,m=u16(opt),nd= m===0x20b?112:m===0x10b?96:0;A(nd);
 const sect=opt+u16(p+20),n=u16(p+6);A(n>0&&n<=96);
 function off(v,len){for(let i=0;i<n;i++){const s=sect+40*i,b=u32(s+12),size=u32(s+16);if(v>=b&&v-b+len<=size){const o=u32(s+20)+v-b;A(o+len<=pe.length);return o;}}throw Error('Unmapped resource');}
 const ro=off(u32(opt+nd+16),16),rlen=u32(opt+nd+20);
 function entries(o){const n=u16(o+12)+u16(o+14);A(n<4096&&o>=ro&&o+16+n*8<=ro+rlen);return Array.from({length:n},(_,i)=>{const a=o+16+i*8,B=u32(a+4),id=u32(a);return {id,dir:B>=0x80000000,o:ro+(B&0x7fffffff)};});}
 function res(type){const t=entries(ro).find(e=>e.id===type&&e.dir);A(t);const map=new Map();for(const e of entries(t.o)){A(e.dir);const ls=entries(e.o);A(ls.length);const vals=ls.map(l=>{A(!l.dir);const size=u32(l.o+4),o=off(u32(l.o),size);return pe.subarray(o,o+size);});map.set(e.id,vals);}return map;}
 A.equal(ico.readUInt16LE(0),0);A.equal(ico.readUInt16LE(2),1);const count=ico.readUInt16LE(4);A.equal(count,7);
 const expected=Array.from({length:count},(_,i)=>{const r=6+i*16,l=ico.readUInt32LE(r+8),o=ico.readUInt32LE(r+12);A(o+l<=ico.length);return [ico[r]||256,ico[r+1]||256,hash(ico.subarray(o,o+l))].join(':');}).sort();
 const shapes=res(3),groups=res(14);const first=[...groups.keys()].filter(x=>x<0x80000000).sort((a,b)=>a-b)[0];A(Number.isInteger(first));if(expectedGroup!==null)A.equal(first,expectedGroup);
 for(const g of groups.get(first)){A.equal(g.readUInt16LE(2),1);const c=g.readUInt16LE(4);A.equal(c,count);const seen=[];for(let i=0;i<c;i++){const r=6+i*14,id=g.readUInt16LE(r+12),list=shapes.get(id);A(list?.length);const signatures=new Set(list.map(hash));A.equal(signatures.size,1);seen.push([g[r]||256,g[r+1]||256,...signatures].join(':'));}A.deepEqual(seen.sort(),expected);}
 return {iconGroup:first,frames:count,verified:true};
}
module.exports={matches};if(require.main===module){const [exe,ico,group]=process.argv.slice(2);A(group===undefined||group==='103');A(exe&&ico);const expected=fs.readFileSync(ico);A.equal(hash(expected),require('./pinned.cjs').ico);console.log(JSON.stringify(matches(fs.readFileSync(exe),expected,group===undefined?null:Number(group))));}
