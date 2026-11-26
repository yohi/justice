import {describe,expect,it,vi} from 'vitest';
import {extractTaskScopePolicy} from '../../src/core/s1c/policy.js';
import {loadS1aArtifacts} from '../../src/core/s1a/loader.js';
import {
  DAILY_HOST_SHA256,loadDailyOwnerConfig,matchRuleInput,prepareDailyBinding,verifyDailyBinding,
  type DailyPreflightPorts,type OwnerConfigReadPort,
} from '../../src/runtime/daily-intent.js';
import {createCapturedS1aSource} from '../../src/runtime/s1d-read-only-input.js';
import {makeDailyFixture,defaultPlanText,type DailyFixture} from '../helpers/daily-fixtures.js';
import {jsonBytes,s1aFixture,sha256} from '../helpers/s1a-fixtures.js';

vi.mock('../../src/core/s1c/policy.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../src/core/s1c/policy.js')>();
  return {...actual,extractTaskScopePolicy:vi.fn(actual.extractTaskScopePolicy)};
});
vi.mock('../../src/core/s1a/loader.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../src/core/s1a/loader.js')>();
  return {...actual,loadS1aArtifacts:vi.fn(actual.loadS1aArtifacts)};
});
vi.mock('../../src/runtime/s1d-read-only-input.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../src/runtime/s1d-read-only-input.js')>();
  return {...actual,createCapturedS1aSource:vi.fn(actual.createCapturedS1aSource)};
});

const sig=()=>new AbortController().signal;
const portWith=(bytes:Uint8Array,mount:Awaited<ReturnType<OwnerConfigReadPort['verifyReadOnlyMount']>>={state:'OK'}):OwnerConfigReadPort=>({
  async verifyReadOnlyMount(){return mount;},async readApproval(){return Uint8Array.from(bytes);},
});
const load=(f:DailyFixture,bytes:Uint8Array,expected=sha256(bytes))=>loadDailyOwnerConfig(expected,portWith(bytes),sig());
const patched=(f:DailyFixture,patch:Record<string,unknown>)=>jsonBytes({...f.approval,...patch});
const removeKey=(f:DailyFixture,key:string)=>{const o:Record<string,unknown>={...f.approval};delete o[key];return jsonBytes(o);};

