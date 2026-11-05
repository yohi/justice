import {describe,it,expect,vi} from 'vitest';
import {loadS1aArtifacts} from '../../../src/core/s1a/loader.js';
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
