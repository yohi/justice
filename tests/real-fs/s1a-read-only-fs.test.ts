import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createS1aReadOnlySource} from '../../src/runtime/s1a-read-only-fs.js';
describe('S1-a raw read-only filesystem',()=>{
 it('reads an absolute input file through the same bounded read path',async()=>{
  const root=await mkdtemp(join(tmpdir(),'s1a-input-test-'));try{
   const path=join(root,'input.json');await writeFile(path,Buffer.from('{"ok":true}'));
   const fs=createS1aReadOnlySource();expect(await fs.readInputFile(path,11)).toEqual(new TextEncoder().encode('{"ok":true}'));
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('readsExactRawBytes and rejectSymlinkAndSpecialFiles',async()=>{
  const root=await mkdtemp(join(tmpdir(),'s1a-test-'));try{
   await mkdir(join(root,'child'));await writeFile(join(root,'child','file'),new Uint8Array([0,255,10]));await symlink(join(root,'child'),join(root,'link'));await symlink(join(root,'child','file'),join(root,'file-link'));
   const fs=createS1aReadOnlySource();expect(await fs.readArtifact(root,'child/file',3)).toEqual(new Uint8Array([0,255,10]));
   await expect(fs.readArtifact(root,'link/file',100)).rejects.toMatchObject({kind:'unsafe_path'});
   await expect(fs.readArtifact(root,'file-link',100)).rejects.toMatchObject({kind:'unsafe_path'});
   await expect(fs.readArtifact(root,'../private',100)).rejects.toMatchObject({kind:'unsafe_path'});
   await expect(fs.readArtifact(root,'child/file',2)).rejects.toMatchObject({kind:'over_limit'});
   await expect(fs.readArtifact(root,'child',100)).rejects.toMatchObject({kind:'nonregular'});
   await expect(fs.readArtifact(root,'child/file',-1)).rejects.toMatchObject({kind:'over_limit'});
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('zeroByteBudgetAcceptsEmptyRejectsPositive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'s1a-test-'));try{
   await writeFile(join(root,'empty'),new Uint8Array());await writeFile(join(root,'nonempty'),Buffer.from('X'));
   const fs=createS1aReadOnlySource();expect(await fs.readArtifact(root,'empty',0)).toEqual(new Uint8Array());
   await expect(fs.readArtifact(root,'nonempty',0)).rejects.toMatchObject({kind:'over_limit'});
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
