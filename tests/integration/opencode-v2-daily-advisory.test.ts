// Daily Assurance Task 5: Native x Superpowers explicit boundaries and V2 production wiring.
// Real-fs exception (plan-mandated, same as T3): each coordinator fixture creates one mkdtemp directory
// holding only empty `.git/objects` directories, so the T3 dedicated-checkout structure check can pass
// with a fake Git port. Only those test-created directories are removed. Native/Git are fake ports; no
// network, no real Git, no Credential, no LLM. `node:fs/promises` is wrapped pass-through so production
// supply tests can serve a bounded virtual Owner mount without touching the real host paths.
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createJusticeV2Plugin,type JusticeV2AdapterPort} from '../../src/opencode-v2-plugin.js';
import type {DailyGitReadPort} from '../../src/runtime/daily-changeset.js';
import {runDailyAdvisory,type DailyAdvisoryReport} from '../../src/runtime/daily-advisory.js';
import {DAILY_APPROVAL_ENV,DAILY_OWNER_ROOT,type AcquisitionRule} from '../../src/runtime/daily-intent.js';
import type {NativeBytes,NativeObservation,NativeReadPort} from '../../src/runtime/daily-native-evidence.js';
import {
  DAILY_SKILL_APPEND,createDailyCoordinator,createProductionDailyPorts,registerDailyAssurance,
  type BoundaryCall,type DailyCoordinatorPorts,type DailyPluginContext,type DailyRuntimeResult,
} from '../../src/runtime/daily-superpowers.js';
import {defaultPlanText,makeDailyFixture} from '../helpers/daily-fixtures.js';
import {assistantMessage,pageResponse,sessionResponse} from '../s2b/fixtures.js';

// ---------------------------------------------------------------------------
// Bounded virtual FS for production supply tests (pass-through for every other path)
// ---------------------------------------------------------------------------

const vfs=vi.hoisted(()=>({
  nodes:new Map<string,{type:'dir'}|{type:'file';bytes:Uint8Array}>(),
  realpaths:new Map<string,string>(),
  approvalReadGate:null as Promise<void>|null,
  accessed:[] as string[],
  writes:[] as string[],
}));
vi.mock('node:fs/promises',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  const virtualPath=(p:unknown):p is string=>typeof p==='string'&&(p==='/proc/self/mountinfo'||p==='/proc/self/exe'||p==='/run'||p.startsWith('/run/justice-daily')||vfs.realpaths.has(p));
  const enoent=():Error=>Object.assign(new Error('ENOENT'),{code:'ENOENT'});
  const statOf=(n:{type:'dir'}|{type:'file';bytes:Uint8Array})=>({
    isFile:()=>n.type==='file',isDirectory:()=>n.type==='dir',isSymbolicLink:()=>false,
    size:n.type==='file'?n.bytes.byteLength:0,dev:1,ino:1,mtimeMs:1,ctimeMs:1,
  });
  const write=(name:string,fn:(...a:never[])=>unknown)=>(...args:never[])=>{vfs.writes.push(name);return fn(...args);};
  return {
    ...actual,
    async lstat(p:string,...rest:never[]){
      if(virtualPath(p)&&!vfs.realpaths.has(p)){vfs.accessed.push(`lstat:${p}`);const n=vfs.nodes.get(p);if(!n)throw enoent();return statOf(n);}
      return (actual.lstat as (...a:unknown[])=>unknown)(p,...rest);
    },
    async realpath(p:string,...rest:never[]){
      if(virtualPath(p)){vfs.accessed.push(`realpath:${p}`);const r=vfs.realpaths.get(p)??(vfs.nodes.has(p)?p:undefined);if(r===undefined)throw enoent();return r;}
      return (actual.realpath as (...a:unknown[])=>unknown)(p,...rest);
    },
    async open(p:string,...rest:never[]){
      if(virtualPath(p)){
        vfs.accessed.push(`open:${p}`);
        const n=vfs.nodes.get(p);
        if(!n||n.type!=='file')throw enoent();
        let offset=0;
        return {
          async stat(){return statOf(n);},
          async read(buf:Uint8Array,off:number,len:number){
            if(p==='/run/justice-daily/owner/approval.json'&&vfs.approvalReadGate!==null)await vfs.approvalReadGate;
            const chunk=n.bytes.subarray(offset,offset+len);buf.set(chunk,off);offset+=chunk.byteLength;
            return {bytesRead:chunk.byteLength,buffer:buf};
          },
          async close(){},
        };
      }
      return (actual.open as (...a:unknown[])=>unknown)(p,...rest);
    },
    writeFile:write('writeFile',actual.writeFile as never),appendFile:write('appendFile',actual.appendFile as never),
    rename:write('rename',actual.rename as never),mkdir:write('mkdir',actual.mkdir as never),rm:write('rm',actual.rm as never),
    unlink:write('unlink',actual.unlink as never),
  };
});

const created:string[]=[];
afterEach(()=>{
  vi.unstubAllEnvs();
  vfs.nodes.clear();vfs.realpaths.clear();vfs.approvalReadGate=null;vfs.accessed.length=0;vfs.writes.length=0;
  for(const dir of created.splice(0))rmSync(dir,{recursive:true,force:true});
});

// ---------------------------------------------------------------------------
// Coordinator fixture
// ---------------------------------------------------------------------------

type Rec=Record<string,unknown>;
const enc=(s:string):Uint8Array=>new TextEncoder().encode(s);
const sha=(b:Uint8Array|string):string=>createHash('sha256').update(b).digest('hex');
type Deferred={promise:Promise<void>;resolve:()=>void};
function deferred():Deferred{
  let resolve:()=>void=()=>undefined;
  const promise=new Promise<void>(r=>{resolve=r;});
  return {promise,resolve};
}
const GIT_CONFIG='core.repositoryformatversion\n0\0core.bare\nfalse\0core.filemode\ntrue\0core.logallrefupdates\ntrue\0';

type Timeline={beginSettled:boolean;prefixShells:string[];shells:string[];finish:boolean;extraFinishTools:Rec[]};
type CoordinatorFixtureOptions={gated?:boolean};

