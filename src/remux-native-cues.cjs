'use strict';
const {ToolError}=require('./process-runner.cjs'),{packetSync}=require('./remux-native-sync.cjs');
const fail=(field,why)=>{throw new ToolError('REMUX_NATIVE_'+(field==='BlockFlags'?'BLOCK_FLAGS':field.toUpperCase()),'Matroska '+field+': '+why);};
async function matroskaSeeking({meta,tracks,integer}){
  const nodes=meta.nodes,all=type=>nodes.filter(n=>n.type===type),one=(p,type,field,required=false)=>{const a=p.children.filter(n=>n.type===type);if(a.length>1||required&&!a.length)fail(field,'required unique native index field is missing or duplicated.');return a[0];};
  const value=async(p,type,field,required=false,fallback=0n)=>{const n=one(p,type,field,required);return n?integer(n):fallback;};
  const segments=all('0x18538067');if(segments.length!==1)fail('SeekHead','one segment is required for native seek offsets.');const segment=segments[0],top=segment.children;
  for(const head of all('0x114d9b74')){const seeks=head.children.filter(n=>n.type==='0x4dbb');if(!seeks.length)fail('SeekHead','a native seek head must contain a seek entry.');
    for(const seek of seeks){if(seek.children.filter(n=>n.type==='0x53ab').length!==1||seek.children.filter(n=>n.type==='0x53ac').length!==1)fail('Seek','one ID and one position are required.');}
    for(const seek of seeks){
    const id=one(seek,'0x53ab','SeekID',true),position=await value(seek,'0x53ac','SeekPosition',true);if(id.end-id.body<1||id.end-id.body>4)fail('SeekID','invalid target element ID extent.');
    const bytes=await meta.read(id.body,id.end-id.body),type='0x'+bytes.toString('hex'),target=top.find(n=>BigInt(n.start-segment.body)===position);
    if(!target)fail('SeekPosition','does not resolve to the start of a segment child.');if(target.type!==type)fail('SeekID','does not name the element at its native seek position.');
  }}
  const packets=meta.ebmlWalk.packets,byTrack=new Map(),indexed=new Map();
  for(const t of tracks){const p=packets.filter(p=>p.trackId===t.trackId);byTrack.set(t.trackId,p);indexed.set(t.trackId,new Set());
    if(t.kind!=='video')continue;
    const privateNode=t.node.children.find(n=>n.type==='0x63a2');if(privateNode&&privateNode.end-privateNode.body>65536)fail('CodecPrivate','access-point configuration exceeds its explicit full-extent budget.');
    const config=privateNode?await meta.read(privateNode.body,privateNode.end-privateNode.body):null;
    for(const packet of p){if(packet.lacing)fail('BlockFlags','video lacing has no verified native packet ordinal mapping.');const coded=await packetSync({codec:t.stream.codec_name,config,read:meta.read,start:packet.body,end:packet.end,code:'REMUX_NATIVE_BLOCK_FLAGS',details:true});
      if(packet.key!==coded.key)fail('BlockFlags','keyframe declaration differs from the coded picture.');if(packet.discardable&&coded.reference!==false)fail('BlockFlags','discardable permission is not proved by a non-reference coded picture.');}
  }
  const cues=all('0x1c53bb6b');if(cues.length>1)fail('Cues','multiple cue tables have no unique seek selection.');const previous=new Map();
  for(const table of cues)for(const point of table.children.filter(n=>n.type==='0xbb')){
    if(point.children.filter(n=>n.type==='0xb3').length!==1)fail('CuePoint','one cue time is required.');
    const time=await value(point,'0xb3','CueTime',true),positions=point.children.filter(n=>n.type==='0xb7');if(!positions.length)fail('CuePoint','no native track positions.');const pointTracks=new Set();
    for(const position of positions){if(position.children.filter(n=>n.type==='0xf7').length!==1||position.children.filter(n=>n.type==='0xf1').length!==1)fail('CueTrackPositions','one track and one cluster position are required.');
      const track=String(await value(position,'0xf7','CueTrack',true)),cluster=await value(position,'0xf1','CueClusterPosition',true),candidateTrack=tracks.find(t=>t.trackId===track);
      if(!candidateTrack)fail('CueTrack','does not identify a native admitted track.');if(pointTracks.has(track))fail('CueTrackPositions','duplicate native cue track.');pointTracks.add(track);
      // Omitted audio still needs exact native locators, but contributes no
      // target seek coverage. Probe kind alone cannot authorize another native
      // TrackType; selected audio and every other non-video kind stay refused.
      if(candidateTrack.kind!=='video'&&!(candidateTrack.kind==='audio'&&candidateTrack.selected===false
        &&await value(candidateTrack.node,'0x83','CueTrack',true)===2n))fail('CueTrack','non-video cue packet ordinals have no proved target index/trim mapping.');
      const clusterNode=top.find(n=>n.type==='0x1f43b675'&&BigInt(n.start-segment.body)===cluster);if(!clusterNode)fail('CueClusterPosition','does not resolve to the start of a cluster.');
      let choices=(byTrack.get(track)||[]).filter(p=>p.cluster===clusterNode.start&&p.key);
      const relative=one(position,'0xf0','CueRelativePosition');if(relative){const offset=await integer(relative);choices=choices.filter(p=>BigInt(p.start-p.clusterBody)===offset);if(!choices.length)fail('CueRelativePosition','does not locate a keyframe block of the declared track.');}
      const number=one(position,'0x5378','CueBlockNumber');if(number){const ordinal=await integer(number);choices=choices.filter(p=>BigInt(p.number)===ordinal);if(!choices.length)fail('CueBlockNumber','does not locate the declared track block in the cluster.');}
      choices=choices.filter(p=>BigInt(p.pts)===time);if(choices.length!==1)fail('CueTime','does not uniquely identify a keyframe at this native timestamp.');const packet=choices[0];
      if(previous.has(track)&&time<=previous.get(track))fail('CueTime','native cue times are duplicated or run backwards.');previous.set(track,time);
      if(await value(position,'0xea','CueCodecState')!==0n)fail('CueCodecState','only the initial codec state has a verified target mapping.');
      const duration=one(position,'0xb2','CueDuration');if(duration&&(!packet.duration||await integer(duration)!==BigInt(packet.duration)))fail('CueDuration','does not equal the native indexed block duration.');
      if(position.children.some(n=>n.type==='0xdb'))fail('CueReference','dependent cue reference graphs have no proved rewritten target mapping.');
      indexed.get(track).add(packet.ordinal);
    }
  }
  return{streams:tracks.filter(t=>t.selected&&t.kind==='video').map(t=>({index:t.index,indexed:[...indexed.get(t.trackId)]}))};
}
module.exports={matroskaSeeking};
