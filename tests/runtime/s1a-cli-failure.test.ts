import {describe,it,expect,vi} from 'vitest';

vi.mock('../../src/core/s1a/loader.js',async importOriginal=>{
 const loader=await importOriginal<typeof import('../../src/core/s1a/loader.js')>();
 return {...loader,loadS1aArtifacts:async()=>{throw Error('internal failure');}};
});

const {runS1aCli}=await import('../../src/runtime/s1a-cli.js');

describe('justice-s1a CLI failure boundary',()=>{
 it('converts unexpected loader failures to a sanitized argument error',async()=>{
  const source={async readInputFile(){return new Uint8Array();},async readArtifact(){return new Uint8Array();}};
  const result=await runS1aCli(['check','--manifest','manifest','--manifest-sha256','a'.repeat(64),'--intent','intent','--artifacts-root','root'],source);
  expect(result.exitCode).toBe(64);expect(JSON.parse(result.stdout).checks[0].reasonCode).toBe('CLI_ARGUMENT_INVALID');
  expect(result.stdout).not.toContain('internal failure');
 });
});
