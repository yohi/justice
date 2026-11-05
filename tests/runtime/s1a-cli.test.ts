import {describe,it,expect} from 'vitest';
import {runS1aCli} from '../../src/runtime/s1a-cli.js';
import {s1aFixture,jsonBytes,sha256} from '../helpers/s1a-fixtures.js';
describe('justice-s1a standalone CLI',()=>{
 it('P-01 emits deterministic MATCH without Owner authorization',async()=>{
  const f=s1aFixture();const argv=['check','--manifest','manifest','--manifest-sha256',f.input.expectedManifestSha256!,'--intent','intent','--artifacts-root','root'];
  const r=await runS1aCli(argv,f.source);expect(r.exitCode).toBe(0);expect(r.stdout).toBe((await runS1aCli(argv,f.source)).stdout);
  expect(JSON.parse(r.stdout)).toMatchObject({identityStatus:'MATCH',ownerAuthorityStatus:'NOT_PROVEN',eligibleBaseline:false});
 });
 it('N-06b input missing digest has exit 3 and a fixed result',async()=>{
  const f=s1aFixture();const r=await runS1aCli(['check','--manifest','manifest','--intent','intent','--artifacts-root','root'],f.source);
  expect(r.exitCode).toBe(3);expect(JSON.parse(r.stdout).checks[0].reasonCode).toBe('MANIFEST_DIGEST_REQUIRED');
 });
 it('unknown/duplicate CLI arguments never echo caller value',async()=>{
  const f=s1aFixture();const r=await runS1aCli(['check','--manifest','manifest','--intent','intent','--artifacts-root','root','--password','secret'],f.source);
  expect(r.exitCode).toBe(64);expect(JSON.parse(r.stdout).checks[0].reasonCode).toBe('CLI_ARGUMENT_INVALID');expect(r.stdout).not.toContain('secret');
 });

 it('revisionMismatchAndUnknownAcReturnsExit2WithoutLeakOrPromotion',async()=>{
  const f=s1aFixture();const intent={...f.intent,plan:{...f.intent.plan,revision:'R0'},ac:[f.intent.ac[0]!,{artifactId:'ac-hidden-token',revision:'R1'}]};
  const source={...f.source,readInputFile:async(path:string,max:number)=>path==='intent'?jsonBytes(intent):f.source.readInputFile(path,max)};
  const argv=['check','--manifest','manifest','--manifest-sha256',f.input.expectedManifestSha256!,'--intent','intent','--artifacts-root','root'];
  const result=await runS1aCli(argv,source);const json=JSON.parse(result.stdout);
  expect(result.exitCode).toBe(2);expect(json.identityStatus).toBe('MISMATCH');
  expect(json.checks.map((x:{reasonCode:string})=>x.reasonCode)).toContain('REVISION_MISMATCH');
  expect(json.selectedRefs).toEqual([]);expect(json.identityCandidateReady).toBe(false);
  expect(json.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(json.eligibleBaseline).toBe(false);
  expect(result.stdout).not.toContain('ac-hidden-token');
 });
 it('unknownOnlyReturnsExit3AndNoSelection',async()=>{
  const f=s1aFixture();const intent={...f.intent,ac:[f.intent.ac[0]!,{artifactId:'ac-private-ref',revision:'R1'}]};
  const source={...f.source,readInputFile:async(path:string,max:number)=>path==='intent'?jsonBytes(intent):f.source.readInputFile(path,max)};
  const argv=['check','--manifest','manifest','--manifest-sha256',f.input.expectedManifestSha256!,'--intent','intent','--artifacts-root','root'];
  const result=await runS1aCli(argv,source);const json=JSON.parse(result.stdout);
  expect(result.exitCode).toBe(3);expect(json.identityStatus).toBe('UNKNOWN');expect(json.selectedRefs).toEqual([]);
  expect(json.identityCandidateReady).toBe(false);expect(json.eligibleBaseline).toBe(false);
  expect(result.stdout).not.toContain('ac-private-ref');
 });

 it('129 selected refs are rejected without exposing identifiers or authorizing a baseline',async()=>{
  const f=s1aFixture();
  const manifest={...f.manifest,artifacts:f.manifest.artifacts.filter(ref=>ref.kind!=='ac')};
  const intent={...f.intent,ac:[] as typeof f.intent.ac[number][]};
  for(let n=1;n<=126;n++){
   const artifactId=`ac-${n}`;
   manifest.artifacts.push({...f.manifest.artifacts.find(ref=>ref.kind==='ac')!,artifactId,relativePath:`${artifactId}.md`});
   intent.ac.push({artifactId,revision:'R1'});
  }
  const manifestBytes=jsonBytes(manifest);
  const source={
   ...f.source,
   async readInputFile(path:string,maxBytes:number){
    if(path==='/private/justice-secret-path/manifest.json')return manifestBytes;
    if(path==='intent')return jsonBytes(intent);
    return f.source.readInputFile(path,maxBytes);
   },
   async readArtifact(){throw new Error('limit must be checked before artifact reads');},
  };
  const argv=['check','--manifest','/private/justice-secret-path/manifest.json','--manifest-sha256',sha256(manifestBytes),'--intent','intent','--artifacts-root','root'];
  const first=await runS1aCli(argv,source);const second=await runS1aCli(argv,source);const result=JSON.parse(first.stdout);
  expect(first.exitCode).toBe(3);expect(first.stdout).toBe(second.stdout);
  expect(result.identityStatus).toBe('UNKNOWN');
  expect(result.checks.map((check:{reasonCode:string})=>check.reasonCode)).toContain('SELECTED_ARTIFACT_LIMIT_EXCEEDED');
  expect(result.selectedRefs).toEqual([]);expect(result.identityCandidateReady).toBe(false);expect(result.eligibleBaseline).toBe(false);
  expect(result.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(result.ownerTrustPrecondition).toBe('EXTERNAL_NOT_VERIFIED_BY_S1A');
  expect(first.stdout).not.toContain('/private/justice-secret-path');expect(first.stdout).not.toContain('ac-126');
 });

 it('total attempted bytes over the limit stay UNKNOWN and cannot authorize a baseline',async()=>{
  const f=s1aFixture();const manifest={...f.manifest,artifacts:f.manifest.artifacts.map((ref,index)=>({...ref,digest:{...ref.digest,hex:sha256(index<4?new Uint8Array(8_388_608):new Uint8Array([1]))}}))};
  const manifestBytes=jsonBytes(manifest);const artifacts=new Map(manifest.artifacts.map((ref,index)=>[ref.relativePath,index<4?new Uint8Array(8_388_608):new Uint8Array([1])]));
  const source={
   ...f.source,
   async readInputFile(path:string,maxBytes:number){return path==='manifest'?manifestBytes:f.source.readInputFile(path,maxBytes);},
   async readArtifact(_root:string,path:string,maxBytes:number){
    const bytes=artifacts.get(path);if(!bytes)throw new Error('unreadable');
    if(bytes.byteLength>maxBytes)throw Object.assign(new Error('over_limit'),{kind:'over_limit'});
    return bytes;
   },
  };
  const argv=['check','--manifest','manifest','--manifest-sha256',sha256(manifestBytes),'--intent','intent','--artifacts-root','root'];
  const first=await runS1aCli(argv,source);const second=await runS1aCli(argv,source);const result=JSON.parse(first.stdout);
  expect(first.exitCode).toBe(3);expect(first.stdout).toBe(second.stdout);expect(result.identityStatus).toBe('UNKNOWN');
  expect(result.checks.map((check:{reasonCode:string})=>check.reasonCode)).toContain('TOTAL_ARTIFACT_LIMIT_EXCEEDED');
  expect(result.selectedRefs).toEqual([]);expect(result.identityCandidateReady).toBe(false);expect(result.eligibleBaseline).toBe(false);
  expect(result.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(result.ownerTrustPrecondition).toBe('EXTERNAL_NOT_VERIFIED_BY_S1A');
 });

 it('a previously observed mismatch outranks a later total-byte UNKNOWN',async()=>{
  const f=s1aFixture();const manifest={...f.manifest,artifacts:f.manifest.artifacts.map((ref,index)=>({...ref,digest:{...ref.digest,hex:sha256(index<4?new Uint8Array(8_388_608):new Uint8Array())}}))};
  const manifestBytes=jsonBytes(manifest);const source={
   ...f.source,
   async readInputFile(path:string,maxBytes:number){return path==='manifest'?manifestBytes:f.source.readInputFile(path,maxBytes);},
   async readArtifact(_root:string,path:string,maxBytes:number){
    const bytes=path==='ac-2.md'?new Uint8Array([1]):new Uint8Array(8_388_608);
    if(bytes.byteLength>maxBytes)throw Object.assign(new Error('over_limit'),{kind:'over_limit'});
    return path==='design-1.md'?Uint8Array.from(bytes,()=>2):bytes;
   },
  };
  const argv=['check','--manifest','manifest','--manifest-sha256',sha256(manifestBytes),'--intent','intent','--artifacts-root','root'];
  const result=await runS1aCli(argv,source);const json=JSON.parse(result.stdout);
  expect(result.exitCode).toBe(2);expect(json.identityStatus).toBe('MISMATCH');
  expect(json.checks.map((check:{reasonCode:string})=>check.reasonCode)).toEqual(expect.arrayContaining(['ARTIFACT_DIGEST_MISMATCH','TOTAL_ARTIFACT_LIMIT_EXCEEDED']));
  expect(json.selectedRefs).toEqual([]);expect(json.identityCandidateReady).toBe(false);expect(json.eligibleBaseline).toBe(false);
  expect(json.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(json.ownerTrustPrecondition).toBe('EXTERNAL_NOT_VERIFIED_BY_S1A');
 });
});
