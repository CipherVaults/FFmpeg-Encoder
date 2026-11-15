'use strict';
// Inert native metadata for injected collectors, not playable media proof.
function size(n){for(let width=1;width<=8;width++)if(BigInt(n)<(1n<<BigInt(width*7))-1n){let v=BigInt(n)|(1n<<BigInt(width*7));const b=Buffer.alloc(width);for(let i=width-1;i>=0;i--){b[i]=Number(v&255n);v>>=8n;}return b;}throw Error('fixture size');}
function element(id,body){const h=Buffer.from(id.toString(16).padStart(id>255?Math.ceil(id.toString(16).length/2)*2:2,'0'),'hex');return Buffer.concat([h,size(body.length),body]);}
function uint(n){let v=BigInt(n),hex=v.toString(16);return Buffer.from(hex.padStart(Math.ceil(hex.length/2)*2,'0'),'hex');}
const u=(id,n)=>element(id,uint(n)),s=(id,v)=>element(id,Buffer.from(v,'utf8'));
const TEST_AVCC=Buffer.from([1,100,0,40,255]);
const codecId=codec=>/^pcm_s\d+le$/.test(codec)?'A_PCM/INT/LIT':/^pcm_s\d+be$/.test(codec)?'A_PCM/INT/BIG':/^pcm_f\d+le$/.test(codec)?'A_PCM/FLOAT/IEEE':({h264:'V_MPEG4/ISO/AVC',hevc:'V_MPEGH/ISO/HEVC',av1:'V_AV1',aac:'A_AAC',ass:'S_TEXT/ASS',subrip:'S_TEXT/UTF8'}[codec]||'V_MPEG4/ISO/AVC');
function matroskaFixture(probe,paddedBytes=0){
  const tracks=probe.streams.filter(s=>s.codec_type!=='attachment').map((t,i)=>element(0xae,Buffer.concat([u(0xd7,t.id?Number(BigInt(t.id)):i+1),u(0x73c5,i+1),u(0x83,{video:1,audio:2,subtitle:17}[t.codec_type]||17),
    u(0xb9,1),u(0x88,t.disposition?.default||0),u(0x55aa,t.disposition?.forced||0),s(0x22b59c,t.tags?.language||'und'),s(0x86,codecId(t.codec_name)),
    ...(t.codec_name==='h264'&&t.extradata_hash==='SHA256:'+require('node:crypto').createHash('sha256').update(TEST_AVCC).digest('hex')?[element(0x63a2,TEST_AVCC)]:[]),
    ...(t.codec_type==='video'?[element(0xe0,Buffer.concat([u(0xb0,t.width||2),u(0xba,t.height||2)]))]:[])])));
  let b=Buffer.concat([element(0x1a45dfa3,Buffer.concat([u(0x4286,1),u(0x42f7,1),u(0x42f2,4),u(0x42f3,8),s(0x4282,'matroska'),u(0x4287,4),u(0x4285,2)])),
    element(0x18538067,Buffer.concat([element(0x1549a966,u(0x2ad7b1,1000000)),element(0x1654ae6b,Buffer.concat(tracks))]))]);
  if(paddedBytes){for(let n=Math.max(0,paddedBytes-b.length-10);n<paddedBytes-b.length;n++){const padding=element(0xec,Buffer.alloc(n));if(b.length+padding.length===paddedBytes)return Buffer.concat([b,padding]);}throw Error('fixture padding');}return b;
}
module.exports={matroskaFixture,element,uint,size,TEST_AVCC};
