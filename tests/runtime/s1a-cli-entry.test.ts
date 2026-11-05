import {describe,it,expect,vi} from 'vitest';
import {fileURLToPath} from 'node:url';

describe('justice-s1a CLI executable entry',()=>{
 it('writes a sanitized JSON error and sets exit code for invalid command',async()=>{
  const originalArgv=[...process.argv];const originalExitCode=process.exitCode;
  const entryPath=fileURLToPath(new URL('../../src/runtime/s1a-cli.ts',import.meta.url));
  let output='';
  let resolveOutput:()=>void=()=>{};
  const outputWritten=new Promise<void>(resolve=>{resolveOutput=resolve;});
  const write=vi.spyOn(process.stdout,'write').mockImplementation(chunk=>{
   output+=String(chunk);resolveOutput();return true;
  });
  try{
   process.argv=[process.argv[0]??'bun',entryPath,'unknown-command','private-token'];
   vi.resetModules();
   await import('../../src/runtime/s1a-cli.js');
   await outputWritten;
   expect(process.exitCode).toBe(64);
   expect(JSON.parse(output).checks[0].reasonCode).toBe('CLI_ARGUMENT_INVALID');
   expect(output).not.toContain('private-token');
  }finally{
   write.mockRestore();process.argv=originalArgv;process.exitCode=originalExitCode;
  }
 });
});