async function makeCoordinatorFixture(options:CoordinatorFixtureOptions={}){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'justice-daily-t5-')));
  created.push(dir);
  const root=join(dir,'repo');
  mkdirSync(join(root,'.git','objects'),{recursive:true});
  const rule=(ruleId:string,ac:string,file:string):AcquisitionRule=>({ruleId,acRef:{artifactId:ac,revision:'R1'},purpose:'TEST_INVOCATION',tool:'shell',
    input:{command:`bun run vitest run tests/${file}`,workdir:root,timeout:5000,background:false}});
  const daily=await makeDailyFixture({approvalPatch:{worktreeRoot:root,rules:[rule('r1','ac-1','a.test.ts'),rule('r2','ac-2','b.test.ts')]}});
  const SID=daily.approval.sessionId;
  const base=daily.approval.baseCommit;
  const ruleInput=(id:string):Rec=>({...daily.approval.rules.find(r=>r.ruleId===id)!.input});
  const part=(id:string,name:string,input:Rec,status:'completed'|'running'):Rec=>({type:'tool',id,name,
    state:status==='completed'?{status,input,content:[{type:'text',text:'fixture'}]}:{status,input,metadata:{}},time:{created:2_000},executed:false});

  const timeline:Timeline={beginSettled:false,prefixShells:[],shells:[],finish:false,extraFinishTools:[]};
  const messages=():unknown[]=>{
    const list:unknown[]=[];
    if(timeline.prefixShells.length>0)list.push(assistantMessage('msg_000',timeline.prefixShells.map((r,i)=>part(`tool_pre${i}`,'shell',ruleInput(r),'completed'))));
    list.push(assistantMessage('msg_001',[part('tool_begin','justice_task_begin',{},timeline.beginSettled?'completed':'running')]));
    if(timeline.shells.length>0)list.push(assistantMessage('msg_002',timeline.shells.map((r,i)=>part(`tool_00${i+1}`,'shell',ruleInput(r),'completed'))));
    if(timeline.finish)list.push(assistantMessage('msg_003',[part('tool_finish','justice_task_finish',{},'running'),...timeline.extraFinishTools]));
    return list;
  };

  const gate=deferred();
  let gateArmed=options.gated===true;
  const holds:{skip:number;deferred:Deferred}[]=[];
  const nativeCalls:string[]=[];
  const sessionLocations:string[]=[];
  const sessionIds:string[]=[];
  let messageMode:'ok'|'rejected'|'incomplete'|'unavailable'='ok';
  let shellsBody=JSON.stringify({location:{directory:root},data:[]});
  const ok=(t:string):NativeBytes=>({state:'OK',bytes:enc(t)});
  const wait=async():Promise<void>=>{
    const pending=holds[0];
    if(pending?.skip){
      pending.skip-=1;
    }else if(pending){
      holds.shift();
      await pending.deferred.promise;
    }
    if(gateArmed&&timeline.finish)await gate.promise;
  };
  const native:NativeReadPort={
    async getSession(){nativeCalls.push('session');await wait();return ok(sessionResponse({id:sessionIds.shift()??SID,location:{directory:sessionLocations.shift()??root}}));},
    async getMessages(_s,query){
      nativeCalls.push('messages');
      if(timeline.finish&&messageMode==='rejected')return ok('{"data":[],"cursor":{},"extra":1}');
      if(timeline.finish&&messageMode==='unavailable')return {state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'};
      if(timeline.finish&&messageMode==='incomplete')return 'order' in query?ok(pageResponse(messages(),'cur-1')):{state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'};
      return ok(pageResponse(messages()));
    },
    async getRunningShells(){nativeCalls.push('shells');return ok(shellsBody);},
  };
  const gitCalls:string[]=[];
  const git:DailyGitReadPort={
    async run(args){
      gitCalls.push(args[0]!);
      const a=args.join(' ');
      const out=(s:string,exitCode=0)=>({state:'OK' as const,exitCode,stdout:enc(s)});
      if(a==='rev-parse --show-toplevel')return out(`${root}\n`);
      if(a==='rev-parse --show-object-format')return out('sha1\n');
      if(args[0]==='config')return out(GIT_CONFIG);
      if(a==='rev-parse --verify HEAD')return out(`${base}\n`);
      if(args[0]==='merge-base')return out('');
      if(args[0]==='status')return out('?? src/a.ts\0');
      if(args[0]==='ls-files'&&args.includes('--others'))return out('src/a.ts\0');
      if(args[0]==='ls-files'||args[0]==='ls-tree'||args[0]==='diff')return out('');
      return {state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'};
    },
  };
  let skillReady=true;
  const diagnose=vi.fn(runDailyAdvisory);
  const ports:DailyCoordinatorPorts={config:daily.config,preflight:daily.ports,native,git,isSkillReady:()=>skillReady,diagnose};
  const coordinator=createDailyCoordinator(ports);

  const call=(messageId:string,callId:string,sessionId:string=SID,signal:AbortSignal=new AbortController().signal):BoundaryCall=>
    ({sessionId,messageId,callId,agent:'build',signal});
  const emit=(messageId:string,callId:string,tool:string,phase:'BEFORE'|'AFTER',ruleId:string|null=null,o:Partial<NativeObservation>={}):void=>
    coordinator.observe({sessionId:SID,messageId,callId,tool,phase,status:phase==='BEFORE'?'STARTED':'COMPLETED',ruleId,...o});
  const shellPair=(ruleId:string,callId:string):void=>{
    emit('msg_002',callId,'shell','BEFORE',ruleId);emit('msg_002',callId,'shell','AFTER',ruleId);
  };
  const emitBeginAfter=():void=>{emit('msg_001','tool_begin','justice_task_begin','AFTER');timeline.beginSettled=true;};
  const emitFinishBefore=():void=>{emit('msg_003','tool_finish','justice_task_finish','BEFORE');timeline.finish=true;};
  // The begin control's own `execute.before` precedes its execution.
  emit('msg_001','tool_begin','justice_task_begin','BEFORE');
  const fixture={
    coordinator,ports,daily,root,SID,timeline,diagnose,preflight:daily.ports,gate,
    call,beginCall:call('msg_001','tool_begin'),finishCall:call('msg_003','tool_finish'),emit,shellPair,emitBeginAfter,emitFinishBefore,
    setArtifactBytes:(path:string,bytes:Uint8Array):void=>daily.setArtifactBytes(path,bytes),
    /** Exact settled begin `after`, the approved direct shell pairs (r1,r2), and the finish control `before`. */
    observePair():void{
      emitBeginAfter();
      shellPair('r1','tool_001');shellPair('r2','tool_002');
      timeline.shells=['r1','r2'];
      emitFinishBefore();
    },
     holdNextNative(skip=0):Deferred{const d=deferred();holds.push({skip,deferred:d});return d;},
     setSessionLocations(...locations:string[]):void{sessionLocations.push(...locations);},
     setSessionIds(...ids:string[]):void{sessionIds.push(...ids);},
     disarmGate():void{gateArmed=false;},
     setMessageMode(m:'ok'|'rejected'|'incomplete'|'unavailable'):void{messageMode=m;},
    setShells(body:string):void{shellsBody=body;},
    setSkillReady(r:boolean):void{skillReady=r;},
    get nativeReads():number{return nativeCalls.length;},
    get gitReads():number{return gitCalls.length;},
    nativeCalls,gitCalls,
  };
  return fixture;
}
type CoordinatorFixture=Awaited<ReturnType<typeof makeCoordinatorFixture>>;

async function begun(f:CoordinatorFixture):Promise<string>{
  const start=await f.coordinator.begin(f.beginCall);
  if(start.state!=='READY')throw Error(`fixture begin failed: ${start.reason}`);
  return start.bindingKey;
}
const flush=async():Promise<void>=>{for(let i=0;i<50;i++)await Promise.resolve();};

// ---------------------------------------------------------------------------
// Coordinator: RED set
// ---------------------------------------------------------------------------

describe('daily coordinator: bounded single Task',()=>{
  it("does not diagnose twice or promote a concurrent finish",async()=>{
    const f=await makeCoordinatorFixture({gated:true});
    const start=await f.coordinator.begin(f.beginCall);
    expect(start.state).toBe("READY");
    if(start.state!=="READY") throw Error("fixture begin failed");
    f.observePair();
    const a=f.coordinator.finish(start.bindingKey,f.finishCall);
    const b=f.coordinator.finish(start.bindingKey,f.call("msg_004","tool_finish2"));
    f.gate.resolve(); const [ra,rb]=await Promise.all([a,b]);
    expect(f.diagnose.mock.calls.length).toBeLessThanOrEqual(1);
    expect(ra.state).not.toBe("DIAGNOSED"); expect(rb.state).not.toBe("DIAGNOSED");
    // Shared promise: both callers observe the same single result, boundary marked uncertain.
    expect(rb).toBe(ra);
    expect(ra.reasons).toContain('BOUNDARY_UNCERTAIN');
  });

  it("does not accept an after-only or unfinished tool as evidence",async()=>{
    const f=await makeCoordinatorFixture();
    const start=await f.coordinator.begin(f.beginCall);
    if(start.state!=="READY") throw Error("fixture begin failed");
    f.coordinator.observe({sessionId:f.beginCall.sessionId,messageId:"msg_002",callId:"tool_late",
      tool:"shell",phase:"AFTER",status:"COMPLETED",ruleId:"r1"});
    const r=await f.coordinator.finish(start.bindingKey,f.finishCall);
    expect(r.state).not.toBe("DIAGNOSED"); expect(r.evidence.state).not.toBe("VALID");
    expect(r.formalVerdict).toBe("UNKNOWN");
  });

  it('taints only the after-only call even when the rest of the Task is exact',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.emit('msg_002','tool_late','shell','AFTER','r1');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['BOUNDARY_UNCERTAIN']});
    expect(r.scope.state).toBe('EVALUATED');
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('a valid normal Task yields exactly one DIAGNOSED advisory',async()=>{
    const f=await makeCoordinatorFixture();
    expect(f.coordinator.getState()).toBe('ARMED');
    const key=await begun(f);
    expect(key).toBe(f.daily.expectedSha256);
    expect(f.coordinator.getState()).toBe('ACTIVE');
    expect(f.coordinator.isActive(f.SID)).toBe(true);
    expect(f.coordinator.isActive('ses_other001')).toBe(false);
    f.observePair();
    const r=await f.coordinator.finish(key,f.finishCall);
    f.emit('msg_003','tool_finish','justice_task_finish','AFTER');
    expect(r.state).toBe('DIAGNOSED');
    expect(r.boundary).toBe('BOUNDED');
    expect(r.evidence).toMatchObject({state:'VALID',projectionStatus:'PROJECTED',ruleLimited:false,matchedLocalCompletedHookCount:2});
    expect(r.scope).toMatchObject({state:'EVALUATED',comparison:'WITHIN_CANDIDATE_SCOPE'});
    expect(r.changeSetOrigin).toBe('GIT_READ_ONLY');
    expect(r.formalVerdict).toBe('UNKNOWN');
    expect(r.ownerAuthorityStatus).toBe('NOT_PROVEN');
    expect(f.diagnose).toHaveBeenCalledTimes(1);
    expect(f.coordinator.getState()).toBe('TERMINAL');
    expect(f.coordinator.isActive(f.SID)).toBe(false);
    // No raw payload / path / Session ID / command text in the published result.
    const text=JSON.stringify(r);
    for(const leak of [f.root,f.SID,'bun run vitest','tool_001','msg_002'])expect(text).not.toContain(leak);
  });

  it('RG-001: a TERMINAL lookup revalidates the binding with T1 and never republishes a stale advisory',async()=>{
    const f=await makeCoordinatorFixture({gated:true});
    const key=await begun(f);
    f.observePair();
    const first=f.coordinator.finish(key,f.finishCall);
    f.gate.resolve();
    const valid=await first;
    f.emit('msg_003','tool_finish','justice_task_finish','AFTER');
    expect(valid.state).toBe('DIAGNOSED');
    expect(f.coordinator.getState()).toBe('TERMINAL');
    const counts=()=>({native:f.nativeReads,git:f.gitReads,diagnose:f.diagnose.mock.calls.length});
    const settled=counts();

    const cached=await f.coordinator.finish(key,f.call('msg_005','tool_finish3'));
    expect(cached).toBe(valid);
    expect(counts()).toEqual(settled);

    f.setArtifactBytes('plan-1.md',new TextEncoder().encode('changed'));
    const stale=await f.coordinator.finish(key,f.call('msg_006','tool_finish4'));
    expect(stale.state).toBe('UNAVAILABLE');
    expect(stale.reasons).toContain('BINDING_INVALID');
    expect(stale.evidence.state).toBe('NOT_EVALUATED');
    expect(stale.scope.state).toBe('NOT_EVALUATED');
    expect(stale.formalVerdict).toBe('UNKNOWN');
    expect(counts()).toEqual(settled);
    expect(f.coordinator.getState()).toBe('TERMINAL');

    // Invalidation is sticky: even restored bytes cannot promote the old result again.
    f.setArtifactBytes('plan-1.md',new TextEncoder().encode(defaultPlanText()));
    const again=await f.coordinator.finish(key,f.finishCall);
    expect(again.state).toBe('UNAVAILABLE');
    expect(again.reasons).toEqual(['BINDING_INVALID']);
    expect(again).not.toBe(valid);
    expect(counts()).toEqual(settled);
  });

  it('a duplicate begin can never create a second binding',async()=>{
    const f=await makeCoordinatorFixture();
    const p1=f.coordinator.begin(f.beginCall);
    const p2=f.coordinator.begin(f.call('msg_001','tool_begin'));
    expect(f.coordinator.getState()).toBe('STARTING');
    expect(await p2).toEqual({state:'UNAVAILABLE',reason:'BUSY'});
    expect((await p1).state).toBe('READY');
    expect(await f.coordinator.begin(f.call('msg_009','tool_begin2'))).toEqual({state:'UNAVAILABLE',reason:'BUSY'});
    const key=(await p1.then(r=>r.state==='READY'?r.bindingKey:''));
    f.observePair();
    await f.coordinator.finish(key,f.finishCall);
    expect(await f.coordinator.begin(f.call('msg_010','tool_begin3'))).toEqual({state:'UNAVAILABLE',reason:'ALREADY_TERMINAL'});
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('rejects foreign Session, invalid identity, wrong key and finish before begin without state change',async()=>{
    const f=await makeCoordinatorFixture();
    expect(await f.coordinator.begin(f.call('msg_001','tool_begin','ses_other001'))).toEqual({state:'UNAVAILABLE',reason:'SESSION_MISMATCH'});
    expect(await f.coordinator.begin({...f.beginCall,callId:'bad id\n'})).toEqual({state:'UNAVAILABLE',reason:'IDENTITY_UNMATCHED'});
    expect(f.coordinator.getState()).toBe('ARMED');
    const early=await f.coordinator.finish(f.daily.expectedSha256,f.finishCall);
    expect(early.state).toBe('UNAVAILABLE');
    expect(early.reasons).toEqual(['NOT_OBSERVED']);
    expect(f.coordinator.getState()).toBe('ARMED');
    const key=await begun(f);
    f.observePair();
    const wrong=await f.coordinator.finish('0'.repeat(64),f.finishCall);
    expect(wrong.reasons).toEqual(['BINDING_KEY_MISMATCH']);
    const malformed=await f.coordinator.finish('not-a-key',f.finishCall);
    expect(malformed.reasons).toEqual(['BINDING_KEY_MISMATCH']);
    const foreign=await f.coordinator.finish(key,f.call('msg_003','tool_finish','ses_other001'));
    expect(foreign.reasons).toEqual(['SESSION_MISMATCH']);
    expect(f.coordinator.getState()).toBe('ACTIVE');
    expect(f.nativeReads).toBe(4);
    expect((await f.coordinator.finish(key,f.finishCall)).state).toBe('DIAGNOSED');
  });

  it('the unused agent name only needs to be a bounded string; malformed agents stay IDENTITY_UNMATCHED',async()=>{
    const f=await makeCoordinatorFixture();
    for(const agent of ['','x'.repeat(257),'a\nb',42 as unknown as string]){
      expect(await f.coordinator.begin({...f.beginCall,agent})).toEqual({state:'UNAVAILABLE',reason:'IDENTITY_UNMATCHED'});
    }
    expect(f.coordinator.getState()).toBe('ARMED');
    const start=await f.coordinator.begin({...f.beginCall,agent:'Plan (custom) agent'});
    expect(start.state).toBe('READY');
    if(start.state!=='READY')throw Error('fixture begin failed');
    f.observePair();
    expect((await f.coordinator.finish(start.bindingKey,{...f.finishCall,agent:'Plan (custom) agent'})).state).toBe('DIAGNOSED');
  });

  it('setup readiness failure is SKILL_UNSUPPORTED and lost readiness never yields DIAGNOSED',async()=>{
    const f=await makeCoordinatorFixture();
    f.setSkillReady(false);
    expect(await f.coordinator.begin(f.beginCall)).toEqual({state:'UNAVAILABLE',reason:'SKILL_UNSUPPORTED'});
    expect(f.coordinator.getState()).toBe('ARMED');
    expect(f.nativeReads).toBe(0);
    f.setSkillReady(true);
    const key=await begun(f);
    f.observePair();
    f.setSkillReady(false);
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.reasons).toContain('SKILL_UNSUPPORTED');
    expect(r.evidence.state).toBe('UNAVAILABLE');
  });

  it('downgrades the report when Skill readiness is lost during diagnosis',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.diagnose.mockImplementationOnce(async(...args)=>{
      const report=await runDailyAdvisory(...args);
      f.setSkillReady(false);
      return report;
    });
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.boundary).toBe('UNCERTAIN');
    expect(r.reasons).toContain('SKILL_UNSUPPORTED');
  });

  it('does not activate a Task if Skill readiness is lost during begin collection',async()=>{
    const f=await makeCoordinatorFixture();
    const hold=f.holdNextNative();
    const starting=f.coordinator.begin(f.beginCall);
    await flush();
    f.setSkillReady(false);
    hold.resolve();
    expect(await starting).toEqual({state:'UNAVAILABLE',reason:'SKILL_UNSUPPORTED'});
    expect(f.coordinator.getState()).toBe('TERMINAL');
  });

  it('excludes pre-begin tools from AC evidence',async()=>{
    const f=await makeCoordinatorFixture();
    // r1 runs and completes before begin: tracked for quietness only, never an AC candidate.
    f.emit('msg_000','tool_pre0','shell','BEFORE','r1');f.emit('msg_000','tool_pre0','shell','AFTER','r1');
    f.timeline.prefixShells=['r1'];
    const key=await begun(f);
    f.emitBeginAfter();
    f.shellPair('r2','tool_001');f.timeline.shells=['r2'];
    f.emitFinishBefore();
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.evidence).toMatchObject({state:'VALID',ruleLimited:true,matchedLocalCompletedHookCount:1,reasons:['RULE_UNMATCHED']});
  });

  it('a late tool after TERMINAL downgrades the cached advisory without a second collection or diagnosis',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('DIAGNOSED');
    const settled={native:f.nativeReads,git:f.gitReads,diagnose:f.diagnose.mock.calls.length};
    f.emit('msg_004','tool_post','shell','BEFORE');
    const later=await f.coordinator.finish(key,f.finishCall);
    expect(later.state).toBe('LIMITED');
    expect(later.boundary).toBe('UNCERTAIN');
    expect(later.reasons).toContain('LATE_OBSERVATION');
    expect(later.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['LATE_OBSERVATION']});
    expect(later.scope.state).toBe('EVALUATED');
    expect({native:f.nativeReads,git:f.gitReads,diagnose:f.diagnose.mock.calls.length}).toEqual(settled);
    expect(r.state).toBe('DIAGNOSED');
  });

  it('identical duplicate hooks are idempotent and foreign-Session hooks are ignored',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.shellPair('r1','tool_001');
    f.emit('msg_002','tool_x','shell','BEFORE','r1',{sessionId:'ses_other001'});
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('DIAGNOSED');
  });

  it('ignores malformed observations from a foreign Session before validating IDs',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.emit('msg_002','foreign call id','shell','BEFORE',null,{sessionId:'ses_other001'});
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('DIAGNOSED');
  });

  it('contradictory hooks for one identity taint the boundary',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.emit('msg_002','tool_001','bash','BEFORE');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['BOUNDARY_UNCERTAIN']});
  });

  it('an incomplete finish Source is never promoted to bounded evidence',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setMessageMode('incomplete');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.boundary).toBe('UNCERTAIN');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['BOUNDARY_UNCERTAIN']});
  });

  it('a native source acquisition failure preserves independently collected Git scope',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setMessageMode('unavailable');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['SOURCE_UNAVAILABLE']});
    expect(r.scope).toMatchObject({state:'EVALUATED',origin:'S1D_SCOPE_FALLBACK'});
    expect(r.changeSetOrigin).toBe('GIT_READ_ONLY');
    expect(f.gitReads).toBeGreaterThan(0);
  });

  it('caps storage at 4,096 observations and marks OBSERVATION_LIMIT',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    // 1 (begin before) + 1 (begin after) + 4 (shells) + 1 (finish before) already stored.
    for(let i=0;stored(i)<4_097;i++)f.emit('msg_002',`tool_r${i}`,'read','BEFORE');
    function stored(i:number):number{return 7+i;}
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).not.toBe('DIAGNOSED');
    expect(r.reasons).toContain('OBSERVATION_LIMIT');
    expect(r.evidence.state).toBe('UNAVAILABLE');
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'TOOL_IN_FLIGHT'});
  });

  it('a pending shell list makes Git UNAVAILABLE instead of claiming a stable end state',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setShells(JSON.stringify({location:{directory:f.root},data:[{id:'shl_1'}]}));
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'TOOL_IN_FLIGHT'});
    expect(r.changeSetOrigin).toBe('UNAVAILABLE');
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.boundary).toBe('UNCERTAIN');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['TOOL_IN_FLIGHT']});
    expect(f.gitReads).toBe(0);
  });

  it('a shell appearing after snapshot A also invalidates the Native boundary',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const hold=f.holdNextNative();
    const finishing=f.coordinator.finish(key,f.finishCall);
    await flush();
    f.setShells(JSON.stringify({location:{directory:f.root},data:[{id:'shl_1'}]}));
    hold.resolve();
    const r=await finishing;
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.boundary).toBe('UNCERTAIN');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['TOOL_IN_FLIGHT']});
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'TOOL_IN_FLIGHT'});
  });

  it('a workspace mismatch in end snapshot A skips and invalidates Git scope',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setSessionLocations('/tmp/other-worktree');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['WORKSPACE_MISMATCH']});
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'WORKSPACE_MISMATCH'});
    expect(f.gitReads).toBe(0);
  });

  it('a workspace mismatch in end snapshot B invalidates the collected Git scope',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setSessionLocations(f.root,f.root,'/tmp/other-worktree');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['WORKSPACE_MISMATCH']});
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'WORKSPACE_MISMATCH'});
    expect(f.gitReads).toBeGreaterThan(0);
  });

  it('a session mismatch in end snapshot A skips and invalidates Git scope',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setSessionIds('ses_other001');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['SESSION_MISMATCH']});
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'SESSION_MISMATCH'});
    expect(f.gitReads).toBe(0);
  });

  it('a session mismatch in end snapshot B invalidates the collected Git scope',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setSessionIds(f.SID,f.SID,'ses_other001');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['SESSION_MISMATCH']});
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'SESSION_MISMATCH'});
    expect(f.gitReads).toBeGreaterThan(0);
  });

  it('an unfinished tool at finish blocks both Git and Native evidence',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.emit('msg_002','tool_open','shell','BEFORE');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['TOOL_IN_FLIGHT']});
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'TOOL_IN_FLIGHT'});
    expect(f.gitReads).toBe(0);
  });

  it('concurrent non-control work while STARTING terminates the Task as UNAVAILABLE',async()=>{
    const f=await makeCoordinatorFixture();
    const hold=f.holdNextNative();
    const p=f.coordinator.begin(f.beginCall);
    await flush();
    f.emit('msg_001','tool_par','read','BEFORE');
    hold.resolve();
    expect(await p).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
    expect(f.coordinator.getState()).toBe('TERMINAL');
    const r=await f.coordinator.finish(f.daily.expectedSha256,f.finishCall);
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.reasons).toEqual(['BOUNDARY_UNCERTAIN']);
    expect(f.diagnose).not.toHaveBeenCalled();
  });

  it('concurrent non-control work while FINISHING invalidates Native evidence and the overlapping Git proof',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const hold=f.holdNextNative();
    const p=f.coordinator.finish(key,f.finishCall);
    await flush();
    f.emit('msg_004','tool_par','read','BEFORE');
    hold.resolve();
    const r=await p;
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.evidence.state).toBe('UNAVAILABLE');
    expect(r.reasons).toContain('LATE_OBSERVATION');
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'LATE_OBSERVATION'});
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('a late hook during diagnosis withdraws Native evidence but keeps the established Git scope',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.diagnose.mockImplementationOnce(async(...args)=>{
      f.emit('msg_004','tool_late','read','BEFORE');
      return runDailyAdvisory(...args);
    });
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.boundary).toBe('UNCERTAIN');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['LATE_OBSERVATION']});
    expect(r.scope.state).toBe('EVALUATED');
    expect(r.reasons).toContain('LATE_OBSERVATION');
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('a late hook during diagnosis with Git already unavailable leaves nothing and is UNAVAILABLE',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setShells(JSON.stringify({location:{directory:f.root},data:[{id:'shl_1'}]}));
    f.diagnose.mockImplementationOnce(async(...args)=>{
      f.emit('msg_004','tool_late','read','BEFORE');
      return runDailyAdvisory(...args);
    });
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.boundary).toBe('UNCERTAIN');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['TOOL_IN_FLIGHT']});
    expect(r.scope).toEqual({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'TOOL_IN_FLIGHT'});
    expect(r.reasons).toContain('LATE_OBSERVATION');
    expect(f.gitReads).toBe(0);
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('a duplicate finish joining after evaluation downgrades the shared result without a second diagnosis',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    let joined:Promise<DailyAdvisoryReport>|null=null;
    f.diagnose.mockImplementationOnce(async(...args)=>{
      joined=f.coordinator.finish(key,f.call('msg_004','tool_finish2'));
      return runDailyAdvisory(...args);
    });
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(joined).not.toBeNull();
    expect(await joined!).toBe(r);
    expect(r.state).toBe('LIMITED');
    expect(r.boundary).toBe('UNCERTAIN');
    expect(r.reasons).toContain('BOUNDARY_UNCERTAIN');
    expect(r.evidence.state).toBe('VALID');
    expect(r.scope.state).toBe('EVALUATED');
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('a finish message carrying another tool is BOUNDARY_UNCERTAIN, Git scope kept independently',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.timeline.extraFinishTools=[{type:'tool',id:'tool_side',name:'read',state:{status:'completed',input:{},content:[{type:'text',text:'x'}]},time:{created:2_000},executed:false}];
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['BOUNDARY_UNCERTAIN']});
    expect(r.scope.state).toBe('EVALUATED');
  });

  it('a rejected Source keeps the independent Git scope through the real T4 route',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.setMessageMode('rejected');
    const r=await f.coordinator.finish(key,f.finishCall);
    expect(r.state).toBe('LIMITED');
    expect(r.evidence.state).toBe('REJECTED');
    expect(r.evidence.reasons).toEqual(['SOURCE_REJECTED']);
    expect(r.scope).toMatchObject({state:'EVALUATED',origin:'S1D_SCOPE_FALLBACK',comparison:'WITHIN_CANDIDATE_SCOPE'});
    expect(r.changeSetOrigin).toBe('GIT_READ_ONLY');
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('abort while waiting publishes ABORTED, suppresses the late result and never diagnoses',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const hold=f.holdNextNative();
    const ctl=new AbortController();
    const p=f.coordinator.finish(key,f.call('msg_003','tool_finish',f.SID,ctl.signal));
    await flush();
    ctl.abort();
    const r=await p;
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.reasons).toEqual(['ABORTED']);
    hold.resolve();
    await flush();
    expect(f.diagnose).not.toHaveBeenCalled();
    expect(f.coordinator.getState()).toBe('TERMINAL');
    const again=await f.coordinator.finish(key,f.finishCall);
    expect(again.reasons).toEqual(['ABORTED']);
    expect(f.diagnose).not.toHaveBeenCalled();
  });

  it('an aborted duplicate finish waiter aborts the shared operation; unrelated callers cannot',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const hold=f.holdNextNative();
    const p=f.coordinator.finish(key,f.finishCall);
    const foreignCtl=new AbortController();
    const foreign=await f.coordinator.finish(key,f.call('msg_003','tool_finish','ses_other001',foreignCtl.signal));
    foreignCtl.abort();
    expect(foreign.reasons).toEqual(['SESSION_MISMATCH']);
    const dupCtl=new AbortController();
    const dup=f.coordinator.finish(key,f.call('msg_003','tool_finish',f.SID,dupCtl.signal));
    expect(dup).toBe(p);
    dupCtl.abort();
    const r=await p;
    hold.resolve();
    expect(r.reasons).toEqual(['ABORTED']);
    expect(f.diagnose).not.toHaveBeenCalled();
  });

  it('dispose while collecting refuses all calls and never publishes',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const hold=f.holdNextNative();
    const p=f.coordinator.finish(key,f.finishCall);
    await flush();
    f.coordinator.dispose();
    expect(f.coordinator.getState()).toBe('DISPOSED');
    const r=await p;
    expect(r.reasons).toEqual(['DISPOSED']);
    hold.resolve();
    await flush();
    expect(f.diagnose).not.toHaveBeenCalled();
    expect(f.coordinator.getState()).toBe('DISPOSED');
    expect(await f.coordinator.begin(f.beginCall)).toEqual({state:'UNAVAILABLE',reason:'DISPOSED'});
    expect((await f.coordinator.finish(key,f.finishCall)).reasons).toEqual(['DISPOSED']);
  });
});

