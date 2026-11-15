'use strict';
const assert=require('node:assert/strict'),{MATROSKA_SCHEMA}=require('../../src/remux-native-inventory.cjs'),{children,idBytes}=require('./ebml-fixture.cjs');
const masters=new Set(MATROSKA_SCHEMA.filter(e=>e.type==='master').map(e=>Number(e.id)));
function tree(bytes){const nodes=[];function walk(start,end,parent=null){const counts=new Map(),out=[];for(const h of children(bytes,start,end)){const i=counts.get(h.id)||0;counts.set(h.id,i+1);const n={...h,parent,path:(parent?.path||'')+'/'+h.id.toString(16)+':'+i,children:[]};nodes.push(n);out.push(n);if(masters.has(n.id))n.children=walk(n.body,n.end,n);}return out;}const top=walk(0,bytes.length),segment=nodes.find(n=>n.id===0x18538067);assert.ok(segment);const packets=[];
  for(const cluster of segment.children.filter(n=>n.id===0x1f43b675))for(const n of cluster.children){if(n.id===0xa3)packets.push({node:n,cluster});else if(n.id===0xa0&&n.children.some(c=>c.id===0xa1))packets.push({node:n,cluster});}
  return{nodes,top,segment,packets};}
const unsigned=(bytes,n)=>{let v=0n;for(const b of bytes.subarray(n.body,n.end))v=v*256n+BigInt(b);return v;};
function uint(v,min){let width=Math.max(min,1);while(v>=(1n<<BigInt(width*8)))width++;const b=Buffer.alloc(width);for(let i=width-1;i>=0;i--){b[i]=Number(v&255n);v>>=8n;}return b;}
function size(value,min){let width=Math.max(min,1);while(BigInt(value)>=(1n<<BigInt(width*7))-1n)width++;let v=BigInt(value)|(1n<<BigInt(width*7));const b=Buffer.alloc(width);for(let i=width-1;i>=0;i--){b[i]=Number(v&255n);v>>=8n;}return b;}
// Fixture construction only: repair pointers when a neutral mutation changes
// element lengths. Never call this on an index-corruption negative fixture.
function relocateMatroska(original,changed){const before=tree(original),links=[];
  for(const n of before.nodes){if(n.id===0x53ac){const position=unsigned(original,n),target=before.segment.children.find(t=>BigInt(t.at-before.segment.body)===position);assert.ok(target,'neutral SeekPosition');links.push({path:n.path,target:target.path});}
    if(n.id===0xf1){const position=unsigned(original,n),target=before.segment.children.find(t=>t.id===0x1f43b675&&BigInt(t.at-before.segment.body)===position);assert.ok(target,'neutral CueClusterPosition');links.push({path:n.path,target:target.path});}
    if(n.id===0xf0){const clusterPosition=n.parent.children.find(c=>c.id===0xf1);assert.ok(clusterPosition);const cluster=before.segment.children.find(t=>t.id===0x1f43b675&&BigInt(t.at-before.segment.body)===unsigned(original,clusterPosition));assert.ok(cluster);
      const index=before.packets.findIndex(p=>p.cluster===cluster&&BigInt(p.node.at-cluster.body)===unsigned(original,n));assert.ok(index>=0,'neutral CueRelativePosition');links.push({path:n.path,packet:index});}
  }
  for(let attempt=0;attempt<8;attempt++){const current=tree(changed),updates=new Map();for(const link of links){let value;if(link.packet!==undefined){const p=current.packets[link.packet];assert.ok(p);value=BigInt(p.node.at-p.cluster.body);}else{const target=current.nodes.find(n=>n.path===link.target);assert.ok(target);value=BigInt(target.at-current.segment.body);}updates.set(link.path,value);}
    function emit(n){const body=updates.has(n.path)?uint(updates.get(n.path),n.end-n.body):masters.has(n.id)?Buffer.concat(n.children.map(emit)):changed.subarray(n.body,n.end);return Buffer.concat([idBytes(n.id),size(body.length,n.sizeWidth),body]);}
    const next=Buffer.concat(current.top.map(emit));if(next.equals(changed))return changed;changed=next;
  }assert.fail('neutral Matroska pointer relocation did not converge');}
module.exports={relocateMatroska};
