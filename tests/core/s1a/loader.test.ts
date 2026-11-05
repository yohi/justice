import {describe,it,expect,vi} from 'vitest';
import {loadS1aArtifacts} from '../../../src/core/s1a/loader.js';
import {S1A_LIMITS} from '../../../src/core/s1a/contract.js';
import {s1aFixture,jsonBytes,sha256} from '../../helpers/s1a-fixtures.js';
describe('raw Manifest first/immutable non-elevating loader',()=>{
 it('missingDigestPerformsZeroReads and malformedDigestPerformsZeroReads',async()=>{
  const f=s1aFixture();const src={...f.source,readInputFile:vi.fn(f.source.readInputFile)};
  for(const [value,code] of [[undefined,'MANIFEST_DIGEST_REQUIRED'],['A'.repeat(64),'MANIFEST_DIGEST_FORMAT_INVALID']] as const){
   const r=await loadS1aArtifacts({...f.input,expectedManifestSha256:value},src);
   expect(r.identityStatus).toBe('UNKNOWN');expect(r.manifestDigestMatch).toBe('unknown');expect(r.checks[0]?.reasonCode).toBe(code);expect(r.selectedRefs).toEqual([]);
  }
  expect(src.readInputFile).not.toHaveBeenCalled();
 });
 it('manifestMismatchStopsBeforeParse',async()=>{
  const f=s1aFixture();const source={...f.source,readInputFile:vi.fn(async (path:string)=>path==='manifest'?jsonBytes({...f.manifest,approved:true}):jsonBytes(f.intent))};
  const r=await loadS1aArtifacts(f.input,source);expect(r.identityStatus).toBe('MISMATCH');expect(r.manifestDigestMatch).toBe(false);expect(r.checks[0]?.reasonCode).toBe('MANIFEST_DIGEST_MISMATCH');expect(source.readInputFile).toHaveBeenCalledTimes(1);
 });
 it('matchingForgedPairNeverPromotesAuthority',async()=>{
  const f=s1aFixture();const r=await loadS1aArtifacts(f.input,f.source);
  expect(r.identityStatus).toBe('MATCH');expect(r.identityCandidateReady).toBe(true);expect(r.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(r.eligibleBaseline).toBe(false);expect(Object.isFrozen(r)).toBe(true);
 });
 it('invalidIdentifiersNeverLeakInResult',async()=>{
  const f=s1aFixture();const m={...f.manifest,artifacts:f.manifest.artifacts.map((a,i)=>i? a:{...a,artifactId:'../../private?token=secret'})};
  const source={...f.source,readInputFile:async (path:string)=>jsonBytes(path==='manifest'?m:f.intent)};
  const r=await loadS1aArtifacts({...f.input,expectedManifestSha256:sha256(jsonBytes(m))},source);
  expect(r.checks[0]).toEqual({targetId:'manifest',check:'schema',outcome:'UNKNOWN',reasonCode:'MANIFEST_INVALID',category:'INPUT_INVALID'});
  expect(JSON.stringify(r)).not.toContain('secret');expect(r.selectedRefs).toEqual([]);
 });

 it('revisionMismatchPlusUnknownAcRetainsMismatchAndNeverSelects',async()=>{
  const f=s1aFixture();const missing='ac-private-secret';
  const intent={...f.intent,plan:{...f.intent.plan,revision:'R0'},ac:[f.intent.ac[0]!,{artifactId:missing,revision:'R1'}]};
  const source={...f.source,readInputFile:async(path:string,max:number)=>path==='intent'?jsonBytes(intent):f.source.readInputFile(path,max),readArtifact:vi.fn(f.source.readArtifact)};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('MISMATCH');expect(result.checks.map(x=>x.reasonCode)).toContain('REVISION_MISMATCH');
  expect(result.checks.some(x=>x.outcome==='UNKNOWN')).toBe(true);expect(result.selectedRefs).toEqual([]);
  expect(result.identityCandidateReady).toBe(false);expect(result.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(result.eligibleBaseline).toBe(false);
  expect(JSON.stringify(result)).not.toContain(missing);expect(source.readArtifact).not.toHaveBeenCalled();
 });
 it('unknownReferenceAloneRemainsUnknownAndNoneligible',async()=>{
  const f=s1aFixture();const intent={...f.intent,ac:[f.intent.ac[0]!,{artifactId:'ac-secret-only',revision:'R1'}]};
  const source={...f.source,readInputFile:async(path:string,max:number)=>path==='intent'?jsonBytes(intent):f.source.readInputFile(path,max)};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('UNKNOWN');expect(result.selectedRefs).toEqual([]);
  expect(result.identityCandidateReady).toBe(false);expect(result.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(result.eligibleBaseline).toBe(false);
 expect(JSON.stringify(result)).not.toContain('ac-secret-only');
 });

 it('selectedArtifactLimitPerformsZeroArtifactReads',async()=>{
  const f=s1aFixture();
  const makeInput=(acCount:number)=>{
   const artifacts=f.manifest.artifacts.filter(a=>a.kind!=='ac').map(a=>({...a}));
   const ac=[] as {artifactId:string;revision:string}[];const files:Record<string,Uint8Array>={...f.files};
   for(let index=0;index<acCount;index++){
    const artifactId=`ac-extra-${index+1}`;const relativePath=`${artifactId}.bin`;const bytes=new Uint8Array();files[relativePath]=bytes;
    artifacts.push({artifactId,kind:'ac',revision:'R1',digest:{algorithm:'sha256',hex:sha256(bytes)},relativePath,scopeKey:'scope-1',approvalRef:'test-reference',parentId:'task-1'});
    ac.push({artifactId,revision:'R1'});
   }
   const manifest={...f.manifest,artifacts};const manifestBytes=jsonBytes(manifest);const intentBytes=jsonBytes({...f.intent,ac});
   const readArtifact=vi.fn(async(_root:string,path:string,maxBytes:number)=>{
    const bytes=files[path];if(!bytes)throw Error('unreadable');if(bytes.byteLength>maxBytes)throw Object.assign(Error('over_limit'),{kind:'over_limit'});return bytes;
   });
   return {input:{...f.input,expectedManifestSha256:sha256(manifestBytes)},source:{async readInputFile(path:string){return path==='manifest'?manifestBytes:intentBytes;},readArtifact},readArtifact};
  };
  const boundary=makeInput(125);const accepted=await loadS1aArtifacts(boundary.input,boundary.source);
  expect(accepted.identityStatus).toBe('MATCH');expect(accepted.selectedRefs).toHaveLength(S1A_LIMITS.selectedArtifacts);
  const overLimit=makeInput(126);const rejected=await loadS1aArtifacts(overLimit.input,overLimit.source);
  expect(rejected.checks.map(check=>check.reasonCode)).toContain('SELECTED_ARTIFACT_LIMIT_EXCEEDED');
  expect(rejected.identityStatus).toBe('UNKNOWN');expect(rejected.selectedRefs).toEqual([]);
  expect(rejected.identityCandidateReady).toBe(false);expect(rejected.eligibleBaseline).toBe(false);
  expect(overLimit.readArtifact).not.toHaveBeenCalled();
 });

 it('totalArtifactByteBudgetBoundary',async()=>{
  const run=async(fifthBytes:Uint8Array)=>{
   const f=s1aFixture();const buffers=[0,1,2,3].map(()=>new Uint8Array(S1A_LIMITS.artifactBytes));
   const artifacts=[...f.manifest.artifacts,{...f.manifest.artifacts.find(artifact=>artifact.kind==='ac')!,artifactId:'ac-extra-unread',relativePath:'budget-5.bin',digest:{algorithm:'sha256' as const,hex:sha256(new Uint8Array())}}];
   const intent={...f.intent,ac:[...f.intent.ac,{artifactId:'ac-extra-unread',revision:'R1'}]};
   const mapped=artifacts.map((artifact,index)=>{
    const bytes=index<4?buffers[index]!:index===4?fifthBytes:new Uint8Array();const relativePath=`budget-${index}.bin`;
    return {...artifact,relativePath,digest:{algorithm:'sha256' as const,hex:sha256(bytes)}};
   });
   const manifest={...f.manifest,artifacts:mapped};const manifestBytes=jsonBytes(manifest);const intentBytes=jsonBytes(intent);let reads=0;
   const source={async readInputFile(path:string){return path==='manifest'?manifestBytes:intentBytes;},async readArtifact(_root:string,path:string,maxBytes:number){
    reads++;const index=Number(path.slice('budget-'.length,-'.bin'.length));const bytes=index<4?buffers[index]!:index===4?fifthBytes:new Uint8Array();
    if(bytes.byteLength>maxBytes)throw Object.assign(Error('over_limit'),{kind:'over_limit'});return bytes;
   }};
   return {result:await loadS1aArtifacts({...f.input,expectedManifestSha256:sha256(manifestBytes)},source),getReads:()=>reads};
  };
  const boundary=await run(new Uint8Array());
  expect(boundary.result.identityStatus).toBe('MATCH');expect(boundary.result.selectedRefs).toHaveLength(6);
  expect(boundary.result.selectedRefs.every(ref=>ref.digestOutcome==='MATCH')).toBe(true);
  const exceeded=await run(new Uint8Array([1]));
  expect(exceeded.result.checks.map(check=>check.reasonCode)).toContain('TOTAL_ARTIFACT_LIMIT_EXCEEDED');
  expect(exceeded.result.identityStatus).toBe('UNKNOWN');expect(exceeded.result.identityCandidateReady).toBe(false);
  expect(exceeded.result.eligibleBaseline).toBe(false);expect(exceeded.result.selectedRefs).toHaveLength(6);
  expect(exceeded.result.selectedRefs[4]?.digestOutcome).toBe('UNKNOWN');expect(exceeded.result.selectedRefs[4]?.observedDigest).toBeNull();
  expect(exceeded.result.selectedRefs[5]?.digestOutcome).toBe('UNKNOWN');expect(exceeded.result.selectedRefs[5]?.observedDigest).toBeNull();
  expect(exceeded.getReads()).toBe(5);
 });

 it('mismatchOverridesOtherUnknown',async()=>{
  const f=s1aFixture();const buffers=[0,1,2,3].map(()=>new Uint8Array(S1A_LIMITS.artifactBytes));buffers[0]![0]=1;
  const artifacts=[...f.manifest.artifacts,{...f.manifest.artifacts.find(artifact=>artifact.kind==='ac')!,artifactId:'ac-extra-unread',relativePath:'priority-5.bin',digest:{algorithm:'sha256' as const,hex:sha256(new Uint8Array())}}].map((artifact,index)=>{
   const bytes=index<4?buffers[index]!:index===4?new Uint8Array([1]):new Uint8Array();const expected=index===0?new Uint8Array(S1A_LIMITS.artifactBytes):bytes;
   return {...artifact,relativePath:`priority-${index}.bin`,digest:{algorithm:'sha256' as const,hex:sha256(expected)}};
  });
  const manifest={...f.manifest,artifacts};const intent={...f.intent,ac:[...f.intent.ac,{artifactId:'ac-extra-unread',revision:'R1'}]};const manifestBytes=jsonBytes(manifest);const intentBytes=jsonBytes(intent);let reads=0;
  const source={async readInputFile(path:string){return path==='manifest'?manifestBytes:intentBytes;},async readArtifact(_root:string,path:string,maxBytes:number){
   reads++;const index=Number(path.slice('priority-'.length,-'.bin'.length));const bytes=index<4?buffers[index]!:index===4?new Uint8Array([1]):new Uint8Array();
   if(bytes.byteLength>maxBytes)throw Object.assign(Error('over_limit'),{kind:'over_limit'});return bytes;
  }};
  const result=await loadS1aArtifacts({...f.input,expectedManifestSha256:sha256(manifestBytes)},source);
  const reasons=result.checks.map(check=>check.reasonCode);
  expect(reasons).toContain('ARTIFACT_DIGEST_MISMATCH');expect(reasons).toContain('TOTAL_ARTIFACT_LIMIT_EXCEEDED');
  expect(result.identityStatus).toBe('MISMATCH');expect(result.identityCandidateReady).toBe(false);
  expect(result.eligibleBaseline).toBe(false);expect(result.selectedRefs).toHaveLength(6);expect(reads).toBe(5);
  expect(result.selectedRefs[5]?.digestOutcome).toBe('UNKNOWN');expect(result.selectedRefs[5]?.observedDigest).toBeNull();
  expect(JSON.stringify(result)).not.toContain('priority-');
 });
 it('unreadableManifestReturnsUnknownWithoutLeakingInput',async()=>{
  const f=s1aFixture();const source={...f.source,readInputFile:vi.fn(async()=>{throw Error('private path');})};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('UNKNOWN');expect(result.checks[0]?.reasonCode).toBe('MANIFEST_UNREADABLE');
  expect(JSON.stringify(result)).not.toContain('private path');
 });
 it('invalidIntentReturnsUnknownAfterManifestDigestMatches',async()=>{
  const f=s1aFixture();const source={...f.source,readInputFile:async(path:string,max:number)=>path==='intent'?new Uint8Array([0xff]):f.source.readInputFile(path,max)};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('UNKNOWN');expect(result.checks[0]?.reasonCode).toBe('TASK_INTENT_INVALID');
  expect(result.manifestId).toBe(f.manifest.manifestId);expect(result.selectedRefs).toEqual([]);
 });
 it('unreadableIntentReturnsUnknownWithManifestIdentity',async()=>{
  const f=s1aFixture();const source={...f.source,readInputFile:async(path:string,max:number)=>{if(path==='intent')throw Error('intent unavailable');return f.source.readInputFile(path,max);}};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('UNKNOWN');expect(result.checks[0]?.reasonCode).toBe('TASK_INTENT_UNREADABLE');
  expect(result.manifestDigestMatch).toBe(true);expect(result.manifestId).toBe(f.manifest.manifestId);
 });
 it('malformedManifestReturnsUnknownAfterDigestMatch',async()=>{
  const f=s1aFixture();const raw=jsonBytes({...f.manifest,unsupported:true});
  const source={...f.source,readInputFile:async(path:string,max:number)=>path==='manifest'?raw:f.source.readInputFile(path,max)};
  const result=await loadS1aArtifacts({...f.input,expectedManifestSha256:sha256(raw)},source);
  expect(result.identityStatus).toBe('UNKNOWN');expect(result.checks[0]?.reasonCode).toBe('MANIFEST_INVALID');
  expect(result.manifestDigestMatch).toBe(true);expect(result.selectedRefs).toEqual([]);
 });
 it('unreadableArtifactReturnsUnknownAndRetainsOtherArtifactEvidence',async()=>{
  const f=s1aFixture();let reads=0;
  const source={...f.source,readArtifact:async(root:string,path:string,max:number)=>{reads++;if(path==='design-1.md')throw Error('private path');return f.source.readArtifact(root,path,max);}};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('UNKNOWN');expect(result.checks.some(x=>x.reasonCode==='ARTIFACT_UNREADABLE')).toBe(true);
  expect(result.selectedRefs[0]?.observedDigest).toBeNull();expect(reads).toBe(f.manifest.artifacts.length);
 });
 it('artifactSizeLimitReturnsUnknownAndStopsFurtherReads',async()=>{
  const f=s1aFixture();let reads=0;
  const source={...f.source,readArtifact:async()=>{reads++;throw Object.assign(Error('too large'),{kind:'over_limit'});}};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('UNKNOWN');expect(result.checks.some(x=>x.reasonCode==='ARTIFACT_SIZE_LIMIT_EXCEEDED')).toBe(true);
  expect(reads).toBe(1);expect(result.eligibleBaseline).toBe(false);
 });
 it('artifactDigestMismatchIsObservedAndNeverEligible',async()=>{
  const f=s1aFixture();
  const source={...f.source,readArtifact:async(root:string,path:string,max:number)=>path==='design-1.md'?jsonBytes('changed'):f.source.readArtifact(root,path,max)};
  const result=await loadS1aArtifacts(f.input,source);
  expect(result.identityStatus).toBe('MISMATCH');expect(result.checks.some(x=>x.reasonCode==='ARTIFACT_DIGEST_MISMATCH')).toBe(true);
  expect(result.selectedRefs[0]?.digestOutcome).toBe('MISMATCH');expect(result.eligibleBaseline).toBe(false);
 });
});
