"""Offline full H.264/AAC witnesses; no process, product verifier, or route."""
import hashlib, json, os, re, stat
from fractions import Fraction as F
from pathlib import Path
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(condition,message):
 if not condition:raise AssertionError(message)
def u(b,p,n,s=False):
 need(0<=p and p+n<=len(b),('integer',p,n,len(b)));return int.from_bytes(b[p:p+n],'big',signed=s)
def boxes(b,lo,hi):
 while lo<hi:
  n=u(b,lo,4);need(8<=n<=hi-lo,('box',lo,n,hi));yield b[lo+4:lo+8],lo+8,lo+n;lo+=n
 need(lo==hi,'box boundary')
def one(rows,t):
 r=[x for x in rows if x[0]==t];need(len(r)==1,('unique',t,len(r)));return r[0]
def inside(b,p):return list(boxes(b,p[1],p[2]))
def box(b,p,t):return one(inside(b,p),t)
def body(b,p,t=None):
 z=box(b,p,t) if t is not None else p
 return b[z[1]:z[2]]
def table(b,words,versions=(0,)):
 c=u(b,4,4);need(b[0] in versions and not any(b[1:4]) and 0<c<10000 and len(b)==8+4*c*words,('table',len(b),c,words))
 return [tuple(u(b,8+(i*words+k)*4,4,b[0]==1 and k==1) for k in range(words)) for i in range(c)]
def descs(b,start,end):
 while start<end:
  t=b[start];n=0;start+=1
  for j in range(4):
   x=u(b,start,1);start+=1;n=(n<<7)|(x&127)
   if x<128:break
  else:raise ValueError('descriptor bound')
  stop=start+n;need(stop<=end,('descriptor',stop,end));yield t,start,stop;start=stop
def codec_config(b):
 need(u(b,0,4)==0,'esds version')
 es=one(descs(b,4,len(b)),3);need(b[es[1]+2]==0,'ES flags')
 dec=one(descs(b,es[1]+3,es[2]),4);need(b[dec[1]:dec[1]+2]==b'\x40\x15','MPEG-4 audio decoder type')
 cs=one(descs(b,dec[1]+13,dec[2]),5);p=b[cs[1]:cs[2]];h=u(p,0,2)
 need(h>>11==2,'AAC LC coding')
 return {3:48000,4:44100}.get((h>>7)&15), (h>>3)&15, sha(p)

