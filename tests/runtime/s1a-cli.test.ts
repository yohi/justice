import {describe,it,expect} from 'vitest';
import {runS1aCli} from '../../src/runtime/s1a-cli.js';
import {s1aFixture,jsonBytes} from '../helpers/s1a-fixtures.js';
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
});
