import {createHash} from 'node:crypto';
import {LIMITATIONS,S1A_LIMITS,isLowercaseSha256Hex,freezeLoaderResult,makeCheck,
 type LoaderInput,type LoaderResult,type LoaderCheck,type SelectedArtifactRef,type S1aReadOnlySource,type IdentityStatus} from './contract.js';
import {parseOwnerManifest} from './manifest.js';
import {parseTaskIntent,resolveTaskIntent} from './resolver.js';
const digest=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const stable=(checks:readonly LoaderCheck[]):IdentityStatus=>checks.some(x=>x.outcome==='MISMATCH')?'MISMATCH':checks.some(x=>x.outcome==='UNKNOWN')?'UNKNOWN':'MATCH';
export function makeS1aResult(digestMatch:boolean|'unknown',checks:readonly LoaderCheck[],manifestId?:string,refs:readonly SelectedArtifactRef[]=[]):LoaderResult {
 const status=stable(checks);
 // Fixed S1-a authority: no caller-provided approval or provenance fields.
 const result:LoaderResult={schemaVersion:'justice-s1a-result-v1',...(manifestId!==undefined?{manifestId}:{}),manifestDigestMatch:digestMatch,identityStatus:status,ownerAuthorityStatus:'NOT_PROVEN',ownerTrustPrecondition:'EXTERNAL_NOT_VERIFIED_BY_S1A',identityCandidateReady:status==='MATCH'&&digestMatch===true,eligibleBaseline:false,selectedRefs:refs,checks,limitations:LIMITATIONS};
 return freezeLoaderResult(result);
}
export async function loadS1aArtifacts(input:LoaderInput,source:S1aReadOnlySource):Promise<LoaderResult> {
 const preflight=(code:'MANIFEST_DIGEST_REQUIRED'|'MANIFEST_DIGEST_FORMAT_INVALID')=>makeS1aResult('unknown',[makeCheck('manifest','manifest_digest','UNKNOWN',code,'INPUT_INVALID')]);
 if(!input.expectedManifestSha256)return preflight('MANIFEST_DIGEST_REQUIRED');
 if(!isLowercaseSha256Hex(input.expectedManifestSha256))return preflight('MANIFEST_DIGEST_FORMAT_INVALID');
 let manifestRaw:Uint8Array;
 try{manifestRaw=await source.readInputFile(input.manifestPath,S1A_LIMITS.manifestBytes);if(manifestRaw.byteLength>S1A_LIMITS.manifestBytes)throw Error('over_limit');}
 catch{return makeS1aResult('unknown',[makeCheck('manifest','manifest_digest','UNKNOWN','MANIFEST_UNREADABLE','CHECK_INCOMPLETE')]);}
 const observedManifest=digest(manifestRaw);
 if(observedManifest!==input.expectedManifestSha256)return makeS1aResult(false,[makeCheck('manifest','manifest_digest','MISMATCH','MANIFEST_DIGEST_MISMATCH','OBSERVED_CONTRADICTION',input.expectedManifestSha256,observedManifest)]);
 let manifest;
 try{manifest=parseOwnerManifest(manifestRaw);}
 catch{return makeS1aResult(true,[makeCheck('manifest','schema','UNKNOWN','MANIFEST_INVALID','INPUT_INVALID')]);}
 const manifestId=manifest.manifestId;
 let intentRaw:Uint8Array;
 try{intentRaw=await source.readInputFile(input.intentPath,S1A_LIMITS.intentBytes);if(intentRaw.byteLength>S1A_LIMITS.intentBytes)throw Error('over_limit');}
 catch{return makeS1aResult(true,[makeCheck('task-intent','schema','UNKNOWN','TASK_INTENT_UNREADABLE','CHECK_INCOMPLETE')],manifestId);}
 let intent;
 try{intent=parseTaskIntent(intentRaw);}
 catch{return makeS1aResult(true,[makeCheck('task-intent','schema','UNKNOWN','TASK_INTENT_INVALID','INPUT_INVALID')],manifestId);}
 const resolved=resolveTaskIntent(manifest,intent);
 if(!resolved.complete)return makeS1aResult(true,resolved.checks,manifestId);
 const checks:LoaderCheck[]=[...resolved.checks];
 const refs:SelectedArtifactRef[]=resolved.refs.map(r=>({...{artifactId:r.artifactId,kind:r.kind,revision:r.revision,scopeKey:r.scopeKey},...(r.parentId?{parentId:r.parentId}:{}),expectedDigest:r.digest.hex,observedDigest:null,digestOutcome:'UNKNOWN'}));
 let totalBytes=0;
 for(const [index,ref] of resolved.refs.entries()){
  const remaining=S1A_LIMITS.totalArtifactBytes-totalBytes;
  const cap=Math.min(S1A_LIMITS.artifactBytes,remaining);
  let raw:Uint8Array;
  try{
   raw=await source.readArtifact(input.artifactsRoot,ref.relativePath,cap);
   if(raw.byteLength>cap){const e={kind:'over_limit'};throw e;}
  }catch(e){
   const kind=typeof e==='object'&&e!==null&&'kind' in e?e.kind:undefined;
   if(kind==='over_limit'){
    const total=remaining<S1A_LIMITS.artifactBytes;
    checks.push(makeCheck('artifact:'+ref.artifactId,total?'total_artifact_bytes':'artifact_digest','UNKNOWN',total?'TOTAL_ARTIFACT_LIMIT_EXCEEDED':'ARTIFACT_SIZE_LIMIT_EXCEEDED','CHECK_INCOMPLETE'));
    break;
   }
   checks.push(makeCheck('artifact:'+ref.artifactId,'artifact_digest','UNKNOWN','ARTIFACT_UNREADABLE','CHECK_INCOMPLETE'));
   continue;
  }
  totalBytes+=raw.byteLength;
  const observed=digest(raw);const match=observed===ref.digest.hex;
  refs[index]={...refs[index]!,observedDigest:observed,digestOutcome:match?'MATCH':'MISMATCH'};
  checks.push(makeCheck('artifact:'+ref.artifactId,'artifact_digest',match?'MATCH':'MISMATCH',match?'CHECK_MATCH':'ARTIFACT_DIGEST_MISMATCH',match?'IDENTITY_MATCH':'OBSERVED_CONTRADICTION',ref.digest.hex,observed));
 }
 if(checks.every(x=>x.outcome==='MATCH'))checks.push(makeCheck('manifest','reference','MATCH','IDENTITY_MATCH_WITH_AUTHORITY_LIMITATION','IDENTITY_MATCH'));
 return makeS1aResult(true,checks,manifestId,refs);
}