def physical(data,probe):
 top=list(boxes(data,0,len(data)));mdat=one(top,b'mdat');moov=one(top,b'moov');mvhd=body(data,moov,b'mvhd')
 assert u(mvhd,0,4)==0;movie=u(mvhd,12,4);assert movie>0
 st=[x for x in inside(data,moov) if x[0]==b'trak'];assert len(st)==len(probe['streams']) and 2<=len(st)<=4
 tracks=[];occupancy=[]
 for idx,(tr,s) in enumerate(zip(st,probe['streams'])):
  assert s['index']==idx
  md=box(data,tr,b'mdia');stbl=box(data,box(data,md,b'minf'),b'stbl');tb=inside(data,stbl)
  tk=body(data,tr,b'tkhd');mh=body(data,md,b'mdhd');ed=body(data,box(data,tr,b'edts'),b'elst')
  assert tk[0]==mh[0]==ed[0]==0 and len(ed)==20 and u(ed,4,4)==1 and u(ed,16,4)==65536
  scale=u(mh,12,4);duration=u(mh,16,4);media=u(ed,12,4,True);el=F(u(ed,8,4),movie)
  assert scale>0 and s['time_base']==f'1/{scale}'
  track=u(tk,12,4);group=u(tk,34,2);enabled=u(tk,0,4)&1;lang=''.join(chr(96+((u(mh,20,2)>>i)&31)) for i in (10,5,0))
  assert track==int(s['id'],16) and enabled==s['disposition']['default'] and lang==s['tags']['language']
  sz=body(data,stbl,b'stsz');count=u(sz,8,4);regular=u(sz,4,4)
  assert u(sz,0,4)==0 and 0<count<=10000 and len(sz)==12+(0 if regular else count*4)
  sizes=[regular]*count if regular else [u(sz,12+4*i,4) for i in range(count)]
  durs=expanded(table(body(data,stbl,b'stts'),2),count)
  ctts=[x for x in tb if x[0]==b'ctts'];assert len(ctts)<=1
  comp=expanded(table(body(data,ctts[0]),2,(0,1)),count) if ctts else [0]*count
  sync=set(x[0] for x in table(body(data,stbl,b'stss'),1)) if idx==0 else None
  assert len(durs)==len(comp)==count and sum(durs)==duration
  packets=[p for p in probe['packets'] if p['stream_index']==idx];assert len(packets)==count
  chunks=table(body(data,stbl,b'stco'),1);change=table(body(data,stbl,b'stsc'),3)
  assert change[0][0]==1 and [x[0] for x in change]==sorted(set(x[0]for x in change)) and all(0<n<=len(chunks) and z>0 and e==1 for n,z,e in change)
  j=0;t=0;step=0;rows=[]
  for i,(off,) in enumerate(chunks,1):
   if step+1<len(change) and change[step+1][0]==i:step+=1
   for _ in range(change[step][1]):
    p=packets[j];sz=sizes[j];d=durs[j]
    assert (int(p['pos']),int(p['size']))==(off,sz) and mdat[1]<=off<off+sz<=mdat[2]
    dig=sha(data[off:off+sz]);assert 'SHA256:'+dig==p['data_hash']
    assert (p['dts'],p['pts'],p['duration'])==(t-media,t+comp[j]-media,d)
    if sync is not None:assert ('K' in p['flags'])==((j+1) in sync)
    rows.append([str(F(t-media,scale)),str(F(t+comp[j]-media,scale)),str(F(d,scale)),p['flags'],sz,dig,p.get('side_data_list',[])])
    occupancy.append((off,sz));j+=1;t+=d;off+=sz
  assert j==count
  sd=box(data,stbl,b'stsd');assert u(data,sd[1],4)==0 and u(data,sd[1]+4,4)==1
  entry=list(boxes(data,sd[1]+8,sd[2]));assert len(entry)==1
  item=entry[0];lh=body(data,item)
  properties={'track':track,'group':group,'default':enabled,'language':lang,'kind':s['codec_type'],
    'semanticEdit':[str(el),str(F(media,scale))],'mediaDuration':str(F(duration,scale)),
    'disposition':s['disposition'],'handler':s['tags'].get('handler_name'),
    'rowSha256':sha(json.dumps(rows,separators=(',',':'),sort_keys=True).encode()),'packetCount':count}
  if idx==0:
   assert item[0]==b'avc1' and s['codec_name']=='h264' and s['codec_type']=='video'
   config=one(boxes(data,item[1]+78,item[2]),b'avcC')
   configsha=sha(body(data,config));assert 'SHA256:'+configsha==s['extradata_hash']
   assert (u(lh,24,2),u(lh,26,2))==(s['width'],s['height'])
   fields=['width','height','field_order','pix_fmt','sample_aspect_ratio','display_aspect_ratio','color_range','color_space','color_primaries','color_transfer','chroma_location']
   properties.update({k:s[k] for k in fields},codecConfig=configsha)
  else:
   assert item[0]==b'mp4a' and s['codec_name']=='aac' and s['profile']=='LC' and s['codec_type']=='audio' and u(lh,8,2)==0
   rate,ch,config=codec_config(body(data,one(boxes(data,item[1]+28,item[2]),b'esds')))
   assert rate==scale==int(s['sample_rate']) and ch==s['channels'] and 'SHA256:'+config==s['extradata_hash']
   assert u(lh,24,4)==rate<<16 and u(lh,16,2)==ch
   assert s['channel_layout']==('stereo' if ch==2 else 'mono')
   assert all(x==0 for x in comp) and all(x==1024 for x in durs[:-1]) and 0<durs[-1]<=1024
   assert media==1024 and el==F(s['duration_ts'],rate) and duration-media==s['duration_ts']
   properties.update(rate=rate,channels=ch,codecConfig=config,audioSamples=s['duration_ts'])
  w=dict(observedMediaClock=scale,observedNativeEditMediaTicks=media,semantic=properties)
  if idx==0:
   pictures=sorted((F(row[1]),F(row[2])) for row in rows)
   assert pictures[0][0]==0 and all(d>0 for _,d in pictures)
   assert all(x+d==n for (x,d),(n,_) in zip(pictures,pictures[1:]))
   assert sum(pictures[-1])==el
   w['pictureTimes']=pictures
  tracks.append(w)
 i=mdat[1]
 for off,z in sorted(occupancy):assert i==off;i+=z
 assert i==mdat[2]
 return dict(clock=movie,mdatBytes=mdat[2]-mdat[1],mdatSha256=sha(data[mdat[1]:mdat[2]]),tracks=tracks)
