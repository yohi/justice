#!/usr/bin/env node
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadS1aArtifacts,makeS1aResult} from '../core/s1a/loader.js';
import {makeCheck,type LoaderInput,type S1aReadOnlySource} from '../core/s1a/contract.js';
import {createS1aReadOnlySource} from './s1a-read-only-fs.js';
export type S1aCliOutput={readonly stdout:string;readonly exitCode:0|2|3|64};
export async function runS1aCli(argv:readonly string[],source:S1aReadOnlySource):Promise<S1aCliOutput> {
 const invalid=():S1aCliOutput=>({stdout:JSON.stringify(makeS1aResult('unknown',[makeCheck('task-intent','cli_arguments','UNKNOWN','CLI_ARGUMENT_INVALID','INPUT_INVALID')]))+'\n',exitCode:64});
 if(argv[0]!=='check')return invalid();
 const allowed=new Set(['--manifest','--manifest-sha256','--intent','--artifacts-root']);const flags=new Map<string,string>();
 for(let i=1;i<argv.length;i+=2){
  const flag=argv[i],value=argv[i+1];
  if(!flag||!allowed.has(flag)||flags.has(flag)||value===undefined||value.startsWith('--'))return invalid();
  flags.set(flag,value);
 }
 for(const f of ['--manifest','--intent','--artifacts-root'])if(!flags.get(f))return invalid();
 const input:LoaderInput={manifestPath:flags.get('--manifest')!,intentPath:flags.get('--intent')!,artifactsRoot:flags.get('--artifacts-root')!,expectedManifestSha256:flags.get('--manifest-sha256')};
 try{
  const result=await loadS1aArtifacts(input,source);
  const exitCode=result.identityStatus==='MATCH'?0:result.identityStatus==='MISMATCH'?2:3;
  return {stdout:JSON.stringify(result)+'\n',exitCode};
 }catch{return invalid();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 runS1aCli(process.argv.slice(2),createS1aReadOnlySource()).then(r=>{process.stdout.write(r.stdout);process.exitCode=r.exitCode;},()=>{
  const safe=makeS1aResult('unknown',[makeCheck('task-intent','cli_arguments','UNKNOWN','CLI_ARGUMENT_INVALID','INPUT_INVALID')]);
  process.stdout.write(JSON.stringify(safe)+'\n');process.exitCode=64;
 });
}
