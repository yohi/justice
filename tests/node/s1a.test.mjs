import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {execPath} from 'node:process';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {TextEncoder} from 'node:util';
import {parseOwnerManifest} from '../../dist/core/s1a/manifest.js';
import {parseTaskIntent,resolveTaskIntent} from '../../dist/core/s1a/resolver.js';
import {loadS1aArtifacts} from '../../dist/core/s1a/loader.js';
import {createS1aReadOnlySource} from '../../dist/runtime/s1a-read-only-fs.js';
import {runS1aCli} from '../../dist/runtime/s1a-cli.js';
import {S1A_LIMITS} from '../../dist/core/s1a/contract.js';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const encoder=new TextEncoder();
const bytes=x=>encoder.encode(typeof x==='string'?x:JSON.stringify(x));
const entries=[
 ['design-1','design',undefined],['plan-1','plan','design-1'],['task-1','task','plan-1'],['ac-1','ac','task-1'],['ac-2','ac','task-1'],['ac-3','ac','task-1']
];
function fixture(){
 const artifacts=entries.map(([artifactId,kind,parentId])=>({...{artifactId,kind,revision:'R1',digest:{algorithm:'sha256',hex:sha(artifactId)},relativePath:artifactId+'.md',scopeKey:'scope-1',approvalRef:'https://example.com/token-secret'},...(parentId?{parentId}:{})}));
 const manifest={schemaVersion:'justice-s1a-manifest-v1',manifestId:'fixture-1',artifacts};
 const intent={schemaVersion:'justice-s1a-task-intent-v1',scopeKey:'scope-1',design:{artifactId:'design-1',revision:'R1'},plan:{artifactId:'plan-1',revision:'R1'},task:{artifactId:'task-1',revision:'R1'},ac:[{artifactId:'ac-1',revision:'R1'},{artifactId:'ac-2',revision:'R1'},{artifactId:'ac-3',revision:'R1'}]};
 const content={};artifacts.forEach(a=>content[a.relativePath]=bytes(a.artifactId));
 return {manifest,intent,content};
}
function mockSource(f,alter={}){
 let reads=0;
 return {get reads(){return reads},async readInputFile(path,max){reads++;const raw=path==='manifest'?bytes(alter.manifest??f.manifest):bytes(alter.intent??f.intent);if(raw.length>max)throw Error('over_limit');return raw;},async readArtifact(root,path,max){reads++;const raw=alter[path]??f.content[path];if(!raw)throw Error('unreadable');if(raw.length>max)throw Error('over_limit');return raw;}};
}
function input(f){return {manifestPath:'manifest',expectedManifestSha256:sha(bytes(f.manifest)),intentPath:'intent',artifactsRoot:'root'};}
const check=(result,code)=>assert.equal(result.checks.some(c=>c.reasonCode===code),true,JSON.stringify(result));

