// Real-fs exception (plan-mandated): disposable Git repositories are created under mkdtemp only,
// and only those test-created directories are removed. Git is never run against the project repo.
import {execFileSync} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,statSync,symlinkSync,unlinkSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';

const fsPromiseHooks = vi.hoisted(() => ({
  realpath: null as null | ((path: string) => Promise<string>),
  lstatCalls: 0,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    realpath: ((path: Parameters<typeof actual.realpath>[0]) => {
      const override = fsPromiseHooks.realpath;
      return override === null ? actual.realpath(path) : override(String(path));
    }) as typeof actual.realpath,
    lstat: ((...args: Parameters<typeof actual.lstat>) => {
      fsPromiseHooks.lstatCalls += 1;
      return actual.lstat(...args);
    }) as typeof actual.lstat,
  };
});

import {
  checkCleanBase,collectDailyChangeSet,createDailyGitReadPort,createDailyGitReadPortWithSpawner,
  type DailyGitReadPort,type GitReadResult,type GitSpawner,
} from '../../src/runtime/daily-changeset.js';
import {prepareDailyBinding,type AcquisitionRule,type DailyBinding,type DailyOwnerConfig} from '../../src/runtime/daily-intent.js';
import {makeDailyFixture} from '../helpers/daily-fixtures.js';

const created:string[]=[];
afterEach(()=>{
  vi.useRealTimers();
  fsPromiseHooks.realpath=null;
  fsPromiseHooks.lstatCalls=0;
  for(const dir of created.splice(0))rmSync(dir,{recursive:true,force:true});
});
const sig=():AbortSignal=>new AbortController().signal;
const MiB=1_048_576;

type GitFixture={
  root:string;base:string;config:DailyOwnerConfig;binding:DailyBinding;git:DailyGitReadPort;
  write(path:string,bytes:string|Uint8Array):void;
  runFixtureGit(args:readonly string[],input?:string):string;
  snapshotIdentity():Record<string,unknown>;
  configFor(root:string,base?:string):Promise<DailyOwnerConfig>;
  dispose():void;
};

async function dailyFor(root:string,base:string){
  const rule=(ruleId:string,ac:string,file:string):AcquisitionRule=>({ruleId,acRef:{artifactId:ac,revision:'R1'},purpose:'TEST_INVOCATION',tool:'shell',
    input:{command:`bun run vitest run tests/${file}`,workdir:root,timeout:5000,background:false}});
  return makeDailyFixture({approvalPatch:{worktreeRoot:root,baseCommit:base,rules:[rule('r1','ac-1','a.test.ts'),rule('r2','ac-2','b.test.ts')]}});
}
const configFor=async(root:string,base:string):Promise<DailyOwnerConfig>=>(await dailyFor(root,base)).config;

/** TEST_ONLY disposable repository; git runs with an isolated, fixed environment. */
async function makeGitFixture():Promise<GitFixture>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'justice-daily-git-')));
  created.push(dir);
  const root=join(dir,'repo'),home=join(dir,'home');
  mkdirSync(root);mkdirSync(home);
  const env={PATH:process.env.PATH??'/usr/bin:/bin',HOME:home,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',LC_ALL:'C'};
  const runFixtureGit=(args:readonly string[],input?:string):string=>
    execFileSync('git',['-C',root,...args],{env,input,encoding:'latin1',stdio:['pipe','pipe','ignore']});
  const write=(path:string,bytes:string|Uint8Array):void=>{
    mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);
  };
  runFixtureGit(['init','-q','-b','main']);
  runFixtureGit(['config','--local','user.name','Fixture']);
  runFixtureGit(['config','--local','user.email','fixture@example.invalid']);
  write('src/a.ts','export const a = 1;\n');
  write('src/old.ts','export const old = 1;\n');
  runFixtureGit(['add','-A']);
  runFixtureGit(['commit','-q','-m','base']);
  const base=runFixtureGit(['rev-parse','HEAD']).trim();
  const df=await dailyFor(root,base);
  const config=df.config;
  const git=createDailyGitReadPort(config);
  // Re-prepare the T1 binding for this root/base with the real clean-base check.
  const ports={...df.ports,checkCleanBase:(c:DailyOwnerConfig,s:AbortSignal)=>checkCleanBase(c,git,s)};
  const start=await prepareDailyBinding(config,ports,sig());
  if(start.state!=='READY')throw Error(`fixture binding failed: ${start.reason}`);
  const walk=(rel:string,out:Record<string,string>):Record<string,string>=>{
    for(const e of readdirSync(join(root,rel),{withFileTypes:true})){
      const p=rel===''?e.name:`${rel}/${e.name}`;
      if(p==='.git')continue;
      if(e.isDirectory())walk(p,out);
      else out[p]=e.isSymbolicLink()?'symlink':readFileSync(join(root,p)).toString('hex');
    }
    return out;
  };
  return {
    root,base,config,binding:start.binding,git,write,runFixtureGit,
    snapshotIdentity:()=>({
      head:runFixtureGit(['rev-parse','HEAD']),
      index:readFileSync(join(root,'.git','index')).toString('hex'),
      porcelain:runFixtureGit(['status','--porcelain=v1','-z','--untracked-files=all']),
      files:walk('',{}),
    }),
    configFor:(r,b)=>configFor(r,b??base),
    dispose:()=>rmSync(dir,{recursive:true,force:true}),
  };
}