def decoded_value(raw,track):
 s=track['semantic']
 if s['kind']=='audio':
  ch=s['channels'];assert len(raw)==4*ch*s['audioSamples']
  channels=[sha(b''.join(raw[j:j+4]for j in range(c*4,len(raw),4*ch))) for c in range(ch)]
  assert len(set(channels))==ch
  return dict(pcmSha256=sha(raw),channelSha256=channels,sampleFrames=s['audioSamples'])
 vals=[x.split(',') for x in raw.decode().splitlines() if x and not x.startswith('#')]
 tb=[x.split(': ')[1] for x in raw.decode().splitlines() if x.startswith('#tb 0: ')];tb0,=tb;tick=F(tb0);rows=[]
 for v in vals:
  i,d,p,dt,sz=map(lambda x:int(x.strip()),v[:5]);assert i==0 and dt>0 and re.fullmatch(r'[0-9a-f]{32}',v[5].strip())
  assert sz==s['width']*s['height']*3//2
  rows.append([str(d*tick),str(p*tick),str(dt*tick),sz,v[5].strip()])
 assert len(rows)==s['packetCount'] and [(F(v[1]),F(v[2])) for v in rows]==track['pictureTimes'];return dict(frames=len(rows),normalizedDecodedRowsSha256=sha(json.dumps(rows,separators=(',',':')).encode()),observedDecodedClock=str(tick),rawFrameRowsSha256=sha(raw))
def cmp_decode(a,b):
 d=lambda x:{k:v for k,v in x.items() if k not in ('observedDecodedClock','rawFrameRowsSha256')}
 assert d(a)==d(b),'independent whole decoded witness differs'
def expanded(rows,count):
    result=[]
    for n,v in rows:
        assert 0<n<=count-len(result)
        result.extend([v]*n)
    assert len(result)==count
    return result

RUNTIME='dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13'
HEX=re.compile(r'[a-f0-9]{64}\Z')
EMPTY=sha(b'')
class WitnessUnknown(ValueError):
    """Absent, invalid, unsupported or unlinked independent evidence."""

def raw(path, cap, digest=None):
    if digest is not None: assert isinstance(digest,str) and HEX.fullmatch(digest)
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),'rb') as f:
        s=os.fstat(f.fileno()); stamp=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
        assert stat.S_ISREG(s.st_mode) and 0<=s.st_size<=cap
        b=f.read(s.st_size+1)
        assert len(b)==s.st_size and stamp(s)==stamp(os.fstat(f.fileno()))
    assert digest is None or sha(b)==digest
    return b

def js(b):
    def object_pairs(rows):
        res={}
        for k,v in rows:
            assert k not in res
            res[k]=v
        return res
    return json.loads(b.decode('utf-8','strict'),object_pairs_hook=object_pairs,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError('non-finite JSON')))

def get_calls(record):
    assert isinstance(record,list) and 1<=len(record)<=64
    out={}
    for row in record:
        key=row['name']
        assert re.fullmatch(r'[a-z0-9-]{1,64}',key) and key not in out
        assert type(row['exit']) is int
        argv=row['argv']
        assert isinstance(argv,list) and 1<=len(argv)<=96 and all(isinstance(x,str) and len(x)<=8192 for x in argv)
        out[key]=row
    return out

def pipe(record,paths,key,cap):
    c=record[key]; stdout,stderr=paths[key]
    assert c['exit']==0 and c['stderrSha256']==EMPTY
    data=raw(stdout,cap,c['stdoutSha256']);assert raw(stderr,4096,EMPTY)==b''
    if 'stdoutBytes' in c:assert len(data)==c['stdoutBytes'] and c['stderrBytes']==0
    return data,c['argv']

