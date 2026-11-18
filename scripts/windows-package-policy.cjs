'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {safeMember}=require('./windows-ffmpeg-startup.cjs');
const GIB=1024n**3n;
const MAX_EXPANDED=2n*GIB;
const LISTING_CODES=Object.freeze(['ERR_ZIP_INPUT','ERR_ZIP_COUNT','ERR_ZIP_FIELD_FORMAT','ERR_ZIP_FIELD_UNKNOWN','ERR_ZIP_FIELD_DUPLICATE','ERR_ZIP_PATH','ERR_ZIP_DUPLICATE','ERR_ZIP_SIZE','ERR_ZIP_ENCRYPTION','ERR_ZIP_ATTRIBUTES','ERR_ZIP_DIRECTORY_SIZE','ERR_ZIP_FOLDER','ERR_ZIP_EXPANDED','ERR_ZIP_ANCESTOR','ERR_ZIP_REQUIRED','ERR_ZIP_PINNED_CONTEXT','ERR_ZIP_PINNED_INVENTORY']);
function listingNeed(ok,code){if(!ok){const error=new Error('Pinned ZIP listing refused.');error.code=code;throw error;}}
// Only the hash-verified Electron44.7.0 Windows ZIP admits these literal FAT renderings.
// Independent central-directory evidence has73 ordinary files, no links/directories.
// Its creator field is FAT despite Unix-like high attribute words; do not interpret
// arbitrary X/U/P/etc letters as safe, or use this exception for a built ZIP.
const ELECTRON_ARCHIVE_SHA='eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c';
const ELECTRON_INVENTORY_SHA='e6e039893782a298f9c4645d5aa33370c291cadad83686298b427790ef0c0619';
// Policy ceilings, not observed archive sizes. Refuse rather than expand them.
function inspectListing(text, required, pinnedElectron) {
  listingNeed(typeof text==='string' && Buffer.byteLength(text)<=2*1024*1024 && !text.includes('\0'),'ERR_ZIP_INPUT');
  const blocks=text.trim().split(/\r?\n\r?\n/);listingNeed(blocks.length && blocks.length<=2048,'ERR_ZIP_COUNT');
  const allowed=new Set(['Path','Folder','Size','Packed Size','Modified','Created','Accessed','Attributes','Encrypted','Comment','CRC','Method','Characteristics','Host OS','Version','Volume Index','Offset']);
  const seen=new Map(),pinnedRows=[];let total=0n;
  for(const block of blocks){const row={};for(const line of block.split(/\r?\n/)){const m=/^([^=]+?) = (.*)$/.exec(line);listingNeed(m,'ERR_ZIP_FIELD_FORMAT');listingNeed(allowed.has(m[1]),'ERR_ZIP_FIELD_UNKNOWN');listingNeed(!Object.hasOwn(row,m[1]),'ERR_ZIP_FIELD_DUPLICATE');row[m[1]]=m[2];}
    let name;try{name=safeMember(row.Path);}catch{listingNeed(false,'ERR_ZIP_PATH');}listingNeed(!seen.has(name.toLowerCase()),'ERR_ZIP_DUPLICATE');
    listingNeed(/^[0-9]{1,12}$/.test(row.Size),'ERR_ZIP_SIZE');listingNeed(row.Encrypted==='-','ERR_ZIP_ENCRYPTION');
    if(pinnedElectron) {
      const expected=name==='electron.exe'?'vXPUM 81A40000':'XU 81A40000';
      listingNeed(row.Attributes===expected && row['Host OS']==='FAT' && row.Folder==='-','ERR_ZIP_ATTRIBUTES');
      pinnedRows.push({name,size:Number(row.Size),attributes:row.Attributes});
    } else listingNeed(typeof row.Attributes==='string' && /^[DRAHS_ ]*$/.test(row.Attributes),'ERR_ZIP_ATTRIBUTES');
    const directory=row.Attributes.includes('D');listingNeed(!directory || row.Size==='0','ERR_ZIP_DIRECTORY_SIZE');
    if(row.Folder!==undefined)listingNeed(row.Folder===(directory?'+':'-'),'ERR_ZIP_FOLDER');
    total+=BigInt(row.Size);listingNeed(total<=MAX_EXPANDED,'ERR_ZIP_EXPANDED');
    seen.set(name.toLowerCase(),{name,directory,size:Number(row.Size)});
  }
  for(const row of seen.values())for(let parent=path.posix.dirname(row.name);parent!=='.';parent=path.posix.dirname(parent)){const ancestor=seen.get(parent.toLowerCase());listingNeed(!ancestor || ancestor.directory && ancestor.name===parent,'ERR_ZIP_ANCESTOR');}
  for(const name of required)listingNeed(seen.has(name.toLowerCase()) && !seen.get(name.toLowerCase()).directory,'ERR_ZIP_REQUIRED');
  if(pinnedElectron) {
    pinnedRows.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    listingNeed(pinnedRows.length===73 && createHash('sha256').update(JSON.stringify(pinnedRows)).digest('hex')===ELECTRON_INVENTORY_SHA,'ERR_ZIP_PINNED_INVENTORY');
    // ZIP file paths imply directories that the extracted-tree walk must see.
    // Derive only those exact ancestors; no wildcard or extra directory allowance.
    for(const row of [...seen.values()])for(let parent=path.posix.dirname(row.name);parent!=='.';parent=path.posix.dirname(parent)) {
      if(!seen.has(parent.toLowerCase()))seen.set(parent.toLowerCase(),{name:parent,directory:true,size:0});
    }
  }
  return {entries:[...seen.values()],expandedBytes:total};
}
function inspectElectronListing(text,required=['electron.exe','version','LICENSE','LICENSES.chromium.html']) { return inspectListing(text,required,false); }
function inspectPinnedElectronListing(text,archive) {
  listingNeed(archive?.sha256===ELECTRON_ARCHIVE_SHA && archive?.sizeBytes===158293649,'ERR_ZIP_PINNED_CONTEXT');
  return inspectListing(text,['electron.exe','version','LICENSE','LICENSES.chromium.html'],true);
}
function requiredFree(archives) {return 27n*GIB + archives.reduce((n,p)=>n+BigInt(p.sizeBytes),0n) + 16n*GIB;}
function reportSummary(build,identity){
  assert(build.status==='build-verified-runtime-acceptance-pending');
  const pin=x=>{assert(/^[a-f0-9]{64}$/.test(x.sha256) && Number.isSafeInteger(x.sizeBytes) && x.sizeBytes>0);return {sizeBytes:x.sizeBytes,sha256:x.sha256};};
  assert(/^[a-f0-9]{40}$/.test(identity.head)&&/^\d+$/.test(identity.runId)&&identity.attempt==='1');
  return {schema:1,head:identity.head,runId:identity.runId,attempt:identity.attempt,state:'WINDOWS_PACKAGE_VERIFIED_INERT',asar:pin(build.asar),executable:pin(build.executable),zip:pin(build.zip),sourceFiles:build.sources.length,resourceFiles:build.resources.length,packageFiles:build.packageInventory.length,gui:'not-run',media:'not-run',gpu:'not-run',distribution:'report-only'};
}
module.exports={inspectPinnedElectronListing,LISTING_CODES,inspectElectronListing,requiredFree,reportSummary};