// ---------------------------------------------------------------------------
// SDK registration / Skill transform (fake SDK in the style of opencode-v2-plugin-hooks.test.ts)
// ---------------------------------------------------------------------------

type AddedTool={name:string;description:string;input:unknown;options?:unknown;execute:(input:unknown,ctx:unknown)=>Promise<{content?:unknown;metadata?:unknown}>};
type SkillRec={id:string;name:string;path:string;content:string;description?:string};
type Slot='execute.before'|'execute.after'|'daily-tool'|'skill';
type SdkOptions={failAt?:Slot;disposeFail?:Slot|'review';skills?:SkillRec[];direct?:boolean};

function makeSdk(o:SdkOptions={}){
  const log:string[]=[];
  const added:AddedTool[]=[];
  const hooks=new Map<string,(input:unknown)=>unknown>();
  const skills:SkillRec[]=(o.skills??[{id:'skill-fixture',name:'executing-plans',path:'/tmp/justice-daily-fixture-skill/SKILL.md',content:'fixture-skill'}]).map(s=>({...s}));
  // Upstream v2.3.2 State: transforms replay in registration order; package plugins (Justice) register BEFORE the
  // internal post-group ConfigSkillPlugin, which adds the config Skills (`skills`).
  const packageSkillTransforms:((editor:unknown)=>void)[]=[];
  const finalSkills=():SkillRec[]=>{
    const state=new Map<string,SkillRec>();
    const editor={
      list:()=>[...state.values()],get:(id:string)=>state.get(id),
      add:(sk:SkillRec)=>{state.set(sk.id,{...sk});},remove:(id:string)=>{state.delete(id);},
      update:(id:string,fn:(x:SkillRec)=>void)=>{const c=state.get(id);if(c)fn(c);},
    };
    for(const cb of packageSkillTransforms)cb(editor);
    for(const sk of skills)editor.add(sk);
    return [...state.values()];
  };
  const reg=(name:string)=>({dispose:vi.fn(async()=>{log.push(`dispose:${name}`);if(o.disposeFail===name)throw Error(`dispose ${name}`);})});
  let transforms=o.direct===true?1:0; // direct registerDailyAssurance calls have no review transform
  const toolEditor={add:(t:AddedTool)=>{added.push(t);}};
  const toolTransform=vi.fn(async(cb:(e:unknown)=>void)=>{
    const name=transforms++===0?'review':'daily-tool';
    if(o.failAt===name)throw Error(`register ${name}`);
    cb(toolEditor);log.push(`register:${name}`);return reg(name);
  });
  const afterHooks:((input:unknown)=>unknown)[]=[];
  const toolHook=vi.fn(async(name:string,cb:(input:unknown)=>unknown)=>{
    // The second execute.after registration is the Skill delivery hook (slot 'skill').
    const slot=name==='execute.after'&&afterHooks.length>0?'skill':name;
    if(o.failAt===slot)throw Error(`register ${slot}`);
    if(name==='execute.after')afterHooks.push(cb);
    if(!hooks.has(name))hooks.set(name,cb);
    log.push(`register:${slot}`);return reg(slot);
  });
  // Justice must never use skill.transform (it would run before ConfigSkillPlugin); a call is recorded and applied in order.
  const skillTransform=vi.fn(async(cb:(e:unknown)=>void)=>{packageSkillTransforms.push(cb);return reg('skill-transform');});
  const skillList=vi.fn(async()=>({location:{},data:finalSkills()}));
  /** Runs the built-in `skill` tool result through every execute.after hook in order, like upstream tool.ts. */
  const invokeSkillTool=async(f:CoordinatorFixture,id:string,messageID='msg_skill',callID='tool_skill',sessionID:unknown=f.SID,omitSession=false):Promise<Rec>=>{
    const sk=finalSkills().find(x=>x.id===id);
    const content=sk===undefined?'':['<skill_content name="'+sk.name+'">','# Skill: '+sk.name,'',sk.content.trim(),'','Base directory for this skill: /tmp','</skill_content>'].join('\n');
    const event:Rec={tool:'skill',sessionID,agent:'build',messageID,id:callID,input:{id},status:'completed',
      result:{output:{directory:'/tmp',content},content:[{type:'text',text:content}],metadata:{}}};
    if(omitSession)delete event.sessionID;
    for(const cb of afterHooks)await cb(event);
    return event;
  };
  const traps={credential:vi.fn(),generate:vi.fn(),sessionHook:vi.fn(),commandTransform:vi.fn(),eventSubscribe:vi.fn(),skillReload:vi.fn(),toolReload:vi.fn()};
  const context={
    location:{directory:'/nonexistent/justice-v2-daily'},
    options:{approvalSha256:'f'.repeat(64),ownerRoot:'/tmp/attacker'},
    tool:{transform:toolTransform,hook:toolHook,reload:traps.toolReload},
    skill:{transform:skillTransform,list:skillList,reload:traps.skillReload},
    session:{hook:traps.sessionHook},command:{transform:traps.commandTransform},event:{subscribe:traps.eventSubscribe},
    credential:{activate:traps.credential},experimental:{generate:{text:traps.generate}},generate:{text:traps.generate},
  };
  return {context,log,added,hooks,skills,finalSkills,skillList,invokeSkillTool,toolTransform,toolHook,skillTransform,traps};
}
type Sdk=ReturnType<typeof makeSdk>;

