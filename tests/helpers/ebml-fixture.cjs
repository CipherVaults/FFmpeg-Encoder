'use strict';
// Owned byte fixtures only. This helper never opens or changes a media file.
const assert=require('node:assert/strict');
const {element,uint,size}=require('./matroska-fixture.cjs');
const idBytes=id=>Buffer.from(id.toString(16).padStart(Math.ceil(id.toString(16).length/2)*2,'0'),'hex');
function unknownElement(id,body,width=1){return Buffer.concat([idBytes(id),Buffer.from([(1<<(9-width))-1,...Array(width-1).fill(255)]),body]);}
function header(bytes,at){
  const width=p=>{let n=1,m=128;while(!(bytes[p]&m)){n++;m>>=1;assert.ok(n<=8);}return n;};
  const idWidth=width(at),sizeWidth=width(at+idWidth),id=Number.parseInt(bytes.subarray(at,at+idWidth).toString('hex'),16);
  let value=BigInt(bytes[at+idWidth]&((1<<(8-sizeWidth))-1));for(let i=1;i<sizeWidth;i++)value=value*256n+BigInt(bytes[at+idWidth+i]);
  assert.ok(value<(1n<<BigInt(7*sizeWidth))-1n,'Fixture rewrite expects finite input sizes.');
  const body=at+idWidth+sizeWidth,end=body+Number(value);assert.ok(end<=bytes.length);return{id,at,idWidth,sizeWidth,body,end};
}
function children(bytes,start=0,end=bytes.length){const out=[];for(let at=start;at<end;){const h=header(bytes,at);assert.ok(h.end<=end);out.push(h);at=h.end;}return out;}
function segmentParts(bytes){const top=children(bytes),segment=top.find(h=>h.id===0x18538067);assert.ok(segment);return{
  prefix:bytes.subarray(0,segment.at),parts:children(bytes,segment.body,segment.end).map(h=>({id:h.id,bytes:bytes.subarray(h.at,h.end),body:bytes.subarray(h.body,h.end)}))};}
function unknownClusterSizes(bytes,{unknownSegment=true}={}){
  const out=Buffer.from(bytes),top=children(out),segment=top.find(h=>h.id===0x18538067);assert.ok(segment);let clusters=0;
  const mark=h=>{const at=h.at+h.idWidth;out[at]=(1<<(9-h.sizeWidth))-1;out.fill(255,at+1,at+h.sizeWidth);};
  for(const h of children(out,segment.body,segment.end))if(h.id===0x1f43b675){mark(h);clusters++;}
  assert.ok(clusters>0);if(unknownSegment)mark(segment);return out;
}
const ebmlHeader=()=>element(0x1a45dfa3,element(0x4282,Buffer.from('matroska')));
const streamingFile=(parts,unknownSegment=true)=>Buffer.concat([ebmlHeader(),unknownSegment?unknownElement(0x18538067,Buffer.concat(parts),8):element(0x18538067,Buffer.concat(parts))]);
const cluster=parts=>unknownElement(0x1f43b675,Buffer.concat([element(0xe7,uint(0)),...parts]));
module.exports={element,uint,size,idBytes,header,children,segmentParts,unknownElement,unknownClusterSizes,ebmlHeader,streamingFile,cluster};
