import {describe,it,expect} from 'vitest';
import {parseStrictJson} from '../../../src/core/s1a/strict-json.js';

const encode=(value:string):Uint8Array=>new TextEncoder().encode(value);

describe('strict JSON byte and syntax boundaries',()=>{
 it('rejects an unterminated JSON string',()=>{
  expect(()=>parseStrictJson(encode('{"key":"unterminated'),1024)).toThrow('JSON_INVALID');
 });
 it('rejects trailing JSON values',()=>{
  expect(()=>parseStrictJson(encode('{"key":true} false'),1024)).toThrow('JSON_INVALID');
 });
 it('rejects input over the supplied byte limit',()=>{
  expect(()=>parseStrictJson(encode('{"key":true}'),11)).toThrow('JSON_INVALID');
 });
});