describe('daily owner config',()=>{
  it('does not accept a replaced approval or self-supplied digest',async()=>{
    const f=await makeDailyFixture();const signal=sig();
    expect((await loadDailyOwnerConfig(undefined,f.configPort,signal)).state).toBe('OFF');
    expect((await loadDailyOwnerConfig(f.expectedSha256,f.configPort,signal)).state).toBe('READY');
    f.setApprovalBytes(jsonBytes({...f.approval,ownerDecisionRef:'agent-made'}));
    expect(await loadDailyOwnerConfig(f.expectedSha256,f.configPort,signal)).toEqual({state:'OFF',reason:'APPROVAL_DIGEST_MISMATCH'});
  });
  it('produces the fixed config equal to the contract',async()=>{
    const f=await makeDailyFixture();
    expect(await loadDailyOwnerConfig(f.expectedSha256,f.configPort,sig())).toEqual({state:'READY',config:f.config});
  });
  it('maps absent and malformed expected digests',async()=>{
    const f=await makeDailyFixture();
    expect(await loadDailyOwnerConfig(undefined,f.configPort,sig())).toEqual({state:'OFF',reason:'NOT_OPTED_IN'});
    for(const bad of ['','ABC','A'.repeat(64),'a'.repeat(63),'g'.repeat(64)])
      expect(await loadDailyOwnerConfig(bad,f.configPort,sig())).toEqual({state:'OFF',reason:'APPROVAL_INVALID'});
  });
  it('maps unexpected loader failures to unavailable source',async()=>{
    const f=await makeDailyFixture();
    vi.mocked(loadS1aArtifacts).mockRejectedValueOnce(Error('unexpected loader failure'));
    expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
  });
  it('rejects S1-a loader reads outside the fixed input and artifact roots',async()=>{
    const inputFixture=await makeDailyFixture();
    vi.mocked(loadS1aArtifacts).mockImplementationOnce(async(_input,source)=>{
      await source.readInputFile('/outside/manifest.json',1);
      throw Error('outside input read was accepted');
    });
    expect(await prepareDailyBinding(inputFixture.config,inputFixture.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_REJECTED'});

    const artifactFixture=await makeDailyFixture();
    vi.mocked(loadS1aArtifacts).mockImplementationOnce(async(_input,source)=>{
      await source.readArtifact('/outside/artifacts','unapproved.md',1);
      throw Error('outside artifact read was accepted');
    });
    expect(await prepareDailyBinding(artifactFixture.config,artifactFixture.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_REJECTED'});
  });
  it('rejects a successful loader result that omits the selected plan',async()=>{
    const f=await makeDailyFixture();
    const runLoader=vi.mocked(loadS1aArtifacts).getMockImplementation();
    if(runLoader===undefined)throw Error('expected real S1-a loader');
    vi.mocked(loadS1aArtifacts).mockImplementationOnce(async(input,source)=>{
      const result=await runLoader(input,source);
      return {...result,selectedRefs:result.selectedRefs.filter(ref=>ref.kind!=='plan')};
    });
    expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'ARTIFACT_MISMATCH'});
  });
  it('rejects when the captured plan snapshot is unavailable',async()=>{
    const f=await makeDailyFixture();
    const capture=vi.mocked(createCapturedS1aSource).getMockImplementation();
    if(capture===undefined)throw Error('expected real S1-d snapshot capture');
    vi.mocked(createCapturedS1aSource).mockImplementationOnce((source,input)=>{
      const captured=capture(source,input);
      return {...captured,getPlanSnapshot:()=>null};
    });
    expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'SCOPE_POLICY_INVALID'});
  });
  it('rejects a scope policy that does not bind the selected task',async()=>{
    const f=await makeDailyFixture();
    const extract=vi.mocked(extractTaskScopePolicy).getMockImplementation();
    if(extract===undefined)throw Error('expected real scope policy extractor');
    vi.mocked(extractTaskScopePolicy).mockImplementationOnce((planBytes,refs)=>{
      const result=extract(planBytes,refs);
      if(result.state!=='READY')return result;
      return {...result,policy:{...result.policy,taskRef:{artifactId:'other-task',revision:'R1'}}};
    });
    expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'SCOPE_POLICY_INVALID'});
  });
  it('reports unverified read-only mount',async()=>{
    const f=await makeDailyFixture();
    const mount={state:'UNAVAILABLE' as const,reason:'SETUP_FAILED' as const};
    expect(await loadDailyOwnerConfig(f.expectedSha256,portWith(f.approvalBytes,mount),sig())).toEqual({state:'OFF',reason:'OWNER_BOUNDARY_UNVERIFIED'});
    const throwing:OwnerConfigReadPort={async verifyReadOnlyMount(){throw Error('x');},async readApproval(){return f.approvalBytes;}};
    expect(await loadDailyOwnerConfig(f.expectedSha256,throwing,sig())).toEqual({state:'OFF',reason:'OWNER_BOUNDARY_UNVERIFIED'});
  });
  it('maps mount and approval read failures to the correct abort state',async()=>{
    const f=await makeDailyFixture();
    const mountAbort=new AbortController();
    const abortingMount:OwnerConfigReadPort={
      async verifyReadOnlyMount(){mountAbort.abort();return {state:'OK'};},
      async readApproval(){return f.approvalBytes;},
    };
    expect(await loadDailyOwnerConfig(f.expectedSha256,abortingMount,mountAbort.signal)).toEqual({state:'OFF',reason:'ABORTED'});

    const thrownMountAbort=new AbortController();
    const throwingMount:OwnerConfigReadPort={
      async verifyReadOnlyMount(){thrownMountAbort.abort();throw Error('mount read failed');},
      async readApproval(){return f.approvalBytes;},
    };
    expect(await loadDailyOwnerConfig(f.expectedSha256,throwingMount,thrownMountAbort.signal)).toEqual({state:'OFF',reason:'ABORTED'});

    const readFailure:OwnerConfigReadPort={
      async verifyReadOnlyMount(){return {state:'OK'};},
      async readApproval(){throw Error('approval read failed');},
    };
    expect(await loadDailyOwnerConfig(f.expectedSha256,readFailure,sig())).toEqual({state:'OFF',reason:'OWNER_BOUNDARY_UNVERIFIED'});

    const thrownReadAbort=new AbortController();
    const throwingRead:OwnerConfigReadPort={
      async verifyReadOnlyMount(){return {state:'OK'};},
      async readApproval(){thrownReadAbort.abort();throw Error('approval read failed');},
    };
    expect(await loadDailyOwnerConfig(f.expectedSha256,throwingRead,thrownReadAbort.signal)).toEqual({state:'OFF',reason:'ABORTED'});
  });
  it('rejects schema violations: missing, unknown, wrong values',async()=>{
    const f=await makeDailyFixture();
    const cases:Uint8Array[]=[
      ...['schemaVersion','enabled','sessionId','intent','skill','nativePort','rules'].map(k=>removeKey(f,k)),
      patched(f,{extra:1}),patched(f,{enabled:false}),patched(f,{hostVersion:'2.3.3'}),
      patched(f,{sessionId:'fixture001'}),patched(f,{sessionId:'ses_bad/id'}),
      patched(f,{ownerDecisionRef:'has space'}),patched(f,{baseCommit:'A'.repeat(40)}),patched(f,{baseCommit:'a'.repeat(39)}),
      patched(f,{nativePort:0}),patched(f,{nativePort:65536}),patched(f,{nativePort:1.5}),
      patched(f,{manifestSha256:'X'.repeat(64)}),patched(f,{intentSha256:'abc'}),
      patched(f,{worktreeRoot:'relative/path'}),patched(f,{worktreeRoot:'/tmp/../etc'}),patched(f,{worktreeRoot:'/tmp//x'}),patched(f,{worktreeRoot:'/tmp/x/'}),
      patched(f,{worktreeRoot:'/tmp\\x'}),patched(f,{worktreeRoot:'/tmp/\0x'}),
      patched(f,{skill:{...f.approval.skill,extra:1}}),patched(f,{skill:{...f.approval.skill,path:'rel/SKILL.md'}}),
      patched(f,{skill:{...f.approval.skill,contentSha256:'z'}}),
      patched(f,{intent:{...f.approval.intent,extra:1}}),
      Buffer.from('{not json'),Buffer.from('{"a":1,"a":2}'),new Uint8Array(70_000),
    ];
    for(const bytes of cases){
      const r=await load(f,bytes);
      expect(r).toEqual({state:'OFF',reason:'APPROVAL_INVALID'});
    }
  });
  it('maps host mismatch and unsupported skill',async()=>{
    const f=await makeDailyFixture();
    expect(await load(f,patched(f,{hostBinarySha256:'b'.repeat(64)}))).toEqual({state:'OFF',reason:'HOST_MISMATCH'});
    expect(DAILY_HOST_SHA256).toHaveLength(64);
    expect(await load(f,patched(f,{skill:{...f.approval.skill,name:'other'}}))).toEqual({state:'OFF',reason:'SKILL_UNSUPPORTED'});
  });
  it('rejects invalid, duplicate and foreign-cwd rules',async()=>{
    const f=await makeDailyFixture();const [r1,r2]=f.approval.rules as [typeof f.approval.rules[number],typeof f.approval.rules[number]];
    const variants:unknown[][]=[
      [],Array.from({length:129},(_,i)=>({...r1,ruleId:`r${i}`,input:{...r1.input,timeout:i+1}})),
      [r1,{...r2,ruleId:'r1'}],
      [r1,{...r2,input:r1.input}],
      [{...r1,input:{...r1.input,extra:1}}],
      [{...r1,input:{...r1.input,workdir:'/tmp/other'}}],
      [{...r1,input:{...r1.input,timeout:0}}],[{...r1,input:{...r1.input,timeout:60_001}}],
      [{...r1,input:{...r1.input,background:true}}],
      [{...r1,input:{...r1.input,command:''}}],[{...r1,input:{...r1.input,command:'a'.repeat(4097)}}],
      [{...r1,input:{...r1.input,command:'a\nb'}}],[{...r1,input:{...r1.input,command:'a\rb'}}],[{...r1,input:{...r1.input,command:'a\0b'}}],
      [{...r1,extra:1}],
      [{...r1,ruleId:'bad id'}],[{...r1,acRef:{artifactId:'ac-9',revision:'R1'}}],[{...r1,acRef:{artifactId:'ac-1',revision:'R2'}}],
      [{...r1,tool:'execute'}],[{...r1,purpose:'OTHER'}],
    ];
    for(const rules of variants)expect(await load(f,patched(f,{rules}))).toEqual({state:'OFF',reason:'RULE_INVALID'});
  });
  it('copies caller buffers and returns immutable config',async()=>{
    const f=await makeDailyFixture();const bytes=Uint8Array.from(f.approvalBytes);
    const r=await loadDailyOwnerConfig(f.expectedSha256,portWith(bytes),sig());
    bytes.fill(0);
    expect(r.state).toBe('READY');
    if(r.state!=='READY')return;
    expect(r.config).toEqual(f.config);
    expect(Object.isFrozen(r.config)).toBe(true);expect(Object.isFrozen(r.config.approval.rules)).toBe(true);
    expect(Object.isFrozen(r.config.approval.rules[0]!.input)).toBe(true);
  });
  it('is suppressed by abort',async()=>{
    const f=await makeDailyFixture();const c=new AbortController();
    const port:OwnerConfigReadPort={async verifyReadOnlyMount(){return {state:'OK'};},async readApproval(){c.abort();return f.approvalBytes;}};
    expect(await loadDailyOwnerConfig(f.expectedSha256,port,c.signal)).toEqual({state:'OFF',reason:'ABORTED'});
    expect(await loadDailyOwnerConfig(f.expectedSha256,f.configPort,c.signal)).toEqual({state:'OFF',reason:'ABORTED'});
  });
});