function fakeAdapter():JusticeV2AdapterPort{
  return {ensureInitialized:vi.fn(async()=>undefined),getJustice:()=>null,log:vi.fn(async()=>undefined)} as unknown as JusticeV2AdapterPort;
}
function runtimeOf(f:CoordinatorFixture):Extract<DailyRuntimeResult,{state:'READY'}>&{ready:()=>boolean}{
  let ready=false;
  const ports:DailyCoordinatorPorts={...f.ports,isSkillReady:()=>ready};
  return {state:'READY',ports,markSkillReady:(r:boolean)=>{ready=r;},ready:()=>ready};
}
const toolCtx=(f:CoordinatorFixture,messageID:string,id:string,o:Rec={})=>({sessionID:f.SID,messageID,id,agent:'build',signal:new AbortController().signal,
  progress:async()=>undefined,...o});
/** Delivered text of a normalized Tool.Content[] result (single text element). */
const textOf=(ev:Rec):string=>{const c=(ev.result as {content:{type:string;text:string}[]}).content;return c.map(x=>x.text).join('');};
const parse=(r:{content?:unknown}):Rec=>JSON.parse(String(r.content)) as Rec;
const daily=(sdk:Sdk,name:string):AddedTool=>{const t=sdk.added.find(x=>x.name===name);if(!t)throw Error(`${name} not registered`);return t;};
async function hook(sdk:Sdk,name:'execute.before'|'execute.after',input:Rec):Promise<void>{
  const cb=sdk.hooks.get(name);if(!cb)throw Error(`${name} not registered`);await cb(input);
}
const sdkEvent=(f:CoordinatorFixture,messageID:string,id:string,tool:string,input:unknown,status?:string):Rec=>({
  tool,sessionID:f.SID,agent:'build',messageID,id,input,...(status===undefined?{}:{status,result:{content:'secret-output'}})});

