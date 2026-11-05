import {describe,it,expect} from 'vitest';
import {parseOwnerManifest} from '../../../src/core/s1a/manifest.js';
import {s1aFixture,jsonBytes} from '../../helpers/s1a-fixtures.js';
describe('strict Manifest schema',()=>{
 it('accepts valid fixture raw JSON',()=>expect(parseOwnerManifest(jsonBytes(s1aFixture().manifest)).schemaVersion).toBe('justice-s1a-manifest-v1'));
 it('duplicateEscapedKeysAndInvalidUtf8',()=>{
  const raw=JSON.stringify(s1aFixture().manifest).replace('"artifacts":','"\\u0061rtifacts":[],"artifacts":');
  expect(()=>parseOwnerManifest(Buffer.from(raw))).toThrow('MANIFEST_INVALID');
  expect(()=>parseOwnerManifest(new Uint8Array([0xff]))).toThrow('MANIFEST_INVALID');
 });
 it('rejects duplicate Artifact ID and unknown approval claim',()=>{
  const f=s1aFixture().manifest;
  expect(()=>parseOwnerManifest(jsonBytes({...f,artifacts:[...f.artifacts,f.artifacts[0]]}))).toThrow('MANIFEST_INVALID');
  expect(()=>parseOwnerManifest(jsonBytes({...f,approved:true}))).toThrow('MANIFEST_INVALID');
 });
 it('rejectUnsafeDiagnosticIdentifiers',()=>{
  const f=s1aFixture().manifest;
  for(const unsafe of ['../../private?token=secret','https://x/?token=secret','\u001b[31m','a'.repeat(65),'日本語','']){
   expect(()=>parseOwnerManifest(jsonBytes({...f,manifestId:unsafe}))).toThrow('MANIFEST_INVALID');
   expect(()=>parseOwnerManifest(jsonBytes({...f,artifacts:f.artifacts.map((r,i)=>i? r:{...r,revision:unsafe})}))).toThrow('MANIFEST_INVALID');
  }
 });
 it('valid 64 character opaque id is unchanged',()=>{
  const f=s1aFixture().manifest;const id='A'.repeat(64);expect(parseOwnerManifest(jsonBytes({...f,manifestId:id})).manifestId).toBe(id);
 });
});
