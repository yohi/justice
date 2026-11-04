import {describe,it,expect} from 'vitest';
import {isLowercaseSha256Hex,isSafeIdentifier,LIMITATIONS} from '../../../src/core/s1a/contract.js';
import {makeS1aResult} from '../../../src/core/s1a/loader.js';
import {makeCheck} from '../../../src/core/s1a/contract.js';
describe('S1-a fixed result contract',()=>{
 it('accepts canonical lowercase digest only',()=>{expect(isLowercaseSha256Hex('a'.repeat(64))).toBe(true);expect(isLowercaseSha256Hex('A'.repeat(64))).toBe(false);expect(isLowercaseSha256Hex('sha256:'+'a'.repeat(64))).toBe(false);});
 it('rejects diagnostic-unsafe values preserving opaque valid identity',()=>{for(const invalid of ['', '../leak','https://x/?token=secret','a'.repeat(65),'\n','🎄'])expect(isSafeIdentifier(invalid)).toBe(false);expect(isSafeIdentifier('X'.repeat(64))).toBe(true);});
 it('always separates identity from Owner authorization',()=>{
  const result=makeS1aResult(true,[makeCheck('manifest','manifest_digest','MATCH','CHECK_MATCH','IDENTITY_MATCH')]);
  expect(result.identityStatus).toBe('MATCH');expect(result.ownerAuthorityStatus).toBe('NOT_PROVEN');expect(result.eligibleBaseline).toBe(false);expect(result.limitations).toEqual(LIMITATIONS);
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.checks)).toBe(true);
 });
});
