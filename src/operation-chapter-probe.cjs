'use strict';
// Q06 component only. Consume original FFprobe JSON, not a normalized/cache/renderer
// object. No new inspection mode, output writer, remux route, or authority grant.
const {parseProbeJson}=require('./inspection.cjs');
const {clipChapters,CHAPTER_LIMIT}=require('./operation-chapters.cjs');
const fail=(code,msg)=>{throw Object.assign(new Error(msg),{code});};
const MAX_RAW_BYTES=2*1024*1024, FIELDS=['id','start','end'];
function clipMatroskaProbeChapters(raw, interval, targetTimeBase) {
  if(typeof raw!=='string'||!raw.length||raw.length>MAX_RAW_BYTES||Buffer.byteLength(raw)>MAX_RAW_BYTES)
    fail('CHAPTER_PROBE_LIMIT','Chapter extraction needs a bounded original FFprobe JSON report.');
  // Retain the existing duplicate-key and provenance checks; in particular, do not
  // replace the shared parser with a permissive reviver that silently merges keys.
  const p=parseProbeJson(raw,'Chapter metadata inspection');
  if(p.format?.format_name!=='matroska,webm')fail('CHAPTER_PROBE_FAMILY','Raw Matroska chapter evidence required.');
  if(!Array.isArray(p.chapters)||p.chapters.length>CHAPTER_LIMIT)
    fail('CHAPTER_PROBE_LIMIT','Missing or excessive original chapter records.');
  if(p.chapters.length) {
    // ES2024 JSON source context preserves the *lexeme*. Parse only this bounded
    // component report twice; unrelated application inspection and caches are unchanged.
    // Mark numeric primitives privately, so a JSON object cannot impersonate one.
    const rawNumbers=new WeakMap();
    let original;
    try {
      original=JSON.parse(raw,(key,value,ctx)=>{
        if(typeof value==='number'&&FIELDS.includes(key)){
          const mark={};rawNumbers.set(mark,ctx?.source);return mark;
        }
        return value;
      });
    } catch {fail('CHAPTER_PROBE_INTEGER','Cannot recover exact numeric chapter fields.');}
    p.chapters.forEach((chapter,i)=>{
      if(!chapter||Array.isArray(chapter)||typeof chapter!=='object')fail('CHAPTER_PROBE_INTEGER','Missing chapter record.');
      for(const k of FIELDS) {
        const lex=rawNumbers.get(original.chapters[i]?.[k]);
        // AVChapter id/start/end are printed as signed int64. Negative Matroska
        // id may represent an unsigned UID with its high bit set; never guess.
        if(typeof lex!=='string'||!/^-?(?:0|[1-9]\d{0,18})$/.test(lex))fail('CHAPTER_PROBE_INTEGER','Original integral chapter id and times are required (no rounded, quoted or exponent form).');
        const n=BigInt(lex);
        if(n<-(1n<<63n)||n>=(1n<<63n)||k==='id'&&n<=0n)fail('CHAPTER_PROBE_INTEGER','Unqualified chapter identifier or time outside signed-64 evidence.');
        chapter[k]=lex;
      }
    });
  }
  return clipChapters({chapters:p.chapters,interval,targetTimeBase});
}
module.exports={clipMatroskaProbeChapters};