def witness(bundle,pins):
    assert __debug__
    target=js(raw(bundle['targetReport'],131072,pins['targetReport']))
    source=js(raw(bundle['sourceCalls'],131072,pins['sourceCalls']))
    label=bundle['label']; source_key=bundle['sourceStem']
    cases=[x for x in target['media'] if x['label']==label];assert len(cases)==1
    case=cases[0]
    assert case['published']['sha256']==pins['targetMedia']
    source_log,target_log=get_calls(source),get_calls(target['calls'])
    path_sets=[bundle['sourcePipes'],bundle['targetPipes']]
    log_sets=[source_log,target_log]
    rigs=[]
    for paths,log in zip(path_sets,log_sets):
        a,_=pipe(log,paths,'runtime-pre',32768); b,_=pipe(log,paths,'runtime-post',32768)
        assert a==b and sha(a)==pins['runtimeManifest']
        rig=js(a)
        assert rig['runtimeIdentity']==RUNTIME and len(rig['dependencies'])==7
        assert set(rig['pins'])=={'ffmpeg','ffprobe'}
        rigs.append(rig)
    assert rigs[0]==rigs[1]
    ff=rigs[0]['pins']['ffmpeg']['path'];fp=rigs[0]['pins']['ffprobe']['path']
    origin=[source_log[source_key+'-probe']['argv'][-1],case['published']['path']]
    assert all(isinstance(x,str) and x.startswith('/') and '\0' not in x for x in origin)
    raw_media=[raw(bundle[k],8*1024**2,pins[k]) for k in ('sourceMedia','targetMedia')]
    assert len(raw_media[1])==case['published']['bytes']
    pair={label:{'sha256':pins[key],'bytes':len(m)} for label,key,m in zip(('source','output'),('sourceMedia','targetMedia'),raw_media)}
    observed=[]
    for paths,log,stem,m,file in zip(path_sets,log_sets,(source_key,label+'-published'),raw_media,origin):
        probe,argv=pipe(log,paths,stem+'-probe',1536*1024)
        base=[fp,'-v','error','-protocol_whitelist','file']
        if argv[5:7]==['-f','mov']:base+=['-f','mov']
        base+=['-show_format','-show_streams','-show_packets','-show_data_hash','sha256']
        assert argv in [base+list(forms)+['-of','json',file] for forms in (
            ('-show_chapters','-show_programs','-show_stream_groups'),('-show_programs','-show_chapters','-show_stream_groups'))]
        p=js(probe);assert p['format']['filename']==file and p['format']['size']==str(len(m)) and all(not p[k] for k in ('chapters','programs','stream_groups'))
        assert 2<=len(p['streams'])<=3 and len(p['packets'])<=1500
        o=physical(m,p)
        assert len({t['semantic']['track'] for t in o['tracks']})==len(o['tracks'])
        for i,t in enumerate(o['tracks']):
            d,cmd=pipe(log,paths,stem+'-decode-'+str(i),4*1024**2)
            common=[ff,'-hide_banner','-nostdin','-v','error','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe','-threads','1','-f','mov','-i',file,'-map','0:'+str(i),'-threads','1']
            suffix=['-c:a','pcm_s32le','-f','s32le','pipe:1'] if i else ['-fps_mode','passthrough','-pix_fmt','yuv420p','-f','framemd5','pipe:1']
            assert cmd==common+suffix
            t['decoded']=decoded_value(d,t)
        observed.append(o)
    left,right=observed
    result={'pair':pair,'scope':'complete-offline-h264-aac-mp4-only','generalMetadataValidated':False,
        'executionAuthorized':False,'runtimeIdentity':RUNTIME,'sourceInvocationSha256':pins['sourceCalls'],
        'targetInvocationSha256':pins['targetReport'],'runtimeManifestSha256':pins['runtimeManifest'],
        'coverage':'ordered full decoded video frame rows and rational frame times; complete contiguous native-rate PCM with exact AAC edit length and priming',
        'trackInventory':[[[t['semantic']['track'],t['semantic']['kind']] for t in x['tracks']] for x in observed],
        'wholeMdatSha256':[left['mdatSha256'],right['mdatSha256']], 'movieClock':[left['clock'],right['clock']]}
    if len(left['tracks'])!=len(right['tracks']):return dict(result,verdict='different',reason='track-count')
    paired=[];different=False
    for l,r in zip(left['tracks'],right['tracks']):
        ls,rs=l['semantic'],r['semantic']
        assert ls['track']==rs['track'] and ls['kind']==rs['kind'], 'track mapping not proven'
        if ls['kind']=='audio':
            same=all(ls[k]==rs[k] for k in ('rate','channels','audioSamples','semanticEdit'))
        else:
            same=all(ls[k]==rs[k] for k in ('width','height','pix_fmt','semanticEdit'))
        try:cmp_decode(l['decoded'],r['decoded'])
        except AssertionError:same=False
        different |= not same
        keys=('rowSha256','codecConfig','packetCount','mediaDuration')
        paired.append({'trackId':rs['track'],'kind':rs['kind'],'packets':[ls['packetCount'],rs['packetCount']],
            'codedCorroborationEqual':all(ls[k]==rs[k] for k in keys),
            'rationalPacketSha256':[ls['rowSha256'],rs['rowSha256']],
            'rationalEdit':[ls['semanticEdit'],rs['semanticEdit']],'decoded':r['decoded'],
            'decodedSource':l['decoded'],'decodedAndPresentationEqual':same,
            'observedLanguage':[ls['language'],rs['language']],'observedDefault':[ls['default'],rs['default']]})
    return dict(result,verdict='different' if different else 'equal',tracks=paired)

def read_decoded_witness(bundle,pins):
    if not __debug__:raise WitnessUnknown('Optimized Python is not accepted.')
    try:return witness(bundle,pins)
    except (AssertionError,KeyError,IndexError,TypeError,AttributeError,OverflowError,ValueError,UnicodeError,OSError,RecursionError) as e:
        raise WitnessUnknown('Incomplete, unsupported, or mismatched independent witness.') from None