describe('V2 wiring: opt-in Daily registration',()=>{
  it('OFF registers only the existing justice_review tool',async()=>{
    const sdk=makeSdk();
    const plugin=createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>({state:'OFF',reason:'NOT_OPTED_IN'})});
    const cleanup=await plugin.setup(sdk.context as never);
    expect(sdk.added.map(t=>t.name)).toEqual(['justice_review']);
    expect(sdk.toolHook).not.toHaveBeenCalled();
    expect(sdk.skillTransform).not.toHaveBeenCalled();
    expect(sdk.log).toEqual(['register:review']);
    if(typeof cleanup!=='function')throw Error('cleanup missing');
    await cleanup();
    expect(sdk.log).toEqual(['register:review','dispose:review']);
  });

  it('the default production path registers no Daily surface without the opt-in env',async()=>{
    vi.stubEnv(DAILY_APPROVAL_ENV,undefined);
    expect(process.env[DAILY_APPROVAL_ENV]).toBeUndefined();
    const sdk=makeSdk();
    await createJusticeV2Plugin({createAdapter:fakeAdapter}).setup(sdk.context as never);
    expect(sdk.added.map(t=>t.name)).toEqual(['justice_review']);
    expect(sdk.toolHook).not.toHaveBeenCalled();
    expect(sdk.skillTransform).not.toHaveBeenCalled();
    expect(vfs.accessed).toEqual([]);
  });

  it('registers hooks, direct tools and the Skill transform in the fixed order with direct options',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk();
    await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtimeOf(f)}).setup(sdk.context as never);
    expect(sdk.log).toEqual(['register:review','register:execute.before','register:execute.after','register:daily-tool','register:skill']);
    expect(sdk.added.map(t=>t.name)).toEqual(['justice_review','justice_task_begin','justice_task_finish']);
    const begin=daily(sdk,'justice_task_begin'),finish=daily(sdk,'justice_task_finish');
    expect(begin.options).toEqual({codemode:false});
    expect(finish.options).toEqual({codemode:false});
    expect(begin.input).toEqual({type:'object',properties:{},additionalProperties:false});
    expect(finish.input).toEqual({type:'object',properties:{bindingKey:{type:'string',pattern:'^[0-9a-f]{64}$'}},required:['bindingKey'],additionalProperties:false});
    for(const trap of Object.values(sdk.traps))expect(trap).not.toHaveBeenCalled();
  });

  it('runs one normal Task through SDK hooks and direct tools using the actual ToolContext',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk();
    const runtime=runtimeOf(f);
    const cleanup=await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtime}).setup(sdk.context as never);
    expect(runtime.ready()).toBe(false); // readiness only after the approved Skill is actually delivered
    const begin=daily(sdk,'justice_task_begin'),finish=daily(sdk,'justice_task_finish');
    await sdk.invokeSkillTool(f,'skill-fixture');
    expect(runtime.ready()).toBe(true);
    // Model-supplied parameters and foreign contexts are rejected without starting a Task.
    expect(parse(await begin.execute({sessionId:f.SID},toolCtx(f,'msg_001','tool_begin')))).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
    expect(parse(await begin.execute({},toolCtx(f,'msg_001','tool_begin',{sessionID:'ses_other001'})))).toEqual({state:'UNAVAILABLE',reason:'SESSION_MISMATCH'});
    expect(parse(await begin.execute({},{...toolCtx(f,'msg_001','tool_begin'),signal:'nope'}))).toEqual({state:'UNAVAILABLE',reason:'IDENTITY_UNMATCHED'});
    // The plugin owns its own coordinator; the begin control's `execute.before` arrives through the SDK hook.
    await hook(sdk,'execute.before',sdkEvent(f,'msg_001','tool_begin','justice_task_begin',{}));
    const started=parse(await begin.execute({},toolCtx(f,'msg_001','tool_begin')));
    expect(started).toEqual({state:'READY',bindingKey:f.daily.expectedSha256});
    await hook(sdk,'execute.after',sdkEvent(f,'msg_001','tool_begin','justice_task_begin',{},'completed'));
    f.timeline.beginSettled=true;
    for(const [rule,id] of [['r1','tool_001'],['r2','tool_002']] as const){
      const input={...f.daily.approval.rules.find(r=>r.ruleId===rule)!.input};
      await hook(sdk,'execute.before',sdkEvent(f,'msg_002',id,'shell',input));
      await hook(sdk,'execute.after',sdkEvent(f,'msg_002',id,'shell',input,'completed'));
    }
    f.timeline.shells=['r1','r2'];
    await hook(sdk,'execute.before',sdkEvent(f,'msg_003','tool_finish','justice_task_finish',{bindingKey:started.bindingKey}));
    f.timeline.finish=true;
    expect(parse(await finish.execute({bindingKey:started.bindingKey,extra:1},toolCtx(f,'msg_003','tool_finish'))).reasons).toEqual(['BINDING_KEY_MISMATCH']);
    expect(parse(await finish.execute({bindingKey:'0'.repeat(64)},toolCtx(f,'msg_003','tool_finish'))).reasons).toEqual(['BINDING_KEY_MISMATCH']);
    const result=await finish.execute({bindingKey:started.bindingKey},toolCtx(f,'msg_003','tool_finish'));
    expect(Object.keys(result)).toEqual(['content']);
    const report=parse(result) as unknown as DailyAdvisoryReport;
    expect(report.state).toBe('DIAGNOSED');
    expect(f.diagnose).toHaveBeenCalledTimes(1);
    const text=String(result.content);
    for(const leak of [f.root,f.SID,'bun run vitest','secret-output'])expect(text).not.toContain(leak);
    expect(vfs.writes).toEqual([]);
    for(const trap of Object.values(sdk.traps))expect(trap).not.toHaveBeenCalled();
    if(typeof cleanup!=='function')throw Error('cleanup missing');
    await cleanup();
    expect(sdk.log.slice(-5)).toEqual(['dispose:skill','dispose:daily-tool','dispose:execute.after','dispose:execute.before','dispose:review']);
    expect(parse(await begin.execute({},toolCtx(f,'msg_009','tool_begin9')))).toEqual({state:'UNAVAILABLE',reason:'DISPOSED'});
    expect(runtime.ready()).toBe(false);
  });

  it('hook callbacks never throw to cancel Host execution and derive ruleId only while ACTIVE or FINISHING',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk();
    await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtimeOf(f)}).setup(sdk.context as never);
    const hostile={get tool():string{throw Error('boom');}};
    await expect(hook(sdk,'execute.before',hostile as unknown as Rec)).resolves.toBeUndefined();
    await expect(hook(sdk,'execute.after',null as unknown as Rec)).resolves.toBeUndefined();
    const payload=sdkEvent(f,'msg_000','tool_x','shell',{...f.daily.approval.rules[0]!.input});
    const frozen=JSON.stringify(payload);
    await hook(sdk,'execute.before',payload);
    expect(JSON.stringify(payload)).toBe(frozen);
  });

  it('deduplicates an identical shell hook replayed while FINISHING',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk();
    await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtimeOf(f)}).setup(sdk.context as never);
    const begin=daily(sdk,'justice_task_begin'),finish=daily(sdk,'justice_task_finish');
    await sdk.invokeSkillTool(f,'skill-fixture');
    await hook(sdk,'execute.before',sdkEvent(f,'msg_001','tool_begin','justice_task_begin',{}));
    const started=parse(await begin.execute({},toolCtx(f,'msg_001','tool_begin')));
    expect(started.state).toBe('READY');
    await hook(sdk,'execute.after',sdkEvent(f,'msg_001','tool_begin','justice_task_begin',{},'completed'));
    f.timeline.beginSettled=true;
    for(const [rule,id] of [['r1','tool_001'],['r2','tool_002']] as const){
      const input={...f.daily.approval.rules.find(r=>r.ruleId===rule)!.input};
      await hook(sdk,'execute.before',sdkEvent(f,'msg_002',id,'shell',input));
      await hook(sdk,'execute.after',sdkEvent(f,'msg_002',id,'shell',input,'completed'));
    }
    f.timeline.shells=['r1','r2'];
    await hook(sdk,'execute.before',sdkEvent(f,'msg_003','tool_finish','justice_task_finish',{bindingKey:started.bindingKey}));
    f.timeline.finish=true;

    const hold=f.holdNextNative();
    const finishing=finish.execute({bindingKey:started.bindingKey},toolCtx(f,'msg_003','tool_finish'));
    await flush();
    const replayInput={...f.daily.approval.rules[0]!.input};
    await hook(sdk,'execute.after',sdkEvent(f,'msg_002','tool_001','shell',replayInput,'completed'));
    hold.resolve();

    const report=parse(await finishing) as unknown as DailyAdvisoryReport;
    expect(report.state).toBe('DIAGNOSED');
  });

  it('hostile hook payloads while ACTIVE fail closed: the Task is never DIAGNOSED',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk();
    await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtimeOf(f)}).setup(sdk.context as never);
    const begin=daily(sdk,'justice_task_begin'),finish=daily(sdk,'justice_task_finish');
    await sdk.invokeSkillTool(f,'skill-fixture');
    await hook(sdk,'execute.before',sdkEvent(f,'msg_001','tool_begin','justice_task_begin',{}));
    const started=parse(await begin.execute({},toolCtx(f,'msg_001','tool_begin')));
    expect(started.state).toBe('READY');
    await hook(sdk,'execute.after',sdkEvent(f,'msg_001','tool_begin','justice_task_begin',{},'completed'));
    f.timeline.beginSettled=true;
    for(const [rule,id] of [['r1','tool_001'],['r2','tool_002']] as const){
      const input={...f.daily.approval.rules.find(r=>r.ruleId===rule)!.input};
      await hook(sdk,'execute.before',sdkEvent(f,'msg_002',id,'shell',input));
      await hook(sdk,'execute.after',sdkEvent(f,'msg_002',id,'shell',input,'completed'));
    }
    f.timeline.shells=['r1','r2'];
    const hostile={get tool():string{throw Error('boom');}};
    await expect(hook(sdk,'execute.before',hostile as unknown as Rec)).resolves.toBeUndefined();
    await hook(sdk,'execute.before',sdkEvent(f,'msg_003','tool_finish','justice_task_finish',{bindingKey:started.bindingKey}));
    f.timeline.finish=true;
    const report=parse(await finish.execute({bindingKey:started.bindingKey},toolCtx(f,'msg_003','tool_finish'))) as unknown as DailyAdvisoryReport;
    expect(report.state).not.toBe('DIAGNOSED');
    expect(report.boundary).toBe('UNCERTAIN');
    expect(report.evidence.state).not.toBe('VALID');
    expect(report.formalVerdict).toBe('UNKNOWN');
  });
});

