"""Independent test-only projection of the earlier twin-source decoder receipt.

The old per-stream PCM and picture-row *digests* exist, not the old raw pipes.
Keep that distinction and require independent file/probe evidence.
"""
import importlib.util
import re
from pathlib import Path

p = Path(__file__).resolve().with_name('decoded-witness.py')
spec = importlib.util.spec_from_file_location('finite_mp4_decode', p)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

SOURCE = '2383de2ca90a13dfccbc081e6d0211424e01b7af44ef1720290307c38faf346d'
OUTPUT = '39b8e3baa2f620a4979d79d7e87036ffacee6df4c91edb8c35e07b15acd46a88'
ROLE = 'mp4-mapped-ordered-two-stereo48-tracks-component-only'
PAIR = {'source': {'sha256':SOURCE, 'bytes':84922}, 'output': {'sha256':OUTPUT, 'bytes':85263}}
OLD = {'oracle-marked-r02.py':'44a26fb3246457056e368fa43a0b7e08ceb04ca1bd3a9ea1303c656f3089ec0e',
       'oracle-er98jeu9/report.json':'47929992dfccc159d3094d31348b2f97bf124d714a16533f4948f9863d2714e9',
       'oracle-er98jeu9/twins-source.stdout':'184c093dea2cf93bdac160d11c944e38130c3d9fb10cbbeaa0d7c9053ba5375a',
       'oracle-er98jeu9/twins-source.stderr':core.EMPTY}

def need(value):
    if not value:
        raise core.WitnessUnknown('Missing or unbound prior source evidence.')


def old_source(older_root):
    """Read a fixed finite input scope, not an arbitrary report-provided pathname."""
    need(__debug__)
    root=Path(older_root)
    def read(name,cap):
        return core.raw(root/name,cap,OLD[name])
    read('oracle-marked-r02.py',16384)
    report=core.js(read('oracle-er98jeu9/report.json',32768))
    probe=core.js(read('oracle-er98jeu9/twins-source.stdout',262144))
    read('oracle-er98jeu9/twins-source.stderr',4096)
    media=core.raw(root/'attempt-VLadVV/twins-swapped/source.mp4',131072,SOURCE)
    need(len(media)==PAIR['source']['bytes'] and report['status']=='passed')
    prior=report['cases']['twins'][0]
    need(prior['fileSha256']==SOURCE and len(prior['rows'])==3)
    physical=core.physical(media,probe)
    require_rows=zip(physical['tracks'], prior['rows'], strict=True)
    tracks=[]
    for n,(observed,row) in enumerate(require_rows,1):
        facts=observed['semantic']
        need(facts['track']==row['track']==n and row['samples']==facts['packetCount'])
        need(facts['language']==row['language'] and facts['default']==row['enabled'])
        sec, ticks, unity = row['edit']
        need(unity==65536 and facts['semanticEdit']==[sec,str(core.F(ticks,row['scale']))])
        need(row['scale']==observed['observedMediaClock'])
        if n==1:
            need(row['comparedFrames']==56 and facts['packetCount']==56 and core.HEX.fullmatch(row['decodedFrameRowsSha256']))
            tracks.append({'kind':'video','id':n,'frames':row['comparedFrames'],
                           'rowDigest':row['decodedFrameRowsSha256'],'edit':facts['semanticEdit']})
        else:
            rate,channels,config=row['sourceSpecificConfig']
            need((rate,channels)==(48000,2) and (facts['rate'],facts['channels'],facts['codecConfig'])==(rate,channels,config))
            need(facts['audioSamples']==row['decodedSampleFrames']==88176 and row['skip']==1024)
            need(core.HEX.fullmatch(row['pcmSha256']) and len(set(row['channelHashes']))==2 and len(row['channelHashes'])==2
                 and all(core.HEX.fullmatch(x) for x in row['channelHashes']))
            tracks.append({'kind':'audio','id':n,'sampleFrames':row['decodedSampleFrames'],
                           'rate':rate,'channels':channels,'pcmSha256':row['pcmSha256'],
                           'channelHashes':row['channelHashes'],'language':facts['language'],
                           'default':facts['default'],'edit':facts['semanticEdit']})
    need(tracks[1]['pcmSha256']!=tracks[2]['pcmSha256'])
    return {'role':ROLE,'source':PAIR['source'],'sourceRawDecodeRetained':False,
            'historicalOracleSha256':OLD['oracle-er98jeu9/report.json'],'tracks':tracks}


