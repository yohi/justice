import {isLowercaseSha256Hex,isSafeIdentifier,S1A_LIMITS,S1aValidationError,type OwnerManifest,type ApprovedArtifactRef,type ArtifactKind} from './contract.js';
import {parseStrictJson} from './strict-json.js';
export function isRecord(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
export function hasExactKeys(value:unknown,required:readonly string[],optional:readonly string[]=[]):value is Record<string,unknown>{
 if(!isRecord(value))return false;const keys=Object.keys(value);return required.every(k=>Object.hasOwn(value,k))&&keys.every(k=>required.includes(k)||optional.includes(k));
}
/** Portable lexical validation. The native filesystem adapter separately rejects symlink components. */
export function isSafeRelativePath(v:unknown):v is string {
 return typeof v==='string'&& v.length>0&&v.length<=S1A_LIMITS.relativePathLength&&!v.startsWith('/')&&!v.includes('\\')&&!v.includes('\0')&&v.split('/').every(seg=>seg!==''&&seg!=='.'&&seg!=='..')&&!v.includes(':');
}
function fail():never{throw new S1aValidationError('MANIFEST_INVALID');}
export function parseOwnerManifest(raw:Uint8Array):OwnerManifest {
 try{
  const v=parseStrictJson(raw,S1A_LIMITS.manifestBytes);
  if(!hasExactKeys(v,['schemaVersion','manifestId','artifacts'])||v.schemaVersion!=='justice-s1a-manifest-v1'||!isSafeIdentifier(v.manifestId)||!Array.isArray(v.artifacts)||v.artifacts.length===0||v.artifacts.length>S1A_LIMITS.manifestEntries)fail();
  const artifactRecords:ApprovedArtifactRef[]=[];const ids=new Set<string>(),paths=new Set<string>();
  for(const entry of v.artifacts){
   if(!hasExactKeys(entry,['artifactId','kind','revision','digest','relativePath','scopeKey','approvalRef'],['parentId'])||!isSafeIdentifier(entry.artifactId)||!['design','plan','task','ac'].includes(String(entry.kind))||!isSafeIdentifier(entry.revision)||!isSafeRelativePath(entry.relativePath)||!isSafeIdentifier(entry.scopeKey)||typeof entry.approvalRef!=='string'||entry.approvalRef.length===0||entry.approvalRef.length>4096||(entry.parentId!==undefined&&!isSafeIdentifier(entry.parentId))||!hasExactKeys(entry.digest,['algorithm','hex'])||entry.digest.algorithm!=='sha256'||!isLowercaseSha256Hex(entry.digest.hex))fail();
   if(ids.has(entry.artifactId)||paths.has(entry.relativePath))fail();ids.add(entry.artifactId);paths.add(entry.relativePath);
   artifactRecords.push(entry as unknown as ApprovedArtifactRef);
  }
  const byId=new Map(artifactRecords.map(x=>[x.artifactId,x]));const parents:Record<ArtifactKind,ArtifactKind|null>={design:null,plan:'design',task:'plan',ac:'task'};
  if(artifactRecords.filter(x=>x.kind==='design').length!==1)fail();
  for(const ref of artifactRecords){
   const needed=parents[ref.kind];
   if(needed===null){if(ref.parentId!==undefined)fail();}
   else if(ref.parentId===undefined||byId.get(ref.parentId)?.kind!==needed)fail();
  }
  return {schemaVersion:'justice-s1a-manifest-v1',manifestId:v.manifestId as string,artifacts:artifactRecords};
 }catch{throw new S1aValidationError('MANIFEST_INVALID');}
}