describe('V2 wiring: fixed Skill delivery (upstream transform order)',()=>{
  const APPROVED={id:'skill-fixture',name:'executing-plans',path:'/tmp/justice-daily-fixture-skill/SKILL.md',content:'fixture-skill'};
  const beginUnavailable=async(f:CoordinatorFixture,sdk:Sdk)=>{
    await hook(sdk,'execute.before',sdkEvent(f,'msg_001','tool_begin','justice_task_begin',{}));
    expect(parse(await daily(sdk,'justice_task_begin').execute({},toolCtx(f,'msg_001','tool_begin')))).toEqual({state:'UNAVAILABLE',reason:'SKILL_UNSUPPORTED'});
    expect(f.nativeReads).toBe(0);
  };

  it('never relies on skill.transform: the Host rebuild runs Justice before ConfigSkillPlugin and would drop the edit',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:[{...APPROVED}]});
    await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtimeOf(f));
    expect(sdk.skillTransform).not.toHaveBeenCalled();
    expect(sdk.finalSkills()[0]!.content).toBe('fixture-skill'); // Host Skill State is never edited
  });

  it('appends the fixed instruction exactly once to the delivered approved Skill and only then marks readiness',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:[{...APPROVED},{id:'other',name:'brainstorming',path:'/tmp/other/SKILL.md',content:'other-skill'}]});
    const runtime=runtimeOf(f);
    await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
    expect(runtime.ready()).toBe(false);
    const ev=await sdk.invokeSkillTool(f,'skill-fixture');
    const result={content:textOf(ev),output:(ev.result as {output:{content:string}}).output};
    expect(runtime.ready()).toBe(true);
    expect(result.content.split(DAILY_SKILL_APPEND)).toHaveLength(2);
    expect(result.content.startsWith('<skill_content name="executing-plans">\n# Skill: executing-plans\n\nfixture-skill\n')).toBe(true);
    expect(result.content.endsWith(`\n${DAILY_SKILL_APPEND}\n</skill_content>`)).toBe(true);
    expect(result.output.content).toBe(result.content);
    const other=await sdk.invokeSkillTool(f,'other');
    expect(textOf(other)).not.toContain(DAILY_SKILL_APPEND);
    expect(runtime.ready()).toBe(true); // unapproved Skill loads leave readiness untouched
    expect(sdk.finalSkills().map(x=>x.content)).toEqual(['fixture-skill','other-skill']);
    expect(DAILY_SKILL_APPEND.startsWith('## Justice Daily Assurance (Owner opt-in; advisory only)\nBefore the approved inline Task')).toBe(true);
    expect(DAILY_SKILL_APPEND.endsWith('Do not start an extra review, fix, retry, or approval cycle because of this tool.')).toBe(true);
    expect(DAILY_SKILL_APPEND.split('\n')).toHaveLength(12);
  });

  it('does not duplicate when the same result passes the hook twice',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:[{...APPROVED}]});
    const runtime=runtimeOf(f);
    await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
    const ev=await sdk.invokeSkillTool(f,'skill-fixture');
    const skillHook=sdk.toolHook.mock.calls[2]![1] as (i:unknown)=>Promise<void>;
    await skillHook(ev);
    expect(textOf(ev).split(DAILY_SKILL_APPEND)).toHaveLength(2);
    expect(runtime.ready()).toBe(true);
  });

  it.each([
    ['digest',[{...APPROVED,content:'edited-skill'}]],
    ['name',[{...APPROVED,name:'executing-plans-x'}]],
    ['path',[{...APPROVED,path:'/tmp/elsewhere/SKILL.md'}]],
  ] as const)('an unsupported %s leaves the delivered Skill untouched and begin unavailable',async(_n,skills)=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:skills.map(x=>({...x}))});
    const runtime=runtimeOf(f);
    expect((await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime)).state).toBe('REGISTERED');
    const ev=await sdk.invokeSkillTool(f,'skill-fixture');
    expect(textOf(ev)).not.toContain(DAILY_SKILL_APPEND);
    expect(runtime.ready()).toBe(false);
    await beginUnavailable(f,sdk);
  });

  it('a missing approved Skill, a not yet loaded Skill, a failed load and a throwing Host list all stay unavailable',async()=>{
    for(const mode of ['absent','not-loaded','error','list-throws','list-malformed'] as const){
      const f=await makeCoordinatorFixture();
      const sdk=makeSdk({skills:mode==='absent'?[]:[{...APPROVED}]});
      const runtime=runtimeOf(f);
      await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
      if(mode==='list-throws')sdk.skillList.mockRejectedValue(Error('Host Skill list failed'));
      if(mode==='list-malformed')sdk.skillList.mockResolvedValue({data:'nope'} as never);
      if(mode!=='not-loaded'){
        const ev=await sdk.invokeSkillTool(f,'skill-fixture');
        if(mode==='error'){
          const failed={...ev,status:'error',error:new Error('x')};
          delete (failed as Rec).result;
          for(const cb of sdk.toolHook.mock.calls.filter(c=>c[0]==='execute.after').map(c=>c[1] as (i:unknown)=>unknown))await cb(failed);
        }
        if(mode==='absent')expect(textOf(ev)).toBe('');
      }
      expect(runtime.ready()).toBe(false);
      await beginUnavailable(f,sdk);
    }
  });

  it('a delivered text that does not embed the verified Skill content is not trusted',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:[{...APPROVED}]});
    const runtime=runtimeOf(f);
    await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
    const skillHook=sdk.toolHook.mock.calls[2]![1] as (i:unknown)=>Promise<void>;
    // Well-formed normalized shape (output.content === text) so only the body-inclusion check can reject it.
    const forgedText='<skill_content name="executing-plans">\nsomething else\n</skill_content>';
    const forged:Rec={tool:'skill',sessionID:f.SID,input:{id:'skill-fixture'},status:'completed',
      result:{output:{directory:'/tmp',content:forgedText},content:[{type:'text',text:forgedText}]}};
    await skillHook(forged);
    expect(textOf(forged)).not.toContain(DAILY_SKILL_APPEND);
    expect(runtime.ready()).toBe(false);
  });

  describe('Session attribution',()=>{
    const OTHER='ses_other_session';
    it('an approved-Session delivery establishes readiness',async()=>{
      const f=await makeCoordinatorFixture();
      const sdk=makeSdk({skills:[{...APPROVED}]});
      const runtime=runtimeOf(f);
      await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
      await sdk.invokeSkillTool(f,'skill-fixture');
      expect(runtime.ready()).toBe(true);
    });

    it.each([['other Session',OTHER],['missing',Symbol.for('omit')],['non-string',42],['empty',''],['object',{}]] as const)(
      'a %s sessionID neither changes the delivered result, calls skill.list nor sets readiness',async(_n,sid)=>{
        const f=await makeCoordinatorFixture();
        const sdk=makeSdk({skills:[{...APPROVED}]});
        const runtime=runtimeOf(f);
        await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
        const ev=await sdk.invokeSkillTool(f,'skill-fixture','msg_x','tool_x',sid,sid===Symbol.for('omit'));
        expect(textOf(ev)).not.toContain(DAILY_SKILL_APPEND);
        expect(sdk.skillList).not.toHaveBeenCalled();
        expect(runtime.ready()).toBe(false);
      });

    it('another Session failing, mismatching or erroring never revokes the approved Session readiness',async()=>{
      const f=await makeCoordinatorFixture();
      const sdk=makeSdk({skills:[{...APPROVED}]});
      const runtime=runtimeOf(f);
      await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
      await sdk.invokeSkillTool(f,'skill-fixture');
      expect(runtime.ready()).toBe(true);
      sdk.skillList.mockClear();
      sdk.skills[0]!.content='edited-skill'; // identity mismatch seen by another Session
      await sdk.invokeSkillTool(f,'skill-fixture','msg_y','tool_y',OTHER);
      const failed:Rec={tool:'skill',sessionID:OTHER,input:{id:'skill-fixture'},status:'error',error:new Error('x')};
      for(const c of sdk.toolHook.mock.calls.filter(c=>c[0]==='execute.after'))await (c[1] as (i:unknown)=>unknown)(failed);
      expect(sdk.skillList).not.toHaveBeenCalled();
      expect(runtime.ready()).toBe(true);
    });
  });

  it('keeps directory, metadata, unrelated fields and the normalized array shape when appending',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:[{...APPROVED}]});
    const runtime=runtimeOf(f);
    await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
    const skillHook=sdk.toolHook.mock.calls[2]![1] as (i:unknown)=>Promise<void>;
    const text=['<skill_content name="executing-plans">','# Skill: executing-plans','','fixture-skill','','Base directory for this skill: /tmp','</skill_content>'].join('\n');
    const ev:Rec={tool:'skill',sessionID:f.SID,input:{id:'skill-fixture'},status:'completed',
      result:{output:{directory:'/tmp',content:text,extra:1},content:[{type:'text',text}],metadata:{name:'executing-plans'},unrelated:'keep'}};
    await skillHook(ev);
    const r=ev.result as {output:{directory:string;content:string;extra:number};content:{type:string;text:string}[];metadata:unknown;unrelated:string};
    expect(runtime.ready()).toBe(true);
    expect(r.content).toHaveLength(1);
    expect(r.content[0]!.type).toBe('text');
    expect(r.content[0]!.text).toBe(r.output.content);
    expect(r.content[0]!.text).toContain(DAILY_SKILL_APPEND);
    expect([r.output.directory,r.output.extra,r.metadata,r.unrelated]).toEqual(['/tmp',1,{name:'executing-plans'},'keep']);
  });

  describe('malformed or ambiguous normalized results are never trusted',()=>{
    const text=['<skill_content name="executing-plans">','# Skill: executing-plans','','fixture-skill','','Base directory for this skill: /tmp','</skill_content>'].join('\n');
    const mk=(result:unknown):Rec=>({tool:'skill',sessionID:'',input:{id:'skill-fixture'},status:'completed',result});
    it.each([
      ['raw string content',(t:string)=>({output:{directory:'/tmp',content:t},content:t})],
      ['content array of two text elements',(t:string)=>({output:{directory:'/tmp',content:t},content:[{type:'text',text:t},{type:'text',text:'x'}]})],
      ['empty content array',(t:string)=>({output:{directory:'/tmp',content:t},content:[]})],
      ['file element',(t:string)=>({output:{directory:'/tmp',content:t},content:[{type:'file',uri:'u',mime:'m'}]})],
      ['content/output mismatch',(t:string)=>({output:{directory:'/tmp',content:t+'!'},content:[{type:'text',text:t}]})],
      ['output missing',(t:string)=>({content:[{type:'text',text:t}]})],
      ['output wrong type',(t:string)=>({output:'str',content:[{type:'text',text:t}]})],
      ['output.content wrong type',(t:string)=>({output:{directory:'/tmp',content:1},content:[{type:'text',text:t}]})],
    ] as const)('%s',async(_n,build)=>{
      const f=await makeCoordinatorFixture();
      const sdk=makeSdk({skills:[{...APPROVED}]});
      const runtime=runtimeOf(f);
      await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
      const skillHook=sdk.toolHook.mock.calls[2]![1] as (i:unknown)=>Promise<void>;
      const ev=mk(build(text));ev.sessionID=f.SID;
      const before=JSON.stringify(ev.result);
      await skillHook(ev);
      expect(JSON.stringify(ev.result)).toBe(before);
      expect(runtime.ready()).toBe(false);
    });
  });

  it('a later load that no longer matches the approved identity revokes readiness (Skill changed / reload)',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:[{...APPROVED}]});
    const runtime=runtimeOf(f);
    await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
    await sdk.invokeSkillTool(f,'skill-fixture');
    expect(runtime.ready()).toBe(true);
    sdk.skills[0]!.content='edited-skill';
    await sdk.invokeSkillTool(f,'skill-fixture');
    expect(runtime.ready()).toBe(false);
  });

  it('after dispose the hook is released and an in-flight delivery cannot restore readiness',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({skills:[{...APPROVED}]});
    const runtime=runtimeOf(f);
    const r=await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtime);
    if(r.state!=='REGISTERED')throw Error('not registered');
    let release:()=>void=()=>undefined;
    sdk.skillList.mockImplementationOnce(()=>new Promise(res=>{release=()=>res({data:sdk.finalSkills()});}));
    const pending=sdk.invokeSkillTool(f,'skill-fixture');
    await Promise.resolve();
    await r.dispose();
    release();
    const ev=await pending;
    expect(runtime.ready()).toBe(false);
    expect(textOf(ev)).not.toContain(DAILY_SKILL_APPEND);
  });
});

describe('V2 wiring: partial setup and cleanup',()=>{
  const order:Slot[]=['execute.before','execute.after','daily-tool','skill'];
  it.each(order)('a failure registering %s disposes only acquired handles in reverse and keeps justice_review',async(slot)=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({failAt:slot});
    const cleanup=await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtimeOf(f)}).setup(sdk.context as never);
    const acquired=order.slice(0,order.indexOf(slot));
    expect(sdk.log).toEqual(['register:review',...acquired.map(s=>`register:${s}`),...[...acquired].reverse().map(s=>`dispose:${s}`)]);
    expect(sdk.added.map(t=>t.name)[0]).toBe('justice_review');
    expect(sdk.log).not.toContain('dispose:review');
    if(typeof cleanup!=='function')throw Error('cleanup missing');
    await cleanup();
    expect(sdk.log.at(-1)).toBe('dispose:review');
    expect(sdk.log.filter(l=>l.startsWith('dispose:'))).toHaveLength(acquired.length+1);
  });

  it('a rollback cleanup failure reports the fixed CLEANUP_FAILED code and continues best effort',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({failAt:'skill',disposeFail:'daily-tool',direct:true});
    const r=await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtimeOf(f));
    expect(r).toEqual({state:'OFF',reason:'CLEANUP_FAILED'});
    expect(sdk.log.filter(l=>l.startsWith('dispose:'))).toEqual(['dispose:daily-tool','dispose:execute.after','dispose:execute.before']);
  });

  it('a rollback without cleanup failure reports SETUP_FAILED',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({failAt:'daily-tool',direct:true});
    expect(await registerDailyAssurance(sdk.context as unknown as DailyPluginContext,runtimeOf(f))).toEqual({state:'OFF',reason:'SETUP_FAILED'});
  });

  it('full cleanup disposes Daily first in inverse order, swallows failures and then the review handle',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk({disposeFail:'skill'});
    const cleanup=await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtimeOf(f)}).setup(sdk.context as never);
    if(typeof cleanup!=='function')throw Error('cleanup missing');
    await expect(cleanup()).resolves.toBeUndefined();
    expect(sdk.log.filter(l=>l.startsWith('dispose:'))).toEqual(['dispose:skill','dispose:daily-tool','dispose:execute.after','dispose:execute.before','dispose:review']);
  });

  it('a rejecting Daily runtime keeps the legacy tool and fail-open setup',async()=>{
    const sdk=makeSdk();
    const cleanup=await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>{throw Error('runtime boom');}}).setup(sdk.context as never);
    expect(sdk.added.map(t=>t.name)).toEqual(['justice_review']);
    expect(typeof cleanup).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Production supply: fixed root + env only