def compare_tracks(source, target):
    """Check ordered PCM identities, not just shape, count, or a reported swap."""
    need(source.get('role')==target.get('role')==ROLE)
    need(source.get('source')==PAIR['source'] and target.get('output')==PAIR['output'])
    a,b=source['tracks'],target['tracks']
    need(len(a)==len(b)==3 and [t['id'] for t in a]==[1,2,3] and [t['id'] for t in b]==[1,2,3])
    for x,y in zip(a,b,strict=True):
        need(x['kind']==y['kind'] and x['edit']==y['edit'])
    need(a[0]['kind']=='video' and a[0]['frames']==b[0]['frames']==56)
    for tracks in (a,b):
        need(core.HEX.fullmatch(tracks[0]['rowDigest']))
        for x in tracks[1:]:
            need(x['kind']=='audio' and x['rate']==48000 and x['channels']==2 and x['sampleFrames']==88176)
            need(core.HEX.fullmatch(x['pcmSha256']) and len(x['channelHashes'])==2
                 and all(core.HEX.fullmatch(h) for h in x['channelHashes']))
    video_equal=a[0]['rowDigest']==b[0]['rowDigest']
    for x,y in zip(a[1:],b[1:],strict=True):
        need(all(x[k]==y[k] for k in ('rate','channels','sampleFrames','language','default')))
    def full(x,y):
        return x['pcmSha256']==y['pcmSha256'] and x['channelHashes']==y['channelHashes']
    mapped=[full(x,y) for x,y in zip(a[1:],b[1:],strict=True)]
    crossed=[full(a[1],b[2]),full(a[2],b[1])]
    return {'wholePictureRowsMatchEarlierDigest':video_equal,'mappedFullPcmMatches':mapped,
            'oppositeTrackFullPcmMatches':crossed,'equalOrderedAudio':all(mapped),
            'fullySwappedAudio':mapped==[False,False] and all(crossed),
            'sourceRawDecodeRetained':False,'comparisonRole':ROLE}


def target_tracks(media, probe, pipes, stem):
    """Recompute all four raw roles; do not take target digests from a verdict string."""
    need(len(media)==PAIR['output']['bytes'] and core.sha(media)==OUTPUT)
    need(set(probe)=={'programs','stream_groups','chapters','streams','format','packets'} and
         all(not probe[x] for x in ('programs','stream_groups','chapters')))
    need(probe['format']['filename']==stem and probe['format']['size']==str(len(media))
         and len(probe['streams'])==3 and len(probe['packets'])==232)
    physical=core.physical(media,probe)
    need(len(physical['tracks'])==3 and len(pipes)==3)
    tracks=[]
    for n,(tr,raw_pipe) in enumerate(zip(physical['tracks'],pipes,strict=True),1):
        v=core.decoded_value(raw_pipe,tr);s=tr['semantic'];need(s['track']==n)
        if n==1:
            need(s['kind']=='video' and v['frames']==56)
            lines=[line for line in raw_pipe.decode('ascii').splitlines() if line and not line.startswith('#')]
            digest=core.sha(('\n'.join(lines)+'\n').encode('ascii'))
            tracks.append({'kind':'video','id':n,'frames':v['frames'],'rowDigest':digest,'edit':s['semanticEdit']})
        else:
            need(s['kind']=='audio' and s['audioSamples']==v['sampleFrames'] and s['packetCount']==88)
            tracks.append({'kind':'audio','id':n,'sampleFrames':v['sampleFrames'],
                           'rate':s['rate'],'channels':s['channels'],'pcmSha256':v['pcmSha256'],
                           'channelHashes':v['channelSha256'],'language':s['language'],
                           'default':s['default'],'edit':s['semanticEdit']})
    return {'role':ROLE,'output':PAIR['output'],'tracks':tracks}


def fixed_pipe_commands(calls):
    """Require one read-only probe and one complete decode for each elected track."""
    names=['output-probe','output-decode-0','output-decode-1','output-decode-2']
    need([c['name'] for c in calls]==names)
    rv=re.compile(r'/proc/self/fd/([1-9][0-9]{0,5})\Z')
    media=calls[0]['argv'][-1]
    need(rv.fullmatch(media) is not None)
    probeexe=calls[0]['argv'][0];decodeexe=calls[1]['argv'][0]
    need(rv.fullmatch(probeexe) and rv.fullmatch(decodeexe) and len({probeexe,decodeexe,media})==3)
    need(calls[0]['argv']==[probeexe,'-v','error','-f','mov','-protocol_whitelist','file','-show_format','-show_streams',
        '-show_packets','-show_data_hash','sha256','-show_chapters','-show_programs','-show_stream_groups','-of','json',media])
    for i,c in enumerate(calls[1:]):
        tail=['-c:a','pcm_s32le','-f','s32le','pipe:1'] if i else ['-fps_mode','passthrough','-pix_fmt','yuv420p','-f','framemd5','pipe:1']
        need(c['argv']==[decodeexe,'-nostdin','-v','error','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe',
            '-threads','1','-f','mov','-i',media,'-map','0:'+str(i),'-threads','1',*tail])
    need(all(type(c['exit']) is int and c['exit']==0 and c['stderrSha256']==core.EMPTY
             and core.HEX.fullmatch(c['stdoutSha256']) for c in calls))
    return media