test('P-01 valid exact raw-byte references identity MATCH never Owner approval',async()=>{
 const f=fixture(); const r=await loadS1aArtifacts(input(f),mockSource(f));
 assert.equal(r.identityStatus,'MATCH');assert.equal(r.manifestDigestMatch,true);assert.equal(r.identityCandidateReady,true);assert.equal(r.ownerAuthorityStatus,'NOT_PROVEN');assert.equal(r.eligibleBaseline,false);assert.equal(r.selectedRefs.length,6);assert.equal(Object.isFrozen(r),true);
 assert.equal(JSON.stringify(r).includes('token-secret'),false);
});
test('N-06b/c missing and malformed sha return UNKNOWN without reads',async()=>{
 const f=fixture(); const s=mockSource(f);const a=await loadS1aArtifacts({...input(f),expectedManifestSha256:undefined},s);
 check(a,'MANIFEST_DIGEST_REQUIRED');assert.equal(s.reads,0);assert.equal(a.manifestDigestMatch,'unknown');assert.deepEqual(a.selectedRefs,[]);
 const b=await loadS1aArtifacts({...input(f),expectedManifestSha256:'A'.repeat(64)},s);check(b,'MANIFEST_DIGEST_FORMAT_INVALID');assert.equal(s.reads,0);
});
test('N-01 manifest digest mismatch stops before reading intent',async()=>{
 const f=fixture();const s=mockSource(f,{manifest:{...f.manifest,manifestId:'other-1'}});const r=await loadS1aArtifacts(input(f),s);
 check(r,'MANIFEST_DIGEST_MISMATCH');assert.equal(r.manifestDigestMatch,false);assert.equal(r.identityStatus,'MISMATCH');assert.equal(s.reads,1);
});
test('N-03 dirty artifact byte mismatch',async()=>{
 const f=fixture(); const r=await loadS1aArtifacts(input(f),mockSource(f,{'design-1.md':bytes('changed')}));check(r,'ARTIFACT_DIGEST_MISMATCH');assert.equal(r.identityStatus,'MISMATCH');assert.equal(r.eligibleBaseline,false);
});
test('N-02 stale revision no fallback',async()=>{
 const f=fixture();const intent={...f.intent,plan:{artifactId:'plan-1',revision:'R0'}};
 const r=await loadS1aArtifacts(input(f),mockSource(f,{intent}));check(r,'REVISION_MISMATCH');assert.equal(r.identityStatus,'MISMATCH');
});
test('N-05 required AC missing',async()=>{
 const f=fixture();const r=resolveTaskIntent(parseOwnerManifest(bytes(f.manifest)),parseTaskIntent(bytes({...f.intent,ac:[f.intent.ac[0]]})));
 check(r,'REQUIRED_AC_MISSING');assert.equal(r.complete,false);assert.deepEqual(r.refs,[]);
});
test('invalid manifest field diagnostic never reveals secret',async()=>{
 const f=fixture();const m={...f.manifest,artifacts:f.manifest.artifacts.map((a,i)=>i? a:{...a,artifactId:'../../private?token=secret'})};
 const source=mockSource(f,{manifest:m});const r=await loadS1aArtifacts({...input(f),expectedManifestSha256:sha(bytes(m))},source);
 check(r,'MANIFEST_INVALID');assert.equal(r.identityStatus,'UNKNOWN');assert.equal(JSON.stringify(r).includes('secret'),false);assert.deepEqual(r.selectedRefs,[]);
});
test('invalid intent value diagnostic never reveals secret',async()=>{
 const f=fixture();const intent={...f.intent,scopeKey:'scope\nBearer-secret'};const r=await loadS1aArtifacts(input(f),mockSource(f,{intent}));
 check(r,'TASK_INTENT_INVALID');assert.equal(r.identityStatus,'UNKNOWN');assert.equal(JSON.stringify(r).includes('Bearer'),false);
});
test('strict parser refuses escaped duplicate keys',()=>{
 const f=fixture(); const raw=bytes(JSON.stringify(f.manifest).replace('"artifacts":','"\\u0061rtifacts":[],"artifacts":'));
 assert.throws(()=>parseOwnerManifest(raw),{reasonCode:'MANIFEST_INVALID'});
});
test('invalid UTF-8 rejected before JSON parse',()=>{
 assert.throws(()=>parseOwnerManifest(new Uint8Array([0xff])),{reasonCode:'MANIFEST_INVALID'});
});
test('unsafe identifiers rejected; valid 64-character ASCII preserved',()=>{
 const f=fixture();for(const bad of ['../file','https://example.com','\u001b[31m','X'.repeat(65),'🌼','']){
  const m={...f.manifest,manifestId:bad};assert.throws(()=>parseOwnerManifest(bytes(m)),{reasonCode:'MANIFEST_INVALID'});
 }
 const m={...f.manifest,manifestId:'A'.repeat(64)};assert.equal(parseOwnerManifest(bytes(m)).manifestId,'A'.repeat(64));
});
test('128 selected refs accepted, 129 rejected before artifact reads',()=>{
 const f=fixture();const m=f.manifest,i=f.intent;
 const manifest={...m,artifacts:m.artifacts.filter(a=>a.kind!=='ac')};
 const intent={...i,ac:[]};
 for(let n=0;n<126;n++){
  const id='ac-'+(n+1);manifest.artifacts.push({...m.artifacts[3],artifactId:id,relativePath:id+'.md'});intent.ac.push({artifactId:id,revision:'R1'});
 }
 const good={...manifest,artifacts:manifest.artifacts.slice(0,-1)}, goodIntent={...intent,ac:intent.ac.slice(0,-1)};
 assert.equal(resolveTaskIntent(parseOwnerManifest(bytes(good)),parseTaskIntent(bytes(goodIntent))).complete,true);
 const over=resolveTaskIntent(parseOwnerManifest(bytes(manifest)),parseTaskIntent(bytes(intent)));check(over,'SELECTED_ARTIFACT_LIMIT_EXCEEDED');assert.deepEqual(over.refs,[]);
});
test('real fs reads binary and rejects symlinks/traversal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'justice-s1a-'));try{
  await mkdir(join(root,'child'));await writeFile(join(root,'child','safe'),new Uint8Array([0,255,10]));await symlink(join(root,'child'),join(root,'link'));
  const src=createS1aReadOnlySource(); assert.deepEqual(await src.readArtifact(root,'child/safe',3),new Uint8Array([0,255,10]));
  await assert.rejects(()=>src.readArtifact(root,'../leak',100),{kind:'unsafe_path'});
  await assert.rejects(()=>src.readArtifact(root,'link/safe',100),{kind:'unsafe_path'});
  await assert.rejects(()=>src.readArtifact(root,'child/safe',2),{kind:'over_limit'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('real fs zero-byte limit accepts zero, rejects positive',async()=>{
 const root=await mkdtemp(join(tmpdir(),'justice-s1a-'));try{
  await writeFile(join(root,'empty'),'');await writeFile(join(root,'data'),'X');
  const src=createS1aReadOnlySource();assert.equal((await src.readArtifact(root,'empty',0)).length,0);
  await assert.rejects(()=>src.readArtifact(root,'data',0),{kind:'over_limit'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI returns JSON only, and does not infer approval',async()=>{
 const f=fixture(),s=mockSource(f),i=input(f);
 const cli=await runS1aCli(['check','--manifest','manifest','--manifest-sha256',i.expectedManifestSha256,'--intent','intent','--artifacts-root','root'],s);
 assert.equal(cli.exitCode,0);assert.equal(JSON.parse(cli.stdout).identityStatus,'MATCH');assert.equal(JSON.parse(cli.stdout).eligibleBaseline,false);
 assert.equal(cli.stdout.endsWith('\n'),true);
 const malformed=await runS1aCli(['bad','--password','token-secret'],s);assert.equal(malformed.exitCode,64);assert.equal(malformed.stdout.includes('token-secret'),false);
});
test('CLI invoked through a symlink handles unknown commands with exit 64',async()=>{
 const root=await mkdtemp(join(tmpdir(),'justice-s1a-cli-'));try{
  const link=join(root,'justice-s1a');
  await symlink(resolve('dist/runtime/s1a-cli.js'),link);
  const result=spawnSync(execPath,[link,'unknown'],{encoding:'utf8'});
  assert.equal(result.status,64);
  assert.equal(JSON.parse(result.stdout).checks[0].reasonCode,'CLI_ARGUMENT_INVALID');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('N-DIAG-01/02 complete JSON matches contract and never emits input secrets',async()=>{
 const f=fixture();const modified={...f.manifest,artifacts:f.manifest.artifacts.map((r,i)=>i===0?{...r,artifactId:'../../private?token=secret'}:r)};
 const a=await loadS1aArtifacts({...input(f),expectedManifestSha256:sha(bytes(modified))},mockSource(f,{manifest:modified}));
 const expectedA={schemaVersion:'justice-s1a-result-v1',manifestDigestMatch:true,identityStatus:'UNKNOWN',ownerAuthorityStatus:'NOT_PROVEN',ownerTrustPrecondition:'EXTERNAL_NOT_VERIFIED_BY_S1A',identityCandidateReady:false,eligibleBaseline:false,selectedRefs:[],checks:[{targetId:'manifest',check:'schema',outcome:'UNKNOWN',reasonCode:'MANIFEST_INVALID',category:'INPUT_INVALID'}],limitations:['OWNER_ORIGIN_NOT_VERIFIED','SUPERSESSION_NOT_CHECKED','HOST_EXECUTION_NOT_PROVEN','FILESYSTEM_RACE_FREEDOM_NOT_PROVEN']};
 assert.deepEqual(a,expectedA);
 const alteredIntent={...f.intent,scopeKey:'scope-1\nBearer-secret'};
 const b=await loadS1aArtifacts(input(f),mockSource(f,{intent:alteredIntent}));
 assert.deepEqual(b,{...expectedA,manifestId:'fixture-1',checks:[{targetId:'task-intent',check:'schema',outcome:'UNKNOWN',reasonCode:'TASK_INTENT_INVALID',category:'INPUT_INVALID'}]});
});
test('N-LIM-01 129 refs emits UNKNOWN and zero artifact reads',async()=>{
 const f=fixture(),m={...f.manifest,artifacts:f.manifest.artifacts.filter(x=>x.kind!=='ac')};
 const i={...f.intent,ac:[]};for(let n=1;n<=126;n++){const id='ac-'+n;m.artifacts.push({...f.manifest.artifacts[3],artifactId:id,relativePath:id+'.md'});i.ac.push({artifactId:id,revision:'R1'});}
 let artifactReads=0;const source=mockSource(f,{manifest:m,intent:i});const wrapped={readInputFile:source.readInputFile,async readArtifact(...args){artifactReads++;return source.readArtifact(...args);}};
 const r=await loadS1aArtifacts({...input(f),expectedManifestSha256:sha(bytes(m))},wrapped);
 assert.equal(artifactReads,0);check(r,'SELECTED_ARTIFACT_LIMIT_EXCEEDED');assert.equal(r.identityStatus,'UNKNOWN');assert.deepEqual(r.selectedRefs,[]);
});
test('N-LIM-02 exact total 33,554,432 accepted; 33,554,433 rejected with UNKNOWN',async()=>{
 const big= new Uint8Array(S1A_LIMITS.artifactBytes); big.fill(65); const small=new Uint8Array([65]);
 const f=fixture(); const m={...f.manifest,artifacts:f.manifest.artifacts.map((r,i)=>({...r,digest:{algorithm:'sha256',hex:sha(i<4?big:new Uint8Array())}}))};
 const map={};m.artifacts.forEach((a,i)=>map[a.relativePath]=i<4?big:new Uint8Array());
 const make=(mapping)=>{let calls=0;const readPaths=[];return {get calls(){return calls;},readPaths,async readInputFile(p){return bytes(p==='manifest'?m:f.intent);},async readArtifact(root,path,cap){calls++;readPaths.push(path);const v=mapping[path];if(v.length>cap)throw {kind:'over_limit'};return v;}}};
 const inp={...input(f),expectedManifestSha256:sha(bytes(m))};const goodSrc=make(map);
 const good=await loadS1aArtifacts(inp,goodSrc);
 assert.equal(good.identityStatus,'MATCH');assert.equal(good.selectedRefs.length,6);assert.equal(goodSrc.calls,6);
 const changed={...map,'ac-2.md':small};const badSrc=make(changed);
 const over=await loadS1aArtifacts(inp,badSrc);check(over,'TOTAL_ARTIFACT_LIMIT_EXCEEDED');assert.equal(over.identityStatus,'UNKNOWN');assert.equal(over.identityCandidateReady,false);assert.equal(over.eligibleBaseline,false);assert.equal(badSrc.calls,5);assert.equal(over.selectedRefs.length,6);assert.equal(over.selectedRefs[5].digestOutcome,'UNKNOWN');assert.equal(over.selectedRefs[5].observedDigest,null);assert.equal(badSrc.readPaths.includes('ac-3.md'),false);
});
test('N-LIM-02 observed earlier artifact digest MISMATCH overrides later total UNKNOWN',async()=>{
 const big=new Uint8Array(S1A_LIMITS.artifactBytes);const small=new Uint8Array([1]);
 const f=fixture();const m={...f.manifest,artifacts:f.manifest.artifacts.map((r,i)=>({...r,digest:{algorithm:'sha256',hex:sha(i<4?big:new Uint8Array())}}))};const reads=[];
 const artifactBytes=new Map([['ac-2.md',small],['ac-3.md',new Uint8Array()]]);
 const source={async readInputFile(p){return bytes(p==='manifest'?m:f.intent);},async readArtifact(root,path,cap){reads.push(path);const v=artifactBytes.get(path)??big;if(v.length>cap)throw {kind:'over_limit'};if(path==='design-1.md')return Uint8Array.from(v,()=>2);return v;}};
 const r=await loadS1aArtifacts({...input(f),expectedManifestSha256:sha(bytes(m))},source);
 assert.equal(r.identityStatus,'MISMATCH');check(r,'TOTAL_ARTIFACT_LIMIT_EXCEEDED');check(r,'ARTIFACT_DIGEST_MISMATCH');assert.equal(r.selectedRefs.length,6);assert.equal(r.selectedRefs[5].digestOutcome,'UNKNOWN');assert.equal(r.selectedRefs[5].observedDigest,null);assert.equal(reads.length,5);assert.equal(reads.includes('ac-3.md'),false);
});
test('CLI rejects duplicate flags, unknown flags and positional extras without raw echo',async()=>{
 const f=fixture(),s=mockSource(f),flags=['check','--manifest','manifest','--intent','intent','--artifacts-root','root'];
 for(const args of [[...flags,'--bad','token-secret'],[...flags,'oops'],[...flags,'--manifest','manifest-again']]){
  const x=await runS1aCli(args,s);assert.equal(x.exitCode,64);assert.equal(x.stdout.includes('token-secret'),false);check(JSON.parse(x.stdout),'CLI_ARGUMENT_INVALID');
 }
});
test('observed revision contradiction takes priority over 129-ref count gate',()=>{
 const f=fixture();const m={...f.manifest,artifacts:f.manifest.artifacts.filter(x=>x.kind!=='ac')};const i={...f.intent,plan:{artifactId:'plan-1',revision:'R0'},ac:[]};
 for(let n=1;n<=126;n++){const id='ac-'+n;m.artifacts.push({...f.manifest.artifacts[3],artifactId:id,relativePath:id+'.md'});i.ac.push({artifactId:id,revision:'R1'});}
 const r=resolveTaskIntent(parseOwnerManifest(bytes(m)),parseTaskIntent(bytes(i)));
 check(r,'REVISION_MISMATCH');assert.equal(r.complete,false);assert.equal(r.refs.length,0);
});