// ---------------------------------------------------------------------------

const prodContext=(directory:string):DailyPluginContext=>({...makeSdk().context,location:{directory}} as unknown as DailyPluginContext);
const mountLine=(point:string,opts:string):string=>`41 30 0:52 / ${point} ${opts} master:1 - tmpfs tmpfs ${opts}`;
function ownerMount(opts='ro,nosuid,nodev',extra:string[]=[]):void{
  vfs.nodes.set('/proc/self/mountinfo',{type:'file',bytes:enc([mountLine('/',"rw,relatime"),mountLine(DAILY_OWNER_ROOT,opts),...extra].join('\n')+'\n')});
  vfs.nodes.set('/run',{type:'dir'});
  vfs.nodes.set('/run/justice-daily',{type:'dir'});
  vfs.nodes.set(DAILY_OWNER_ROOT,{type:'dir'});
}

describe('production daily supply',()=>{
  it('is OFF without the opt-in env and ignores arbitrary context options',async()=>{
    vi.stubEnv(DAILY_APPROVAL_ENV,undefined);
    const r=await createProductionDailyPorts(prodContext('/tmp/x'));
    expect(r).toEqual({state:'OFF',reason:'NOT_OPTED_IN'});
    expect(vfs.accessed).toEqual([]);
  });

  it('returns OFF/TIMEOUT when approval reading stalls and never registers Daily after late completion',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    const approvalPath=`${DAILY_OWNER_ROOT}/approval.json`;
    vfs.nodes.set(approvalPath,{type:'file',bytes:d.approvalBytes});
    const readGate=deferred();
    vfs.approvalReadGate=readGate.promise;
    vi.useFakeTimers();
    const sdk=makeSdk();
    let settled=false;
    const setup=createJusticeV2Plugin({createAdapter:fakeAdapter}).setup(sdk.context as never).finally(()=>{settled=true;});
    try{
      await flush();
      expect(vfs.accessed).toContain(`open:${approvalPath}`);
      await vi.advanceTimersByTimeAsync(30_000);
      await flush();
      expect(settled).toBe(true);
      expect(sdk.added.map(t=>t.name)).toEqual(['justice_review']);
      expect(sdk.toolHook).not.toHaveBeenCalled();
      expect(sdk.skillTransform).not.toHaveBeenCalled();

      readGate.resolve();
      await flush();
      expect(sdk.added.map(t=>t.name)).toEqual(['justice_review']);
    }finally{
      readGate.resolve();
      await setup.then(cleanup=>typeof cleanup==='function'?cleanup():undefined).catch(()=>undefined);
      vi.useRealTimers();
    }
  });

  it('reads the env at call time and rejects a malformed digest before any filesystem access',async()=>{
    vi.stubEnv(DAILY_APPROVAL_ENV,'not-a-digest');
    expect(await createProductionDailyPorts(prodContext('/tmp/x'))).toEqual({state:'OFF',reason:'APPROVAL_INVALID'});
    expect(vfs.accessed).toEqual([]);
  });

  it.each([
    ['no Owner mount',():void=>{vfs.nodes.set('/proc/self/mountinfo',{type:'file',bytes:enc(mountLine('/','rw')+'\n')});}],
    ['a writable Owner mount',():void=>ownerMount('rw,nosuid')],
    ['a nested mount below the Owner root',():void=>ownerMount('ro',[mountLine(`${DAILY_OWNER_ROOT}/artifacts`,'rw')])],
    ['a stacked Owner mount',():void=>ownerMount('ro',[mountLine(DAILY_OWNER_ROOT,'rw')])],
  ])('%s disables Daily before reading the approval',async(_n,arrange)=>{
    vi.stubEnv(DAILY_APPROVAL_ENV,'a'.repeat(64));
    arrange();
    expect(await createProductionDailyPorts(prodContext('/tmp/x'))).toEqual({state:'OFF',reason:'OWNER_BOUNDARY_UNVERIFIED'});
    expect(vfs.accessed).toContain('open:/proc/self/mountinfo');
    expect(vfs.accessed.filter(a=>a.includes('approval.json'))).toEqual([]);
  });

  it('reads only the fixed approval path and rejects a digest mismatch',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,'b'.repeat(64));
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    expect(await createProductionDailyPorts(prodContext('/tmp/x'))).toEqual({state:'OFF',reason:'APPROVAL_DIGEST_MISMATCH'});
    expect(vfs.accessed).toContain(`open:${DAILY_OWNER_ROOT}/approval.json`);
    expect(vfs.accessed.filter(a=>a.startsWith('open:')).map(a=>a.slice(5)).filter(p=>p!=='/proc/self/mountinfo'))
      .toEqual([`${DAILY_OWNER_ROOT}/approval.json`]);
  });

  it('a workspace that does not resolve to the approved root is OFF',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    vfs.realpaths.set('/tmp/host-dir',`${d.approval.worktreeRoot}-other`);
    expect(await createProductionDailyPorts(prodContext('/tmp/host-dir'))).toEqual({state:'OFF',reason:'WORKSPACE_MISMATCH'});
  });

  it('a host executable digest mismatch is OFF and no coordinator port is supplied',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    vfs.realpaths.set('/tmp/host-dir',d.approval.worktreeRoot);
    vfs.nodes.set('/proc/self/exe',{type:'file',bytes:enc('not-the-approved-host')});
    expect(sha('not-the-approved-host')).not.toBe(d.approval.hostBinarySha256);
    expect(await createProductionDailyPorts(prodContext('/tmp/host-dir'))).toEqual({state:'OFF',reason:'HOST_MISMATCH'});
    expect(vfs.accessed).toContain('open:/proc/self/exe');
    expect(vfs.writes).toEqual([]);
  });

  it('a changed env digest between setup steps is never silently re-bound',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    vfs.realpaths.set('/tmp/host-dir',d.approval.worktreeRoot);
    vfs.nodes.set('/proc/self/exe',{type:'file',bytes:enc('x')});
    const pending=createProductionDailyPorts(prodContext('/tmp/host-dir'));
    vi.stubEnv(DAILY_APPROVAL_ENV,'c'.repeat(64));
    expect(await pending).toEqual({state:'OFF',reason:'APPROVAL_DIGEST_MISMATCH'});
    expect(vfs.accessed).not.toContain('open:/proc/self/exe');
  });
});