const key=(args:readonly string[]):string=>args.join(' ');
/** Wraps the real port; the hook may replace or observe individual calls. */
function wrapPort(inner:DailyGitReadPort,hook:(args:readonly string[],real:()=>Promise<GitReadResult>,n:number)=>Promise<GitReadResult>):DailyGitReadPort{
  const counts=new Map<string,number>();
  return {run(args,maxBytes,signal){
    const n=(counts.get(key(args))??0)+1;counts.set(key(args),n);
    return hook(args,()=>inner.run(args,maxBytes,signal),n);
  }};
}
const okOut=(text:string|Uint8Array,exitCode=0):GitReadResult=>({state:'OK',exitCode,stdout:typeof text==='string'?new TextEncoder().encode(text):text});
const isUntracked=(a:readonly string[])=>a[0]==='ls-files'&&a[1]==='--others';
const isUnstaged=(a:readonly string[])=>a[0]==='diff'&&a.length===7;

async function collectUnchanged(f:GitFixture,git:DailyGitReadPort=f.git){
  const before=f.snapshotIdentity();
  const result=await collectDailyChangeSet(f.binding,git,sig());
  expect(f.snapshotIdentity()).toEqual(before);
  return result;
}

describe('collectDailyChangeSet (real disposable git)',()=>{
  it('keeps independent staged and untracked paths without changing the repo',async()=>{
    const f=await makeGitFixture();
    try{
      f.write('src/a.ts','changed');
      f.runFixtureGit(['add','src/a.ts']);
      f.write('outside.txt','new');
      const before=f.snapshotIdentity();
      const result=await collectDailyChangeSet(f.binding,f.git,new AbortController().signal);
      expect(result.state).toBe('VALID');
      if(result.state!=='VALID')throw Error('expected stable fixture');
      expect(result.changeSet.changes).toEqual([{kind:'ADD',path:'outside.txt'},{kind:'MODIFY',path:'src/a.ts'}]);
      expect(f.snapshotIdentity()).toEqual(before);
    }finally{f.dispose();}
  });

  it('reports committed ADD/MODIFY/DELETE from the fixed base to current HEAD',async()=>{
    const f=await makeGitFixture();
    f.write('src/a.ts','export const a = 2;\n');f.write('src/new.ts','new\n');
    f.runFixtureGit(['rm','-q','src/old.ts']);f.runFixtureGit(['add','-A']);f.runFixtureGit(['commit','-q','-m','work']);
    const head=f.runFixtureGit(['rev-parse','HEAD']).trim();
    const result=await collectUnchanged(f);
    expect(result).toEqual({state:'VALID',baseCommit:f.base,headCommit:head,changeSet:{availability:'PRESENT',changes:[
      {kind:'MODIFY',path:'src/a.ts'},{kind:'ADD',path:'src/new.ts'},{kind:'DELETE',path:'src/old.ts'}]}});
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('reports a rename as DELETE old + ADD new (no rename detection)',async()=>{
    const f=await makeGitFixture();
    f.runFixtureGit(['mv','src/old.ts','outside.txt']);f.runFixtureGit(['commit','-q','-m','mv']);
    const result=await collectUnchanged(f);
    expect(result.state==='VALID'&&result.changeSet.changes).toEqual([{kind:'ADD',path:'outside.txt'},{kind:'DELETE',path:'src/old.ts'}]);
  });

  it('reports both sides of an unstaged rename with intent-to-add',async()=>{
    const f=await makeGitFixture();
    renameSync(join(f.root,'src/old.ts'),join(f.root,'outside.txt'));
    f.runFixtureGit(['add','-N','outside.txt']);
    const result=await collectUnchanged(f);
    expect(result.state==='VALID'&&result.changeSet.changes).toEqual([
      {kind:'ADD',path:'outside.txt'},{kind:'DELETE',path:'src/old.ts'}]);
  });

  it('reports a staged rename as DELETE old + ADD new',async()=>{
    const f=await makeGitFixture();
    f.runFixtureGit(['mv','src/old.ts','outside.txt']);
    const result=await collectUnchanged(f);
    expect(result).toEqual({state:'VALID',baseCommit:f.base,headCommit:f.base,
      changeSet:{availability:'PRESENT',changes:[
        {kind:'ADD',path:'outside.txt'},{kind:'DELETE',path:'src/old.ts'}]}});
  });

  it('reports a staged copy as ADD at the copied path',async()=>{
    const f=await makeGitFixture();
    f.write('src/copied.ts','export const old = 1;\n');
    f.runFixtureGit(['add','src/copied.ts']);
    const result=await collectUnchanged(f);
    expect(result).toEqual({state:'VALID',baseCommit:f.base,headCommit:f.base,
      changeSet:{availability:'PRESENT',changes:[{kind:'ADD',path:'src/copied.ts'}]}});
  });

  it('collapses staged+unstaged same-kind duplicates and keeps distinct kinds for one path',async()=>{
    const f=await makeGitFixture();
    f.write('src/n.ts','1');f.runFixtureGit(['add','src/n.ts']);f.runFixtureGit(['commit','-q','-m','add n']);
    f.write('src/n.ts','2');
    f.write('src/a.ts','staged');f.runFixtureGit(['add','src/a.ts']);f.write('src/a.ts','unstaged');
    const result=await collectUnchanged(f);
    expect(result.state==='VALID'&&result.changeSet.changes).toEqual([
      {kind:'MODIFY',path:'src/a.ts'},{kind:'ADD',path:'src/n.ts'},{kind:'MODIFY',path:'src/n.ts'}]);
  });

  const touchOnly=(f:GitFixture,path:string):void=>{
    const abs=join(f.root,path),before=statSync(abs).mtimeMs;
    const past=new Date('2001-02-03T04:05:06Z');
    utimesSync(abs,past,past);
    expect(statSync(abs).mtimeMs).not.toBe(before); // stat info now differs from the index entry
  };

  it('does not rewrite .git/index or report MODIFY for a stat-only (touched) tracked file',async()=>{
    const f=await makeGitFixture();
    touchOnly(f,'src/a.ts');
    const indexBefore=readFileSync(join(f.root,'.git','index'));
    const result=await collectUnchanged(f);
    expect(readFileSync(join(f.root,'.git','index')).equals(indexBefore)).toBe(true);
    expect(result).toEqual({state:'VALID',baseCommit:f.base,headCommit:f.base,changeSet:{availability:'PRESENT',changes:[]}});
  });

  it('reports only the real content change when combined with a touched-only file',async()=>{
    const f=await makeGitFixture();
    touchOnly(f,'src/a.ts');
    f.write('src/old.ts','export const old = 2;\n');
    const indexBefore=readFileSync(join(f.root,'.git','index'));
    const result=await collectUnchanged(f);
    expect(readFileSync(join(f.root,'.git','index')).equals(indexBefore)).toBe(true);
    expect(result).toEqual({state:'VALID',baseCommit:f.base,headCommit:f.base,changeSet:{availability:'PRESENT',changes:[{kind:'MODIFY',path:'src/old.ts'}]}});
  });

  it('checkCleanBase does not rewrite .git/index for a touched-only file',async()=>{
    const f=await makeGitFixture();
    touchOnly(f,'src/a.ts');
    const indexBefore=readFileSync(join(f.root,'.git','index'));
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'OK'});
    expect(readFileSync(join(f.root,'.git','index')).equals(indexBefore)).toBe(true);
  });

  it('returns an empty PRESENT set only for a genuinely clean stable snapshot',async()=>{
    const f=await makeGitFixture();
    expect(await collectUnchanged(f)).toEqual({state:'VALID',baseCommit:f.base,headCommit:f.base,changeSet:{availability:'PRESENT',changes:[]}});
  });

  it('rejects committed symlinks, type changes and gitlinks as GIT_UNSUPPORTED',async()=>{
    const f=await makeGitFixture();
    symlinkSync('a.ts',join(f.root,'src/link.ts'));f.runFixtureGit(['add','src/link.ts']);f.runFixtureGit(['commit','-q','-m','link']);
    expect(await collectUnchanged(f)).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});

    const g=await makeGitFixture();
    unlinkSync(join(g.root,'src/a.ts'));symlinkSync('old.ts',join(g.root,'src/a.ts'));
    expect(await collectUnchanged(g)).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});

    const h=await makeGitFixture();
    h.runFixtureGit(['update-index','--add','--cacheinfo',`160000,${h.base},sub`]);
    expect(await collectUnchanged(h)).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('rejects unmerged index entries (conflict)',async()=>{
    const f=await makeGitFixture();
    const blob=f.runFixtureGit(['rev-parse','HEAD:src/a.ts']).trim();
    f.runFixtureGit(['update-index','--index-info'],
      `0 ${'0'.repeat(40)}\tsrc/a.ts\n100644 ${blob} 1\tsrc/a.ts\n100644 ${blob} 2\tsrc/a.ts\n100644 ${blob} 3\tsrc/a.ts\n`);
    expect(await collectUnchanged(f)).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('rejects a HEAD that does not descend from the fixed base',async()=>{
    const f=await makeGitFixture();
    f.runFixtureGit(['checkout','-q','--orphan','other']);f.runFixtureGit(['commit','-q','-m','orphan']);
    expect(await collectUnchanged(f)).toEqual({state:'UNAVAILABLE',reason:'BASE_MISMATCH'});
  });

  it.each([['--assume-unchanged'],['--skip-worktree']])('rejects ls-files -v flag %s',async(flag)=>{
    const f=await makeGitFixture();
    f.runFixtureGit(['update-index',flag,'src/a.ts']);
    expect(await collectUnchanged(f)).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('rejects paths containing control characters',async()=>{
    const f=await makeGitFixture();
    f.write('bad\u0001name.ts','x');
    expect(await collectUnchanged(f)).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('accepts 128 entries and rejects 129 entries as GIT_LIMIT',async()=>{
    const f=await makeGitFixture();
    for(let i=0;i<127;i++)f.write(`gen/f${String(i).padStart(3,'0')}.txt`,'x');
    f.write('src/a.ts','changed');
    const ok=await collectUnchanged(f);
    expect(ok.state==='VALID'&&ok.changeSet.changes.length).toBe(128);
    f.write('gen/f127.txt','x');
    expect(await collectUnchanged(f)).toEqual({state:'UNAVAILABLE',reason:'GIT_LIMIT'});
  });

  it.each([
    ['HEAD',(f:GitFixture)=>{f.write('src/a.ts','drift');f.runFixtureGit(['commit','-q','-am','drift']);}],
    ['status',(f:GitFixture)=>{f.write('drift.txt','x');}],
    ['index',(f:GitFixture)=>{f.write('src/a.ts','drift');f.runFixtureGit(['add','src/a.ts']);}],
    ['config',(f:GitFixture)=>{f.runFixtureGit(['config','--local','user.name','Other']);}],
  ])('rejects %s drift during collection as GIT_UNSTABLE',async(_name,mutate)=>{
    const f=await makeGitFixture();
    const git=wrapPort(f.git,async(args,real,n)=>{
      if(args[0]==='diff'&&n===1&&args[1]==='--cached')mutate(f);
      return real();
    });
    expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSTABLE'});
  });

  it('rejects root drift between snapshots as GIT_UNSTABLE',async()=>{
    const f=await makeGitFixture();
    const git=wrapPort(f.git,async(args,real,n)=>args[1]==='--show-toplevel'&&n===2?okOut(`${f.root}/x\n`):real());
    expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSTABLE'});
  });
});

describe('collectDailyChangeSet (spy port fixtures)',()=>{
  it.each([
    ['invalid UTF-8',Uint8Array.from([0x61,0xff,0x00])],
    ['traversal','../escape.ts\0'],
    ['absolute','/etc/passwd\0'],
    ['empty segment','a//b\0'],
    ['missing NUL terminator','partial.ts'],
    ['trailing slash directory','nested/\0'],
  ])('rejects untracked output with %s as GIT_UNSUPPORTED',async(_n,stdout)=>{
    const f=await makeGitFixture();
    const git=wrapPort(f.git,async(args,real)=>isUntracked(args)?okOut(stdout):real());
    expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('rejects unsafe unstaged paths before status-based filtering',async()=>{
    const f=await makeGitFixture();
    const git=wrapPort(f.git,async(args,real)=>{
      if(args[0]==='status')return okOut('');
      if(isUnstaged(args))return okOut('M\0../escape.ts\0');
      return real();
    });
    expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it.each([['T\0src/a.ts\0'],['R100\0src/a.ts\0b.ts\0'],['U\0src/a.ts\0'],['M\0'],['X\0src/a.ts\0']])(
    'rejects diff status output %j as GIT_UNSUPPORTED',async(stdout)=>{
      const f=await makeGitFixture();
      const git=wrapPort(f.git,async(args,real)=>isUnstaged(args)?okOut(stdout):real());
      expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    });

  it('rejects a ChangeSet whose JSON exceeds 262,144 bytes as GIT_LIMIT',async()=>{
    const f=await makeGitFixture();
    const q=(n:number)=>'"'.repeat(n);
    const paths=Array.from({length:128},(_,i)=>`${q(250)}/${q(250)}/${q(250)}/${q(250)}/${q(10)}${String(i).padStart(3,'0')}`);
    const git=wrapPort(f.git,async(args,real)=>isUntracked(args)?okOut(paths.map(p=>`${p}\0`).join('')):real());
    expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_LIMIT'});
  });

  it.each([
    ['rename', 'R  renamed.ts\0old.ts\0'],
    ['copy', ' C copied.ts\0source.ts\0'],
  ])('accepts a paired %s status record',async(_kind,status)=>{
    const f=await makeGitFixture();
    const git=wrapPort(f.git,async(args,real)=>args[0]==='status'?okOut(status):real());
    expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({
      state:'VALID',baseCommit:f.base,headCommit:f.base,
      changeSet:{availability:'PRESENT',changes:[]}});
  });

  it('rejects a rename status record without its second path',async()=>{
    const f=await makeGitFixture();
    const git=wrapPort(f.git,async(args,real)=>args[0]==='status'?okOut('R  renamed.ts\0'):real());
    expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('maps port failures and contract violations to fixed reasons, never an empty PRESENT',async()=>{
    const f=await makeGitFixture();
    const cases:[(a:readonly string[])=>boolean,()=>Promise<GitReadResult>,string][]=[
      [a=>a[0]==='status',async()=>({state:'UNAVAILABLE',reason:'GIT_LIMIT'}),'GIT_LIMIT'],
      [a=>a[0]==='status',async()=>okOut(new Uint8Array(MiB+1)),'GIT_LIMIT'],
      [isUnstaged,async()=>okOut('',1),'GIT_UNAVAILABLE'],
      [isUnstaged,async()=>{throw Error('boom /secret/path');},'GIT_UNAVAILABLE'],
      [isUnstaged,async()=>({state:'UNAVAILABLE',reason:'TIMEOUT'}),'TIMEOUT'],
      [isUnstaged,async()=>({state:'UNAVAILABLE',reason:'NOT_A_REASON'} as unknown as GitReadResult),'GIT_UNAVAILABLE'],
      [isUnstaged,async()=>({state:'OK',exitCode:0,stdout:'M\0a\0'} as unknown as GitReadResult),'GIT_UNAVAILABLE'],
      [a=>a[1]==='--show-object-format',async()=>okOut('sha256\n'),'GIT_UNSUPPORTED'],
      [a=>a[1]==='--verify',async()=>okOut('HEAD\n'),'GIT_UNSUPPORTED'],
    ];
    for(const [match,replace,reason] of cases){
      const git=wrapPort(f.git,async(args,real)=>match(args)?replace():real());
      expect(await collectDailyChangeSet(f.binding,git,sig())).toEqual({state:'UNAVAILABLE',reason});
    }
  });

  it('returns ABORTED for a pre-aborted or mid-run cancelled signal',async()=>{
    const f=await makeGitFixture();
    const pre=new AbortController();pre.abort();
    expect(await collectDailyChangeSet(f.binding,f.git,pre.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    expect(await checkCleanBase(f.config,f.git,pre.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    const ctl=new AbortController();
    const hang:DailyGitReadPort={run:()=>{ctl.abort();return new Promise<GitReadResult>(()=>{});}};
    expect(await collectDailyChangeSet(f.binding,hang,ctl.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });

  it('returns ABORTED while root inspection is still pending and does not continue filesystem checks',async()=>{
    const f=await makeGitFixture();
    const ctl=new AbortController();
    let entered!:()=>void;
    const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});
    let release!: (path:string)=>void;
    const pendingRoot=new Promise<string>(resolve=>{release=resolve;});
    fsPromiseHooks.lstatCalls=0;
    fsPromiseHooks.realpath=()=>{entered();return pendingRoot;};
    const pending=collectDailyChangeSet(f.binding,f.git,ctl.signal);
    await enteredPromise;
    let settled=false;
    void pending.then(()=>{settled=true;});
    ctl.abort();
    try{
      await vi.waitFor(()=>expect(settled).toBe(true),{timeout:1_000,interval:10});
    }finally{
      release(f.root);
      fsPromiseHooks.realpath=null;
    }
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    await Promise.resolve();
    expect(fsPromiseHooks.lstatCalls).toBe(0);
  });

  it('enforces the snapshot deadline while root inspection is still pending',async()=>{
    const f=await makeGitFixture();
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    let entered!:()=>void;
    const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});
    let release!: (path:string)=>void;
    const pendingRoot=new Promise<string>(resolve=>{release=resolve;});
    fsPromiseHooks.lstatCalls=0;
    fsPromiseHooks.realpath=()=>{entered();return pendingRoot;};
    const pending=collectDailyChangeSet(f.binding,f.git,sig());
    await enteredPromise;
    await vi.advanceTimersByTimeAsync(30_000);
    let settled=false;
    void pending.then(()=>{settled=true;});
    await Promise.resolve();
    await Promise.resolve();
    try{
      expect(settled).toBe(true);
    }finally{
      release(f.root);
      fsPromiseHooks.realpath=null;
    }
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'TIMEOUT'});
    await Promise.resolve();
    expect(fsPromiseHooks.lstatCalls).toBe(0);
  });

  it('enforces the 30 second aggregate snapshot deadline as TIMEOUT',async()=>{
    const f=await makeGitFixture();
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    const hang:DailyGitReadPort={run:()=>new Promise<GitReadResult>(()=>{})};
    const pending=collectDailyChangeSet(f.binding,hang,sig());
    await vi.advanceTimersByTimeAsync(29_999);
    let settled=false;void pending.then(()=>{settled=true;});
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'TIMEOUT'});
  });
});

describe('checkCleanBase',()=>{
  it('accepts the clean dedicated base checkout',async()=>{
    const f=await makeGitFixture();
    const before=f.snapshotIdentity();
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'OK'});
    expect(f.snapshotIdentity()).toEqual(before);
  });

  it.each([
    ['untracked file',(f:GitFixture)=>f.write('new.txt','x'),'DIRTY_BASE'],
    ['modified tracked file',(f:GitFixture)=>f.write('src/a.ts','x'),'DIRTY_BASE'],
    ['staged change',(f:GitFixture)=>{f.write('src/a.ts','x');f.runFixtureGit(['add','src/a.ts']);},'DIRTY_BASE'],
    ['HEAD moved past base',(f:GitFixture)=>{f.write('src/a.ts','x');f.runFixtureGit(['commit','-q','-am','x']);},'BASE_MISMATCH'],
  ])('rejects %s',async(_n,mutate,reason)=>{
    const f=await makeGitFixture();
    mutate(f);
    const before=f.snapshotIdentity();
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'UNAVAILABLE',reason});
    expect(f.snapshotIdentity()).toEqual(before);
  });

  it.each([
    ['alternates',(f:GitFixture)=>{mkdirSync(join(f.root,'.git/objects/info'),{recursive:true});writeFileSync(join(f.root,'.git/objects/info/alternates'),'/x\n');}],
    ['commondir',(f:GitFixture)=>writeFileSync(join(f.root,'.git/commondir'),'..\n')],
    ['grafts',(f:GitFixture)=>{mkdirSync(join(f.root,'.git/info'),{recursive:true});writeFileSync(join(f.root,'.git/info/grafts'),`${'a'.repeat(40)}\n`);}],
    ['symlinked .git',(f:GitFixture)=>{rmSync(join(f.root,'.git'),{recursive:true});symlinkSync(join(dirname(f.root),'home'),join(f.root,'.git'));}],
  ])('rejects shared/linked git metadata: %s',async(_n,mutate)=>{
    const f=await makeGitFixture();
    mutate(f);
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    expect(await collectDailyChangeSet(f.binding,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it.each([
    ['symlink',(f:GitFixture)=>{
      const index=join(f.root,'.git','index'),external=join(dirname(f.root),'external-index');
      writeFileSync(external,readFileSync(index));unlinkSync(index);symlinkSync(external,index);
    }],
    ['directory',(f:GitFixture)=>{
      const index=join(f.root,'.git','index');unlinkSync(index);mkdirSync(index);
    }],
  ])('rejects a non-regular .git/index (%s)',async(_kind,mutate)=>{
    const f=await makeGitFixture();
    mutate(f);
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    expect(await collectDailyChangeSet(f.binding,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it.each([
    [['config','--local','core.sparseCheckout','true']],
    [['config','--local','include.path','other.cfg']],
    [['config','--local','filter.x.clean','cat']],
    [['config','--local','diff.external','cat']],
    [['config','--local','core.fsmonitor','true']],
    [['config','--local','core.worktree','/tmp']],
    [['config','--local','extensions.noop','true']],
    [['config','--local','foo.bar','baz']],
    [['config','--local','--add','user.name','Second']],
    [['config','--local','branch.bad/name.remote','origin']],
    [['config','--local','core.repositoryformatversion','1']],
  ])('rejects unapproved repository config %j as GIT_UNSUPPORTED',async(args)=>{
    const f=await makeGitFixture();
    f.runFixtureGit(args);
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    expect(await collectDailyChangeSet(f.binding,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('accepts allowlisted remote and branch tracking config',async()=>{
    const f=await makeGitFixture();
    f.runFixtureGit(['config','--local','core.ignorecase','false']);
    f.runFixtureGit(['config','--local','remote.origin.url','https://example.invalid/repo.git']);
    f.runFixtureGit(['config','--local','remote.origin.fetch','+refs/heads/*:refs/remotes/origin/*']);
    f.runFixtureGit(['config','--local','branch.main.remote','origin']);
    f.runFixtureGit(['config','--local','branch.main.merge','refs/heads/main']);
    f.runFixtureGit(['config','--local','branch.dev.remote','origin']);
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'OK'});
  });

  it('rejects core.ignorecase=true',async()=>{
    const f=await makeGitFixture();
    f.runFixtureGit(['config','--local','core.ignorecase','true']);
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('maps inaccessible git metadata to GIT_UNAVAILABLE',async()=>{
    const f=await makeGitFixture();
    const info=join(f.root,'.git/objects/info');
    rmSync(info,{recursive:true});
    writeFileSync(info,'not a directory');
    expect(await checkCleanBase(f.config,f.git,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
  });

  it('rejects a linked worktree and a root that differs from the Owner root',async()=>{
    const f=await makeGitFixture();
    const linked=join(dirname(f.root),'linked');
    f.runFixtureGit(['worktree','add','-q','--detach',linked,f.base]);
    const linkedConfig=await f.configFor(linked);
    expect(await checkCleanBase(linkedConfig,createDailyGitReadPort(linkedConfig),sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    const subConfig=await f.configFor(join(f.root,'src'));
    expect(await checkCleanBase(subConfig,createDailyGitReadPort(subConfig),sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });

  it('rejects a base checkout with a gitlink in the index',async()=>{
    const f=await makeGitFixture();
    f.runFixtureGit(['update-index','--add','--cacheinfo',`160000,${f.base},sub`]);
    f.runFixtureGit(['commit','-q','-m','gitlink']);
    const config=await f.configFor(f.root,f.runFixtureGit(['rev-parse','HEAD']).trim());
    expect(await checkCleanBase(config,createDailyGitReadPort(config),sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
  });
});

class FakeChild extends EventEmitter{
  readonly stdout=new EventEmitter();readonly stderr=new EventEmitter();
  readonly kill=vi.fn((_signal?:string)=>true);
}
function fakeSpawner(){
  const calls:{file:string;args:readonly string[];options:unknown}[]=[];
  const children:FakeChild[]=[];
  const spawner:GitSpawner=(file,args,options)=>{
    calls.push({file,args:[...args],options});
    const child=new FakeChild();children.push(child);
    return child as unknown as ChildProcess;
  };
  return {spawner,calls,children};
}

describe('createDailyGitReadPort',()=>{
  const fakeConfig=()=>configFor('/tmp/justice-daily-port-fixture','b'.repeat(40));

  it('spawns fixed /usr/bin/git with the fixed prefix, fixed env and no shell',async()=>{
    const config=await fakeConfig();
    const {spawner,calls,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(config,spawner);
    const pending=port.run(['rev-parse','--show-toplevel'],MiB,sig());
    children[0]!.stdout.emit('data',Buffer.from('/tmp/'));
    children[0]!.stdout.emit('data',Buffer.from('x\n'));
    children[0]!.stderr.emit('data',Buffer.from('noise'));
    children[0]!.emit('close',0,null);
    expect(await pending).toEqual({state:'OK',exitCode:0,stdout:new TextEncoder().encode('/tmp/x\n')});
    expect(calls).toEqual([{file:'/usr/bin/git',
      args:['-C','/tmp/justice-daily-port-fixture','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','diff.autoRefreshIndex=false','rev-parse','--show-toplevel'],
      options:{env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1',LC_ALL:'C'},
        shell:false,stdio:['ignore','pipe','pipe'],windowsHide:true}}]);
  });

  it('rejects a Git read-failure warning on stderr without exposing its text',async()=>{
    const {spawner,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner);
    const pending=port.run(['rev-parse','--show-toplevel'],MiB,sig());
    children[0]!.stderr.emit('data',Buffer.from("warning: could not open directory 'private/secret': Permission denied\n"));
    children[0]!.emit('close',0,null);
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
  });

  it('rejects a Git read-failure warning with a nonzero exit code',async()=>{
    const {spawner,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner);
    const pending=port.run(['merge-base','--is-ancestor','b'.repeat(40),'c'.repeat(40)],MiB,sig());
    children[0]!.stderr.emit('data',Buffer.from("warning: could not open directory 'private/secret': Permission denied\n"));
    children[0]!.emit('close',1,null);
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
  });

  it('rejects a stderr stream read error without exposing its text',async()=>{
    const {spawner,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner);
    const pending=port.run(['rev-parse','--show-toplevel'],MiB,sig());
    children[0]!.stderr.emit('error',Error('read failed /private/secret'));
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
  });

  it('rejects a stdout stream read error and terminates the child',async()=>{
    const {spawner,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner);
    const pending=port.run(['rev-parse','--show-toplevel'],MiB,sig());
    const child=children[0]!;
    let thrown:unknown;
    try{
      child.stdout.emit('error',Error('read failed /private/secret'));
    }catch(error){
      thrown=error;
      child.emit('close',null);
    }
    expect(thrown).toBeUndefined();
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('accepts warning-free empty output on a successful Git command',async()=>{
    const {spawner,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner);
    const pending=port.run(['rev-parse','--show-toplevel'],MiB,sig());
    children[0]!.emit('close',0,null);
    expect(await pending).toEqual({state:'OK',exitCode:0,stdout:new Uint8Array()});
  });

  it('returns nonzero exit codes as data on normal termination',async()=>{
    const {spawner,children}=fakeSpawner();
    const config=await fakeConfig();
    const pending=createDailyGitReadPortWithSpawner(config,spawner).run(['merge-base','--is-ancestor','b'.repeat(40),'c'.repeat(40)],MiB,sig());
    children[0]!.emit('close',1,null);
    expect(await pending).toEqual({state:'OK',exitCode:1,stdout:new Uint8Array()});
  });

  it.each([
    [['status']],
    [['config','--list']],
    [['rev-parse','--show-toplevel','extra']],
    [['ls-tree','-r','-z','main']],
    [['ls-tree','-r','-z','HEAD~1']],
    [['merge-base','--is-ancestor','b'.repeat(40),'HEAD']],
    [['merge-base','--is-ancestor','d'.repeat(40),'c'.repeat(40)]],
    [['diff','--name-status','-z','--no-renames','--no-ext-diff','--no-textconv','d'.repeat(40),'c'.repeat(40),'--']],
    [['diff','--name-status','-z','--no-renames','--no-ext-diff','--no-textconv','--','src/a.ts']],
    [['diff','--name-status','-z','--no-renames','--no-ext-diff','--no-textconv','--ext-diff','--']],
    [['-c','core.pager=sh','status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none']],
    [['!sh','-c','id']],
    [['ls-files','--others','--exclude-standard','-z','$(touch x)']],
  ])('rejects non-allowlisted argv %j without spawning',async(args)=>{
    const {spawner,calls}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner);
    expect(await port.run(args,MiB,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    expect(calls).toEqual([]);
  });

  it.each([[0],[MiB+1],[1.5],[Number.NaN]])('rejects maxBytes %s without spawning',async(maxBytes)=>{
    const {spawner,calls}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner);
    expect(await port.run(['ls-files','-v','-z'],maxBytes,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNSUPPORTED'});
    expect(calls).toEqual([]);
  });

  it('kills only the launched child on oversize stdout',async()=>{
    const {spawner,children}=fakeSpawner();
    const pending=createDailyGitReadPortWithSpawner(await fakeConfig(),spawner).run(['ls-files','-v','-z'],8,sig());
    children[0]!.stdout.emit('data',Buffer.from('12345'));
    children[0]!.stdout.emit('data',Buffer.from('6789'));
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'GIT_LIMIT'});
    expect(children[0]!.kill).toHaveBeenCalledTimes(1);
    expect(children[0]!.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('times out a child after 5 seconds and kills it',async()=>{
    const config=await fakeConfig();
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    const {spawner,children}=fakeSpawner();
    const pending=createDailyGitReadPortWithSpawner(config,spawner).run(['ls-files','-v','-z'],MiB,sig());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'TIMEOUT'});
    expect(children[0]!.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('aborts a running child on cancellation and refuses to spawn when pre-aborted',async()=>{
    const config=await fakeConfig();
    const {spawner,calls,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(config,spawner);
    const ctl=new AbortController();
    const pending=port.run(['ls-files','-v','-z'],MiB,ctl.signal);
    ctl.abort();
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    expect(children[0]!.kill).toHaveBeenCalledWith('SIGKILL');
    expect(await port.run(['ls-files','-v','-z'],MiB,ctl.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    expect(calls).toHaveLength(1);
  });

  it('maps spawn errors and signal termination to GIT_UNAVAILABLE',async()=>{
    const config=await fakeConfig();
    const {spawner,children}=fakeSpawner();
    const port=createDailyGitReadPortWithSpawner(config,spawner);
    const a=port.run(['ls-files','-v','-z'],MiB,sig());
    children[0]!.emit('error',Error('spawn ENOENT /usr/bin/git'));
    expect(await a).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
    const b=port.run(['ls-files','-v','-z'],MiB,sig());
    children[1]!.emit('close',null,'SIGTERM');
    expect(await b).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
    const throwing=createDailyGitReadPortWithSpawner(config,()=>{throw Error('EACCES');});
    expect(await throwing.run(['ls-files','-v','-z'],MiB,sig())).toEqual({state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'});
  });

  it('runs the real fixed binary against the fixture without a shell',async()=>{
    const f=await makeGitFixture();
    const r=await f.git.run(['rev-parse','--show-toplevel'],MiB,sig());
    expect(r).toEqual({state:'OK',exitCode:0,stdout:new TextEncoder().encode(`${f.root}\n`)});
  });
});