describe('daily binding',()=>{
  it('binds only the fixed package and invalidates later mutation',async()=>{
    const f=await makeDailyFixture();const signal=sig();
    const start=await prepareDailyBinding(f.config,f.ports,signal);
    expect(start.state).toBe('READY');
    if(start.state!=='READY')throw Error('expected fixture binding');
    expect(start.binding.baseline.eligibleBaseline).toBe(false);
    expect(start.binding.ownerAuthorityStatus).toBe('NOT_PROVEN');
    f.setArtifactBytes('plan-1.md',new TextEncoder().encode('changed'));
    expect((await verifyDailyBinding(start.binding,f.ports,signal)).state).toBe('UNAVAILABLE');
  });
  it('produces key, intent, scope policy and OK verification when unchanged',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');
    expect(start.binding.key).toBe(f.config.approvalSha256);
    expect(start.binding.intent).toEqual(f.approval.intent);
    expect(start.binding.baseline.identityCandidateReady).toBe(true);
    expect(start.binding.scopePolicy.allowedPaths).toEqual(['src/a.ts','tests/**']);
    expect(await verifyDailyBinding(start.binding,f.ports,sig())).toEqual({state:'OK'});
    expect(Object.isFrozen(start.binding)).toBe(true);
  });
  it('private source returns fresh copies, only selected paths',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');
    const li=f.config.loaderInput;
    const a=await start.binding.source.readArtifact(li.artifactsRoot,'plan-1.md',1_000_000);
    a.fill(0);
    const b=await start.binding.source.readArtifact(li.artifactsRoot,'plan-1.md',1_000_000);
    expect(b[0]).not.toBe(0);
    await expect(start.binding.source.readArtifact(li.artifactsRoot,'plan-1.md',0)).rejects.toThrow('over_limit');
    const m=await start.binding.source.readInputFile(li.manifestPath,1_048_576);m.fill(0);
    expect((await start.binding.source.readInputFile(li.manifestPath,1_048_576))[0]).not.toBe(0);
    await expect(start.binding.source.readInputFile(li.manifestPath,0)).rejects.toThrow('over_limit');
    await expect(start.binding.source.readInputFile('/etc/passwd',1000)).rejects.toThrow();
    await expect(start.binding.source.readArtifact(li.artifactsRoot,'other.md',1000)).rejects.toThrow();
    await expect(start.binding.source.readArtifact('/elsewhere','plan-1.md',1000)).rejects.toThrow();
  });
  it('survives source mutation after binding (private snapshot immutable)',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');
    const before=await start.binding.source.readArtifact(f.config.loaderInput.artifactsRoot,'plan-1.md',1_000_000);
    f.setArtifactBytes('plan-1.md',new TextEncoder().encode('changed'));
    const after=await start.binding.source.readArtifact(f.config.loaderInput.artifactsRoot,'plan-1.md',1_000_000);
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
  });
  it('detects a changed artifact with the same filename and digest check',async()=>{
    const f=await makeDailyFixture();
    f.setArtifactBytes('task-1.md',new TextEncoder().encode('different'));
    expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'ARTIFACT_MISMATCH'});
  });
  it('propagates runtime, clean/base checks and does not READY',async()=>{
    for(const reason of ['HOST_MISMATCH','WORKSPACE_MISMATCH'] as const){
      const f=await makeDailyFixture();f.setRuntimeCheck({state:'UNAVAILABLE',reason});
      expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason});
    }
    for(const reason of ['DIRTY_BASE','BASE_MISMATCH'] as const){
      const f=await makeDailyFixture();f.setCleanCheck({state:'UNAVAILABLE',reason});
      expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason});
    }
  });
  it('stops when reload or runtime verification aborts and maps unexpected setup errors',async()=>{
    const f=await makeDailyFixture();
    const reloadAbort=new AbortController();
    const abortingReload:DailyPreflightPorts={
      ...f.ports,
      async reloadOwnerConfig(){reloadAbort.abort();return {state:'READY',config:f.config};},
    };
    expect(await prepareDailyBinding(f.config,abortingReload,reloadAbort.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});

    const runtimeAbort=new AbortController();
    const abortingRuntime:DailyPreflightPorts={
      ...f.ports,
      async verifyRuntime(){runtimeAbort.abort();return {state:'OK'};},
    };
    expect(await prepareDailyBinding(f.config,abortingRuntime,runtimeAbort.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});

    const throwingReload:DailyPreflightPorts={
      ...f.ports,
      async reloadOwnerConfig(){throw Error('owner config unavailable');},
    };
    expect(await prepareDailyBinding(f.config,throwingReload,sig())).toEqual({state:'UNAVAILABLE',reason:'SETUP_FAILED'});

    const setupAbort=new AbortController();
    const abortingThrow:DailyPreflightPorts={
      ...f.ports,
      async reloadOwnerConfig(){setupAbort.abort();throw Error('owner config read aborted');},
    };
    expect(await prepareDailyBinding(f.config,abortingThrow,setupAbort.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
  it('distinguishes unreadable or mismatched owner inputs from incomplete artifacts',async()=>{
    const f=await makeDailyFixture();
    const manifestPath=f.config.loaderInput.manifestPath;
    const intentPath=f.config.loaderInput.intentPath;

    const unreadableManifest:DailyPreflightPorts={
      ...f.ports,
      source:{
        async readInputFile(path,maxBytes){
          if(path===manifestPath)throw Error('manifest unavailable');
          return f.source.readInputFile(path,maxBytes);
        },
        readArtifact:(root,path,maxBytes)=>f.source.readArtifact(root,path,maxBytes),
      },
    };
    expect(await prepareDailyBinding(f.config,unreadableManifest,sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});

    const changedManifest:DailyPreflightPorts={
      ...f.ports,
      source:{
        async readInputFile(path,maxBytes){
          if(path===manifestPath)return new TextEncoder().encode('changed manifest');
          return f.source.readInputFile(path,maxBytes);
        },
        readArtifact:(root,path,maxBytes)=>f.source.readArtifact(root,path,maxBytes),
      },
    };
    expect(await prepareDailyBinding(f.config,changedManifest,sig())).toEqual({state:'UNAVAILABLE',reason:'ARTIFACT_MISMATCH'});

    const unreadableIntent:DailyPreflightPorts={
      ...f.ports,
      source:{
        async readInputFile(path,maxBytes){
          if(path===intentPath)throw Error('intent unavailable');
          return f.source.readInputFile(path,maxBytes);
        },
        readArtifact:(root,path,maxBytes)=>f.source.readArtifact(root,path,maxBytes),
      },
    };
    expect(await prepareDailyBinding(f.config,unreadableIntent,sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});

    const unreadableArtifact:DailyPreflightPorts={
      ...f.ports,
      source:{
        readInputFile:(path,maxBytes)=>f.source.readInputFile(path,maxBytes),
        async readArtifact(root,path,maxBytes){
          if(path==='plan-1.md')throw Error('artifact unavailable');
          return f.source.readArtifact(root,path,maxBytes);
        },
      },
    };
    expect(await prepareDailyBinding(f.config,unreadableArtifact,sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_INCOMPLETE'});

    const artifactAbort=new AbortController();
    const abortDuringArtifactRead:DailyPreflightPorts={
      ...f.ports,
      source:{
        readInputFile:(path,maxBytes)=>f.source.readInputFile(path,maxBytes),
        async readArtifact(root,path,maxBytes){
          const bytes=await f.source.readArtifact(root,path,maxBytes);
          artifactAbort.abort();
          return bytes;
        },
      },
    };
    expect(await prepareDailyBinding(f.config,abortDuringArtifactRead,artifactAbort.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
  it('does not repeat the clean check on verify',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');
    f.setCleanCheck({state:'UNAVAILABLE',reason:'DIRTY_BASE'});
    expect(await verifyDailyBinding(start.binding,f.ports,sig())).toEqual({state:'OK'});
  });
  it('rejects reload that returns OFF or a changed approval',async()=>{
    const f=await makeDailyFixture();
    const off:DailyPreflightPorts={...f.ports,async reloadOwnerConfig(){return {state:'OFF',reason:'APPROVAL_DIGEST_MISMATCH'};}};
    expect(await prepareDailyBinding(f.config,off,sig())).toEqual({state:'UNAVAILABLE',reason:'APPROVAL_DIGEST_MISMATCH'});
    const other:DailyPreflightPorts={...f.ports,async reloadOwnerConfig(){return {state:'READY',config:{...f.config,approvalSha256:'c'.repeat(64)}};}};
    expect((await prepareDailyBinding(f.config,other,sig())).state).toBe('UNAVAILABLE');
  });
  it('verify invalidates on approval, runtime and source changes',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');
    const bad={state:'UNAVAILABLE' as const,reason:'BINDING_INVALID' as const};
    f.setRuntimeCheck({state:'UNAVAILABLE',reason:'HOST_MISMATCH'});
    expect(await verifyDailyBinding(start.binding,f.ports,sig())).toEqual(bad);
    f.setRuntimeCheck({state:'OK'});
    expect(await verifyDailyBinding(start.binding,f.ports,sig())).toEqual({state:'OK'});
    f.setApprovalBytes(patched(f,{ownerDecisionRef:'agent-made'}));
    expect(await verifyDailyBinding(start.binding,f.ports,sig())).toEqual(bad);
    const g=await makeDailyFixture();const s2=await prepareDailyBinding(g.config,g.ports,sig());
    if(s2.state!=='READY')throw Error('expected binding');
    g.setArtifactBytes('ac-2.md',new TextEncoder().encode('x'));
    expect(await verifyDailyBinding(s2.binding,g.ports,sig())).toEqual(bad);
  });
  it('verify never accepts a different supply that merely matches private snapshots',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');
    const dead:DailyPreflightPorts={...f.ports,source:{async readInputFile(){throw Error('gone');},async readArtifact(){throw Error('gone');}}};
    expect(await verifyDailyBinding(start.binding,dead,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
  });
  it('rejects altered binding keys, snapshots, and scope policies',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');

    expect(await verifyDailyBinding({...start.binding,key:'different'},f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
    expect(await verifyDailyBinding({
      ...start.binding,
      baseline:{...start.binding.baseline,manifestId:'different'},
    },f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
    expect(await verifyDailyBinding({
      ...start.binding,
      scopePolicy:{...start.binding.scopePolicy,scopeKey:'different'},
    },f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
  });
  it('maps aborts and errors while revalidating a binding',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');

    const reloadAbort=new AbortController();
    const abortingReload:DailyPreflightPorts={
      ...f.ports,
      async reloadOwnerConfig(){reloadAbort.abort();return {state:'READY',config:f.config};},
    };
    expect(await verifyDailyBinding(start.binding,abortingReload,reloadAbort.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});

    const runtimeAbort=new AbortController();
    const abortingRuntime:DailyPreflightPorts={
      ...f.ports,
      async verifyRuntime(){runtimeAbort.abort();return {state:'OK'};},
    };
    expect(await verifyDailyBinding(start.binding,abortingRuntime,runtimeAbort.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});

    const throwingRuntime:DailyPreflightPorts={
      ...f.ports,
      async verifyRuntime(){throw Error('runtime check failed');},
    };
    expect(await verifyDailyBinding(start.binding,throwingRuntime,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});

    const verifyAbort=new AbortController();
    const abortingThrow:DailyPreflightPorts={
      ...f.ports,
      async verifyRuntime(){verifyAbort.abort();throw Error('runtime check aborted');},
    };
    expect(await verifyDailyBinding(start.binding,abortingThrow,verifyAbort.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
  it('invalidates a failed held-snapshot read and observes cancellation during that read',async()=>{
    const f=await makeDailyFixture();
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');

    const unreadableHeldSource={
      async readInputFile(){throw Error('held input unavailable');},
      async readArtifact(){throw Error('held artifact unavailable');},
    };
    expect(await verifyDailyBinding({...start.binding,source:unreadableHeldSource},f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});

    const controller=new AbortController();
    const abortingHeldSource={
      async readInputFile(path:string,maxBytes:number){
        const bytes=await start.binding.source.readInputFile(path,maxBytes);
        controller.abort();
        return bytes;
      },
      readArtifact:(root:string,path:string,maxBytes:number)=>start.binding.source.readArtifact(root,path,maxBytes),
    };
    expect(await verifyDailyBinding({...start.binding,source:abortingHeldSource},f.ports,controller.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
  it('maps intent digest mismatch',async()=>{
    const f=await makeDailyFixture({approvalPatch:{intentSha256:'d'.repeat(64)}});
    expect(await prepareDailyBinding(f.config,f.ports,sig())).toEqual({state:'UNAVAILABLE',reason:'INTENT_DIGEST_MISMATCH'});
  });
  it('maps approval intent differing from intent.json',async()=>{
    const f=await makeDailyFixture();
    const base=f.approval.intent;
    const other={...base,ac:[base.ac[0]!]};
    const config={...f.config,approval:{...f.config.approval,intent:other}};
    const ports:DailyPreflightPorts={...f.ports,reloadOwnerConfig:async()=>({state:'READY',config})};
    expect(await prepareDailyBinding(config,ports,sig())).toEqual({state:'UNAVAILABLE',reason:'INTENT_DIGEST_MISMATCH'});
  });
  it('rejects a reload with the same digest but different approval, rules or loaderInput',async()=>{
    const f=await makeDailyFixture();
    const a=f.config.approval;
    const variants=[
      {...f.config,approval:{...a,rules:[a.rules[0]!]}},
      {...f.config,approval:{...a,ownerDecisionRef:'other-ref'}},
      {...f.config,approval:{...a,skill:{...a.skill,id:'other-skill'}}},
      {...f.config,loaderInput:{...f.config.loaderInput,artifactsRoot:'/run/justice-daily/owner/other'}},
    ];
    for(const changed of variants){
      const ports:DailyPreflightPorts={...f.ports,reloadOwnerConfig:async()=>({state:'READY',config:changed})};
      expect(await prepareDailyBinding(f.config,ports,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
    }
  });
  it('rejects selected task/revision/scope/AC mismatches with specific reasons',async()=>{
    const base=s1aFixture().intent;
    type Case=[string,typeof base,'config'|'binding',string];
    const cases:Case[]=[
      ['task revision',{...base,task:{artifactId:'task-1',revision:'R2'}},'binding','ARTIFACT_MISMATCH'],
      ['unknown task',{...base,task:{artifactId:'task-9',revision:'R1'}},'binding','ARTIFACT_MISMATCH'],
      ['scope key',{...base,scopeKey:'scope-2'},'binding','ARTIFACT_MISMATCH'],
      ['ac revision (rule AC no longer selected)',{...base,ac:[{artifactId:'ac-1',revision:'R2'},base.ac[1]!]},'config','RULE_INVALID'],
      ['duplicate ac',{...base,ac:[{artifactId:'ac-1',revision:'R1'},{artifactId:'ac-1',revision:'R1'}]},'config','APPROVAL_INVALID'],
    ];
    for(const [name,intent,stage,reason] of cases){
      const f=await makeDailyFixture({intent});
      const direct=await loadDailyOwnerConfig(f.expectedSha256,f.configPort,sig());
      if(stage==='config'){expect(direct,name).toEqual({state:'OFF',reason});continue;}
      expect(direct.state,name).toBe('READY');
      expect(await prepareDailyBinding(f.config,f.ports,sig()),name).toEqual({state:'UNAVAILABLE',reason});
    }
  });
  it('requires a valid Scope Policy block',async()=>{
    const cases:[string,string][]=[
      ['no policy section','# nothing\n'],
      ['invalid json',`## Justice S1-c Task Scope Policies\n<!-- justice:s1c-task-scope:begin -->\n{bad\n<!-- justice:s1c-task-scope:end -->\n`],
      ['wrong task revision',defaultPlanText().replace('"taskRef":{"artifactId":"task-1","revision":"R1"}','"taskRef":{"artifactId":"task-1","revision":"R2"}')],
      ['wrong scope',defaultPlanText().replace('"scopeKey":"scope-1"','"scopeKey":"scope-2"')],
      ['wrong plan ref',defaultPlanText().replace('"planRef":{"artifactId":"plan-1","revision":"R1"}','"planRef":{"artifactId":"plan-1","revision":"R2"}')],
      ['other task only',defaultPlanText().replace('"artifactId":"task-1"','"artifactId":"task-7"')],
    ];
    for(const [name,planText] of cases){
      const f=await makeDailyFixture({planText});
      const r=await prepareDailyBinding(f.config,f.ports,sig());
      expect(r,name).toEqual({state:'UNAVAILABLE',reason:'SCOPE_POLICY_INVALID'});
    }
  });
  it('is not READY when aborted at any boundary',async()=>{
    const f=await makeDailyFixture();
    const c0=new AbortController();c0.abort();
    expect(await prepareDailyBinding(f.config,f.ports,c0.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    const c1=new AbortController();
    const mid:DailyPreflightPorts={...f.ports,async checkCleanBase(){c1.abort();return {state:'OK'};}};
    expect(await prepareDailyBinding(f.config,mid,c1.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    const c2=new AbortController();
    const reading:DailyPreflightPorts={...f.ports,source:{
      readInputFile:async(p,m)=>{const r=await f.source.readInputFile(p,m);c2.abort();return r;},
      readArtifact:(r,p,m)=>f.source.readArtifact(r,p,m),
    }};
    expect(await prepareDailyBinding(f.config,reading,c2.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    const start=await prepareDailyBinding(f.config,f.ports,sig());
    if(start.state!=='READY')throw Error('expected binding');
    expect(await verifyDailyBinding(start.binding,f.ports,c0.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
  it('performs no source writes and uses only read methods',async()=>{
    const f=await makeDailyFixture();
    const spy={readInputFile:vi.fn(f.source.readInputFile),readArtifact:vi.fn(f.source.readArtifact)};
    const r=await prepareDailyBinding(f.config,{...f.ports,source:spy},sig());
    expect(r.state).toBe('READY');
    expect(Object.keys(spy).sort()).toEqual(['readArtifact','readInputFile']);
    for(const call of spy.readInputFile.mock.calls)expect(call[0]).toMatch(/^\/run\/justice-daily\/owner\/(manifest|intent)\.json$/);
    for(const call of spy.readArtifact.mock.calls)expect(call[0]).toBe('/run/justice-daily/owner/artifacts');
  });
});

describe('matchRuleInput',()=>{
  it('requires an exact shell input, not just the tool name',async()=>{
    const f=await makeDailyFixture();const r=f.approval.rules[0]!;
    expect(matchRuleInput(f.approval.rules,'shell',r.input)).toBe('r1');
    expect(matchRuleInput(f.approval.rules,'shell',{...r.input,command:'pwd'})).toBeNull();
    expect(matchRuleInput(f.approval.rules,'execute',r.input)).toBeNull();
  });
  it('rejects extra/missing keys and changed cwd, timeout, background',async()=>{
    const f=await makeDailyFixture();const r=f.approval.rules[1]!;
    expect(matchRuleInput(f.approval.rules,'shell',r.input)).toBe('r2');
    for(const bad of [
      {...r.input,extra:1},{...r.input,workdir:'/tmp'},{...r.input,timeout:5001},{...r.input,timeout:'5000'},
      {...r.input,background:true},{...r.input,background:undefined},{command:r.input.command,workdir:r.input.workdir,timeout:5000},
    ])expect(matchRuleInput(f.approval.rules,'shell',bad)).toBeNull();
    for(const bad of [null,undefined,'x',5,[],[r.input],Object.create({...r.input})])expect(matchRuleInput(f.approval.rules,'shell',bad)).toBeNull();
  });
  it('does not invoke getters or stringify payloads',async()=>{
    const f=await makeDailyFixture();const r=f.approval.rules[0]!;
    const getter=vi.fn(()=>r.input.command);
    const o={workdir:r.input.workdir,timeout:r.input.timeout,background:false} as Record<string,unknown>;
    Object.defineProperty(o,'command',{enumerable:true,get:getter});
    expect(matchRuleInput(f.approval.rules,'shell',o)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    const toStr=vi.fn(()=>'x');
    expect(matchRuleInput(f.approval.rules,'shell',{...r.input,command:{toString:toStr}})).toBeNull();
    expect(toStr).not.toHaveBeenCalled();
  });
});