describe('Daily Assurance defensive boundaries',()=>{
  it('converts malformed calls and observations to fixed outcomes without throwing',async()=>{
    const f=await makeCoordinatorFixture();
    expect(await f.coordinator.begin(null as unknown as BoundaryCall)).toEqual({state:'UNAVAILABLE',reason:'IDENTITY_UNMATCHED'});

    const hostileCall=Object.defineProperty({},'sessionId',{get(){throw Error('hostile call');}}) as BoundaryCall;
    expect(await f.coordinator.begin(hostileCall)).toEqual({state:'UNAVAILABLE',reason:'SETUP_FAILED'});
    expect((await f.coordinator.finish(f.daily.expectedSha256,hostileCall)).reasons).toEqual(['DIAGNOSTIC_UNAVAILABLE']);

    expect(()=>f.coordinator.observe(null as unknown as NativeObservation)).not.toThrow();
    expect(()=>f.coordinator.observe({} as NativeObservation)).not.toThrow();
    expect(()=>f.coordinator.observe({
      sessionId:f.SID,messageId:'msg_invalid',callId:'tool_invalid',tool:'read',
      phase:'MIDDLE' as NativeObservation['phase'],status:'STARTED',ruleId:null,
    })).not.toThrow();
    expect(()=>f.coordinator.observe({
      sessionId:f.SID,messageId:'msg_error',callId:'tool_error',tool:'read',
      phase:'AFTER',status:'ERROR',ruleId:null,
    })).not.toThrow();
    expect(f.coordinator.getState()).toBe('ARMED');
  });

  it('returns ABORTED for an already-aborted begin and BUSY while the one begin is still collecting',async()=>{
    const f=await makeCoordinatorFixture();
    const aborted=new AbortController();
    aborted.abort();
    expect(await f.coordinator.begin({...f.beginCall,signal:aborted.signal})).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});

    const hold=f.holdNextNative();
    const pending=f.coordinator.begin(f.beginCall);
    await expect.poll(()=>f.nativeCalls).toContain('session');
    expect(await f.coordinator.begin(f.call('msg_009','tool_begin2'))).toEqual({state:'UNAVAILABLE',reason:'BUSY'});
    expect((await f.coordinator.finish(f.daily.expectedSha256,f.finishCall)).reasons).toEqual(['BUSY']);
    hold.resolve();
    expect((await pending).state).toBe('READY');
  });

  it('cancels a begin already collecting Native evidence when its caller aborts',async()=>{
    const f=await makeCoordinatorFixture();
    const controller=new AbortController();
    const hold=f.holdNextNative();
    const pending=f.coordinator.begin({...f.beginCall,signal:controller.signal});
    await expect.poll(()=>f.nativeCalls).toContain('session');
    controller.abort();
    hold.resolve();
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    expect(f.coordinator.getState()).toBe('TERMINAL');
  });

  it('fails a STARTING Task closed when the Native hook payload is hostile',async()=>{
    const f=await makeCoordinatorFixture();
    const hold=f.holdNextNative();
    const pending=f.coordinator.begin(f.beginCall);
    await expect.poll(()=>f.nativeCalls).toContain('session');
    const hostile=new Proxy({}, {get(){throw Error('hostile hook');}});
    expect(()=>f.coordinator.observe(hostile as NativeObservation)).not.toThrow();
    hold.resolve();
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
    expect(f.coordinator.getState()).toBe('TERMINAL');
  });

  it('fails a STARTING Task closed when another valid tool starts during collection',async()=>{
    const f=await makeCoordinatorFixture();
    const hold=f.holdNextNative();
    const pending=f.coordinator.begin(f.beginCall);
    await expect.poll(()=>f.nativeCalls).toContain('session');
    f.emit('msg_004','tool_unexpected','read','BEFORE');
    hold.resolve();
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
    expect(f.coordinator.getState()).toBe('TERMINAL');
  });

  it('returns DISPOSED when the coordinator is disposed during begin collection',async()=>{
    const f=await makeCoordinatorFixture();
    const hold=f.holdNextNative();
    const pending=f.coordinator.begin(f.beginCall);
    await expect.poll(()=>f.nativeCalls).toContain('session');
    f.coordinator.dispose();
    expect(()=>f.coordinator.observe({
      sessionId:f.SID,messageId:'msg_disposed',callId:'tool_disposed',tool:'read',
      phase:'BEFORE',status:'STARTED',ruleId:null,
    })).not.toThrow();
    hold.resolve();
    expect(await pending).toEqual({state:'UNAVAILABLE',reason:'DISPOSED'});
    expect(f.coordinator.getState()).toBe('DISPOSED');
  });

  it('treats a Native tool-name change within one call as an uncertain boundary',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    f.emit('msg_004','tool_alias','shell','BEFORE','r1');
    f.emit('msg_004','tool_alias','read','AFTER');
    const report=await f.coordinator.finish(key,f.finishCall);
    expect(report.state).not.toBe('DIAGNOSED');
    expect(report.boundary).toBe('UNCERTAIN');
    expect(report.reasons).toContain('BOUNDARY_UNCERTAIN');
  });

  it('withdraws FINISHING evidence when the Native hook payload is hostile',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const before=f.nativeReads;
    const hold=f.holdNextNative();
    const pending=f.coordinator.finish(key,f.finishCall);
    await expect.poll(()=>f.nativeCalls.slice(before)).toContain('session');
    const hostile=new Proxy({}, {get(){throw Error('hostile hook');}});
    expect(()=>f.coordinator.observe(hostile as NativeObservation)).not.toThrow();
    hold.resolve();
    const report=await pending;
    expect(report.state).not.toBe('DIAGNOSED');
    expect(report.evidence.state).toBe('UNAVAILABLE');
    expect(report.reasons).toContain('LATE_OBSERVATION');
  });

  it('counts a conflicting control-hook identity observed while FINISHING as late work',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const hold=f.holdNextNative();
    const pending=f.coordinator.finish(key,f.finishCall);
    await expect.poll(()=>f.nativeCalls.slice(f.nativeReads-1)).toContain('session');
    f.emit('msg_003','tool_finish','justice_task_begin','BEFORE');
    hold.resolve();
    const report=await pending;
    expect(report.state).not.toBe('DIAGNOSED');
    expect(report.evidence.state).toBe('UNAVAILABLE');
    expect(report.reasons).toContain('LATE_OBSERVATION');
  });

  it('marks a malformed Native observation after TERMINAL as a late boundary change',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    expect((await f.coordinator.finish(key,f.finishCall)).state).toBe('DIAGNOSED');
    const hostile=new Proxy({}, {get(){throw Error('hostile hook');}});
    expect(()=>f.coordinator.observe(hostile as NativeObservation)).not.toThrow();
    const report=await f.coordinator.finish(key,f.finishCall);
    expect(report.state).toBe('LIMITED');
    expect(report.reasons).toContain('LATE_OBSERVATION');
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('invalidates a collected Git scope if Native work starts before the end snapshot settles',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const before=f.nativeReads;
    const endSnapshot=f.holdNextNative(2);
    const pending=f.coordinator.finish(key,f.finishCall);
    await expect.poll(()=>f.nativeCalls.slice(before).filter(c=>c==='session')).toHaveLength(3);
    expect(f.gitReads).toBeGreaterThan(0);
    f.emit('msg_004','tool_late','read','BEFORE');
    endSnapshot.resolve();

    const report=await pending;
    expect(report.state).not.toBe('DIAGNOSED');
    expect(report.evidence.state).toBe('UNAVAILABLE');
    expect(report.changeSetOrigin).toBe('UNAVAILABLE');
    expect(report.reasons).toContain('LATE_OBSERVATION');
  });

  it('returns ABORTED for a terminal revalidation requested by an already-aborted caller',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    expect((await f.coordinator.finish(key,f.finishCall)).state).toBe('DIAGNOSED');
    const controller=new AbortController();
    controller.abort();
    const report=await f.coordinator.finish(key,{...f.finishCall,signal:controller.signal});
    expect(report.reasons).toEqual(['ABORTED']);
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('cancels a finish in Native collection when its caller aborts',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    const before=f.nativeReads;
    const controller=new AbortController();
    const hold=f.holdNextNative();
    const pending=f.coordinator.finish(key,{...f.finishCall,signal:controller.signal});
    await expect.poll(()=>f.nativeCalls.slice(before)).toContain('session');
    controller.abort();
    hold.resolve();
    const report=await pending;
    expect(report.reasons).toEqual(['ABORTED']);
    expect(report.evidence.state).toBe('NOT_EVALUATED');
    expect(f.diagnose).not.toHaveBeenCalled();
  });

  it('keeps an invalidated terminal result unavailable after a late malformed observation',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    expect((await f.coordinator.finish(key,f.finishCall)).state).toBe('DIAGNOSED');
    f.setArtifactBytes('plan-1.md',enc('changed'));
    expect((await f.coordinator.finish(key,f.call('msg_005','tool_finish5'))).reasons).toEqual(['BINDING_INVALID']);
    f.coordinator.observe(null as unknown as NativeObservation);
    expect((await f.coordinator.finish(key,f.call('msg_006','tool_finish6'))).reasons).toEqual(['BINDING_INVALID']);
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('rejects a terminal lookup with a different well-formed binding key without rereading evidence',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    expect((await f.coordinator.finish(key,f.finishCall)).state).toBe('DIAGNOSED');
    const reads={native:f.nativeReads,git:f.gitReads};
    expect((await f.coordinator.finish('0'.repeat(64),f.call('msg_005','tool_finish5'))).reasons)
      .toEqual(['BINDING_KEY_MISMATCH']);
    expect({native:f.nativeReads,git:f.gitReads}).toEqual(reads);
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });

  it('maps an unexpected terminal revalidation exception to BINDING_INVALID',async()=>{
    const f=await makeCoordinatorFixture();
    const key=await begun(f);
    f.observePair();
    expect((await f.coordinator.finish(key,f.finishCall)).state).toBe('DIAGNOSED');
    Object.defineProperty(f.ports,'preflight',{configurable:true,get(){throw Error('preflight unavailable');}});
    const report=await f.coordinator.finish(key,f.finishCall);
    expect(report.reasons).toEqual(['BINDING_INVALID']);
    expect(f.diagnose).toHaveBeenCalledTimes(1);
  });
});

describe('Daily Assurance SDK boundary failures',()=>{
  it('returns fixed results for hostile direct-tool inputs, contexts and hook payloads',async()=>{
    const f=await makeCoordinatorFixture();
    const sdk=makeSdk();
    const runtime=runtimeOf(f);
    const cleanup=await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtime}).setup(sdk.context as never);
    const begin=daily(sdk,'justice_task_begin');
    const finish=daily(sdk,'justice_task_finish');
    const hostileInput=new Proxy({}, {getPrototypeOf(){throw Error('hostile input');}});
    expect(parse(await begin.execute(hostileInput,toolCtx(f,'msg_001','tool_begin')))).toEqual({state:'UNAVAILABLE',reason:'SETUP_FAILED'});
    expect(parse(await finish.execute(hostileInput,toolCtx(f,'msg_003','tool_finish'))).reasons).toEqual(['DIAGNOSTIC_UNAVAILABLE']);

    const context= new Proxy(toolCtx(f,'msg_001','tool_begin'),{
      get(target,property,receiver){if(property==='signal')throw Error('hostile signal');return Reflect.get(target,property,receiver);},
    });
    expect(parse(await begin.execute({},context))).toEqual({state:'UNAVAILABLE',reason:'IDENTITY_UNMATCHED'});

    const hostileHook=new Proxy({}, {getOwnPropertyDescriptor(){throw Error('hostile hook');}});
    await expect(hook(sdk,'execute.before',hostileHook as Rec)).resolves.toBeUndefined();
    if(typeof cleanup!=='function')throw Error('cleanup missing');
    await cleanup();
  });

  it('keeps justice_review available when malformed Daily ports fail coordinator setup',async()=>{
    const sdk=makeSdk();
    const runtime={
      state:'READY',
      ports:new Proxy({}, {get(){throw Error('malformed Daily ports');}}),
      markSkillReady:()=>undefined,
    } as unknown as DailyRuntimeResult;
    const cleanup=await createJusticeV2Plugin({createAdapter:fakeAdapter,createDailyRuntime:async()=>runtime}).setup(sdk.context as never);
    expect(sdk.added.map(t=>t.name)).toEqual(['justice_review']);
    expect(sdk.log).toEqual(['register:review']);
    if(typeof cleanup!=='function')throw Error('cleanup missing');
    await cleanup();
  });
});

describe('additional production-supply failure boundaries',()=>{
  it('fails closed when /proc/self/mountinfo cannot be read',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    expect(await createProductionDailyPorts(prodContext('/tmp/x'))).toEqual({state:'OFF',reason:'OWNER_BOUNDARY_UNVERIFIED'});
    expect(vfs.accessed).toContain('open:/proc/self/mountinfo');
    expect(vfs.accessed.filter(path=>path.includes('approval.json'))).toEqual([]);
  });

  it('rejects malformed mountinfo records before loading Owner approval',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    vfs.nodes.set('/proc/self/mountinfo',{type:'file',bytes:enc('malformed\n')});
    expect(await createProductionDailyPorts(prodContext('/tmp/x'))).toEqual({state:'OFF',reason:'OWNER_BOUNDARY_UNVERIFIED'});
    expect(vfs.accessed).toContain('open:/proc/self/mountinfo');
    expect(vfs.accessed.filter(path=>path.includes('approval.json'))).toEqual([]);
  });

  it('fails closed when the fixed executable cannot be read',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    vfs.realpaths.set('/tmp/host-dir',d.approval.worktreeRoot);
    expect(await createProductionDailyPorts(prodContext('/tmp/host-dir'))).toEqual({state:'OFF',reason:'HOST_MISMATCH'});
    expect(vfs.accessed).toContain('open:/proc/self/exe');
    expect(vfs.writes).toEqual([]);
  });

  it('rejects worktrees below the Owner-only root before resolving them',async()=>{
    const base=await makeDailyFixture();
    const root=`${DAILY_OWNER_ROOT}/workspace`;
    const d=await makeDailyFixture({approvalPatch:{
      worktreeRoot:root,
      rules:base.approval.rules.map(rule=>({...rule,input:{...rule.input,workdir:root}})),
    }});
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    expect(await createProductionDailyPorts(prodContext('/tmp/host-dir'))).toEqual({state:'OFF',reason:'OWNER_BOUNDARY_UNVERIFIED'});
    expect(vfs.accessed).not.toContain('open:/proc/self/exe');
  });

  it('fails closed when Host context cannot provide a trusted workspace directory',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    const context=new Proxy(prodContext('/tmp/host-dir'),{
      getOwnPropertyDescriptor(target,property){if(property==='location')throw Error('hostile context');return Reflect.getOwnPropertyDescriptor(target,property);},
    });
    expect(await createProductionDailyPorts(context)).toEqual({state:'OFF',reason:'WORKSPACE_MISMATCH'});
    expect(vfs.accessed).not.toContain('open:/proc/self/exe');
  });

  it('fails closed when the approved workspace cannot be resolved',async()=>{
    const d=await makeDailyFixture();
    vi.stubEnv(DAILY_APPROVAL_ENV,d.expectedSha256);
    ownerMount();
    vfs.nodes.set(`${DAILY_OWNER_ROOT}/approval.json`,{type:'file',bytes:d.approvalBytes});
    expect(await createProductionDailyPorts(prodContext('/tmp/missing-host-dir'))).toEqual({state:'OFF',reason:'WORKSPACE_MISMATCH'});
    expect(vfs.accessed).not.toContain('open:/proc/self/exe');
  });
});
