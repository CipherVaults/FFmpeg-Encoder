'use strict';
const {isoEdit,atom}=require('./native-inventory-collector.cjs');
function withMetadata(bytes,entries,{index=1,extra=Buffer.alloc(0),namespace='mdta',dataVersion=0}={}){
  const header=Buffer.alloc(8);header.writeUInt32BE(entries.length,4);
  const keys=entries.map(e=>{const key=Buffer.from(e.key),b=Buffer.alloc(8);b.writeUInt32BE(8+key.length);b.write(namespace,4,'ascii');return Buffer.concat([b,key]);});
  const items=entries.map((e,i)=>{const type=Buffer.alloc(4);type.writeUInt32BE(index+i);const data=Buffer.alloc(8);data[0]=dataVersion;data[3]=e.dataType??1;data.writeUInt32BE(e.locale??0,4);
    return atom(type.toString('latin1'),atom('data',Buffer.concat([data,Buffer.from(e.value)])));});
  return isoEdit(bytes,'trak',h=>Buffer.concat([h,atom('meta',Buffer.concat([Buffer.alloc(4),atom('keys',Buffer.concat([header,...keys])),atom('ilst',Buffer.concat([...items,extra]))]))]));
}
module.exports={withMetadata};
