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
});
