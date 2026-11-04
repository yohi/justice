import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,sep,parse} from 'node:path';
import {isSafeRelativePath} from '../core/s1a/manifest.js';
import type {S1aReadOnlySource} from '../core/s1a/contract.js';
export class S1aReadError extends Error {
 constructor(readonly kind:'unsafe_path'|'nonregular'|'unreadable'|'over_limit'|'changed_during_read'){super(kind);this.name='S1aReadError';}
}
async function checkComponents(path:string):Promise<void>{
 const absolute=resolve(path),root=parse(absolute).root,parts=absolute.slice(root.length).split(sep).filter(Boolean);let at=root;
 for(let i=0;i<parts.length;i++){
  at=join(at,parts[i]!);
  let st;try{st=await lstat(at);}catch{throw new S1aReadError('unreadable');}
  if(st.isSymbolicLink())throw new S1aReadError('unsafe_path');
  if(i<parts.length-1&&!st.isDirectory())throw new S1aReadError('unsafe_path');
  if(i===parts.length-1&&!st.isFile())throw new S1aReadError('nonregular');
 }
}
async function readBounded(path:string,maxBytes:number):Promise<Uint8Array>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new S1aReadError('over_limit');
 await checkComponents(path);let handle;
 try{
  handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=await handle.stat();if(!before.isFile())throw new S1aReadError('nonregular');
  if(before.size>maxBytes)throw new S1aReadError('over_limit');
  const chunks:Buffer[]=[];let size=0;const block=Buffer.allocUnsafe(Math.min(65536,maxBytes+1));
  for(;;){const want=Math.min(block.length,maxBytes-size+1);const {bytesRead}=await handle.read(block,0,want,null);
   if(bytesRead===0)break;size+=bytesRead;if(size>maxBytes)throw new S1aReadError('over_limit');chunks.push(Buffer.from(block.subarray(0,bytesRead)));
  }
  const after=await handle.stat();
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||size!==after.size)throw new S1aReadError('changed_during_read');
  // Still race-prone across checked path components; only the read fd is stable.
  await checkComponents(path);
  return Uint8Array.from(Buffer.concat(chunks,size));
 }catch(e){if(e instanceof S1aReadError)throw e;throw new S1aReadError('unreadable');}
 finally{await handle?.close().catch(()=>undefined);}
}
export function createS1aReadOnlySource():S1aReadOnlySource {
 return {
  async readInputFile(path,maxBytes){return readBounded(resolve(path),maxBytes);},
  async readArtifact(root,relativePath,maxBytes){
   if(!isSafeRelativePath(relativePath))throw new S1aReadError('unsafe_path');
   const absolute=resolve(root,relativePath);const rootPath=resolve(root);
   if(!absolute.startsWith(rootPath+sep))throw new S1aReadError('unsafe_path');
   return readBounded(absolute,maxBytes);
  },
 };
}
