import {describe,it,expect} from 'vitest';
import {runS1aCli} from '../../src/runtime/s1a-cli.js';
import {s1aFixture} from '../helpers/s1a-fixtures.js';
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
});
