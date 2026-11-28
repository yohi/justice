import {createHash} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {prepareDailyBinding,type DailyBinding} from '../../src/runtime/daily-intent.js';
import {
  checkBeginPrefix,checkFinishBoundary,checkNoRunningShells,collectDailyNativeEvidence,createNativeReadPort,readNativeSnapshot,
  type NativeBytes,type NativeEpoch,type NativeObservation,type NativePageQuery,type NativeReadPort,type NativeSnapshot,
} from '../../src/runtime/daily-native-evidence.js';
import {validateS2bCorrelation,validateS2bSource} from '../../src/runtime/s2b-input.js';
import {projectS2bEvidence} from '../../src/runtime/s2b-projector.js';
import {makeDailyFixture,type DailyFixture} from '../helpers/daily-fixtures.js';
import {assistantMessage,buildSource,correlation,enc,linkedPages,pageResponse,sessionResponse,toolPart} from '../s2b/fixtures.js';

const sig=()=>new AbortController().signal;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const dec=(b:Uint8Array)=>new TextDecoder().decode(b);
const SID='ses_fixture001';
const ROOT='/tmp/justice-daily-fixture';
type Rec=Record<string,unknown>;
type Status='completed'|'running'|'error';

const ruleInput=(f:DailyFixture,id='r1'):Rec=>({...f.approval.rules.find(r=>r.ruleId===id)!.input});
function part(id:string,name:string,input:Rec,status:Status='completed',executed:boolean|null=false):Rec{
  const {type,time}=toolPart(id,status);
  const state=status==='completed'?{status,input,content:[{type:'text',text:'fixture'}]}
    :status==='running'?{status,input,metadata:{}}:{status,input,error:{type:'unknown',message:'x'}};
  return {type,id,name,state,time,...(executed===null?{}:{executed})};
}
const shell=(f:DailyFixture,id:string,rule='r1',status:Status='completed',executed:boolean|null=false)=>part(id,'shell',ruleInput(f,rule),status,executed);
const beginPart=(status:Status='completed')=>part('tool_begin','justice_task_begin',{},status,false);
const finishPart=()=>part('tool_finish','justice_task_finish',{},'running',false);
const obs=(messageId:string,callId:string,phase:'BEFORE'|'AFTER',ruleId:string|null,o:Partial<NativeObservation>={}):NativeObservation=>({
  sessionId:SID,messageId,callId,tool:'shell',phase,status:phase==='BEFORE'?'STARTED':'COMPLETED',ruleId,...o});
const pair=(messageId:string,callId:string,ruleId:string|null,o:Partial<NativeObservation>={})=>[obs(messageId,callId,'BEFORE',ruleId,o),obs(messageId,callId,'AFTER',ruleId,o)];
const finishObs=()=>obs('msg_003','tool_finish','BEFORE',null,{tool:'justice_task_finish'});

type CaseSpec={messages:unknown[];observations:NativeObservation[];prefix:string[];perPage?:number};
export type Variant=
  |'happy'|'different-command'|'nested-id-not-saved'|'two-matched-parts'|'different-workdir'|'different-timeout'
  |'background-true'|'extra-input-key'|'wrong-session'|'wrong-message'|'wrong-id'|'duplicate-identical-hook'
  |'distinct-duplicate-candidate'|'before-after-mismatch'|'after-tool-mismatch'|'source-name-mismatch'
  |'outer-execute'|'executed-true'|'executed-missing'|'saved-running'|'saved-error'|'missing-after'
  |'pre-begin-message'|'multi-page'|'unhooked-matching-part'|'metadata-running';

function spec(f:DailyFixture,variant:Variant):CaseSpec{
  const m1=assistantMessage('msg_001',[beginPart()]);
  const m3=assistantMessage('msg_003',[finishPart()]);
  const base=(active:Rec[],observations:NativeObservation[]):CaseSpec=>({
    messages:[m1,assistantMessage('msg_002',active),m3],observations:[...observations,finishObs()],prefix:['msg_001']});
  const happy=()=>base([shell(f,'tool_001')],pair('msg_002','tool_001','r1'));
  switch(variant){
  case 'happy':return happy();
  case 'multi-page':return {...happy(),perPage:1};
  case 'different-command':
    return base([part('tool_001','shell',{...ruleInput(f),command:'bun run vitest run tests/other.test.ts'})],pair('msg_002','tool_001',null));
  case 'nested-id-not-saved':
    return base([part('tool_001','execute',{code:'await shell()'})],
      [...pair('msg_002','tool_001',null,{tool:'execute'}),...pair('msg_002','tool_nested','r1')]);
  case 'two-matched-parts':
    return base([shell(f,'tool_001'),shell(f,'tool_002','r2')],[...pair('msg_002','tool_001','r1'),...pair('msg_002','tool_002','r2')]);
  case 'different-workdir':return base([part('tool_001','shell',{...ruleInput(f),workdir:'/tmp/other'})],pair('msg_002','tool_001','r1'));
  case 'different-timeout':return base([part('tool_001','shell',{...ruleInput(f),timeout:4999})],pair('msg_002','tool_001','r1'));
  case 'background-true':return base([part('tool_001','shell',{...ruleInput(f),background:true})],pair('msg_002','tool_001','r1'));
  case 'extra-input-key':return base([part('tool_001','shell',{...ruleInput(f),description:'x'})],pair('msg_002','tool_001','r1'));
  case 'wrong-session':return base([shell(f,'tool_001')],pair('msg_002','tool_001','r1',{sessionId:'ses_other001'}));
  case 'wrong-message':return base([shell(f,'tool_001')],pair('msg_009','tool_001','r1'));
  case 'wrong-id':return base([shell(f,'tool_001')],pair('msg_002','tool_009','r1'));
  case 'duplicate-identical-hook':return base([shell(f,'tool_001')],[...pair('msg_002','tool_001','r1'),...pair('msg_002','tool_001','r1')]);
  case 'distinct-duplicate-candidate':
    return base([shell(f,'tool_001'),shell(f,'tool_003')],[...pair('msg_002','tool_001','r1'),...pair('msg_002','tool_003','r1')]);
  case 'before-after-mismatch':
    return base([shell(f,'tool_001')],[obs('msg_002','tool_001','BEFORE','r1'),obs('msg_002','tool_001','AFTER',null)]);
  case 'after-tool-mismatch':
    return base([shell(f,'tool_001')],[obs('msg_002','tool_001','BEFORE','r1'),obs('msg_002','tool_001','AFTER','r1',{tool:'bash'})]);
  case 'source-name-mismatch':return base([part('tool_001','bash',ruleInput(f))],pair('msg_002','tool_001','r1'));
  case 'outer-execute':
    return base([part('tool_001','execute',ruleInput(f))],pair('msg_002','tool_001',null,{tool:'execute'}));
  case 'executed-true':return base([shell(f,'tool_001','r1','completed',true)],pair('msg_002','tool_001','r1'));
  case 'executed-missing':return base([shell(f,'tool_001','r1','completed',null)],pair('msg_002','tool_001','r1'));
  case 'saved-running':return base([shell(f,'tool_001','r1','running')],pair('msg_002','tool_001','r1'));
  case 'metadata-running':{
    const saved=shell(f,'tool_001');
    (saved.state as Rec).metadata={status:'running'};
    return base([saved],pair('msg_002','tool_001','r1'));
  }
  case 'saved-error':
    return base([shell(f,'tool_001','r1','error')],[obs('msg_002','tool_001','BEFORE','r1'),obs('msg_002','tool_001','AFTER','r1',{status:'ERROR'})]);
  case 'missing-after':return base([shell(f,'tool_001')],[obs('msg_002','tool_001','BEFORE','r1')]);
  case 'unhooked-matching-part':return base([shell(f,'tool_001')],[]);
  case 'pre-begin-message':
    return {messages:[assistantMessage('msg_000',[shell(f,'tool_001')]),m1,assistantMessage('msg_002',[]),m3],
      observations:[...pair('msg_000','tool_001','r1'),finishObs()],prefix:['msg_000','msg_001']};
  }
}

type Call=Readonly<{op:string;sessionId?:string;query?:NativePageQuery;root?:string}>;
type FakeOpts={sessions?:string[];pages?:Map<string,string|NativeBytes>;shells?:string};
function fakePort(o:FakeOpts){
  const calls:Call[]=[];
  const sessions=o.sessions??[sessionResponse({location:{directory:ROOT}})];
  let si=0;
  const ok=(t:string):NativeBytes=>({state:'OK',bytes:enc(t)});
  const port:NativeReadPort={
    async getSession(sessionId){calls.push({op:'session',sessionId});return ok(sessions[Math.min(si++,sessions.length-1)]!);},
    async getMessages(sessionId,query){
      calls.push({op:'messages',sessionId,query});
      const v=o.pages?.get('order' in query?'<first>':query.cursor);
      if(v===undefined)return {state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'};
      return typeof v==='string'?ok(v):v;
    },
    async getRunningShells(root){calls.push({op:'shells',root});return ok(o.shells??JSON.stringify({location:{directory:ROOT},data:[]}));},
  };
  return {port,calls};
}
function pagesFor(messages:unknown[],perPage=100):Map<string,string>{
  const map=new Map<string,string>();
  linkedPages(messages,perPage,100).forEach((p,i)=>map.set(i===0?'<first>':String((p.request as Rec).cursor),p.response));
  return map;
}
async function readyBinding(f:DailyFixture):Promise<DailyBinding>{
  const r=await prepareDailyBinding(f.config,f.ports,sig());
  if(r.state!=='READY')throw Error(`binding not ready: ${r.reason}`);
  return r.binding;
}
const cid=(b:DailyBinding,s:string)=>`daily-${b.key.slice(0,16)}-${s}`;
async function snapshotOf(binding:DailyBinding,messages:unknown[],perPage=100,suffix='end-a'):Promise<NativeSnapshot>{
  const {port}=fakePort({pages:pagesFor(messages,perPage)});
  const r=await readNativeSnapshot(binding,port,cid(binding,suffix),sig());
  if(r.state!=='READY')throw Error(`snapshot not ready: ${JSON.stringify(r)}`);
  return r.snapshot;
}
/** Builds {binding,snapshot,epoch} through the real snapshot path over a v2.3.2 raw wrapper. */
async function nativeCase(f:DailyFixture,variant:Variant){
  const s=spec(f,variant);
  const binding=await readyBinding(f);
  const snapshot=await snapshotOf(binding,s.messages,s.perPage);
  const epoch:NativeEpoch={begin:{sessionId:SID,messageId:'msg_001',callId:'tool_begin'},finish:{sessionId:SID,messageId:'msg_003',callId:'tool_finish'},
    prefixMessageIds:s.prefix,observations:s.observations};
  return {binding,snapshot,epoch,spec:s};
}
const bindingsOf=(r:{correlationBytes:Uint8Array})=>(JSON.parse(dec(r.correlationBytes)) as Rec).messageBindings;
const ac=(id:string)=>({artifactId:id,revision:'R1'});

describe('daily native evidence: correlation',()=>{
  it("does not attribute another command or a nested call to an AC", async () => {
    const f = await makeDailyFixture();
    const c = await nativeCase(f, "different-command");
    const result = collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
    expect(result.state).toBe("VALID");
    if (result.state !== "VALID") throw Error("expected limited projection input");
    expect(result.limited).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(result.correlationBytes)).messageBindings).toEqual([]);
    const n = await nativeCase(f,"nested-id-not-saved");
    const other = collectDailyNativeEvidence(n.binding,n.snapshot,n.epoch);
    expect(other.state).toBe("VALID");
    if (other.state !== "VALID") throw Error("expected limited input");
    expect(JSON.parse(new TextDecoder().decode(other.correlationBytes)).messageBindings).toEqual([]);
    expect(other.reasons).toEqual(['IDENTITY_UNMATCHED','RULE_UNMATCHED']);
    expect(result.reasons).toEqual(['RULE_UNMATCHED']);
  });
  it("groups distinct matched shell calls in one assistant message", async () => {
    const c = await nativeCase(await makeDailyFixture(),"two-matched-parts");
    const result = collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
    expect(result.state).toBe("VALID");
    if (result.state !== "VALID") throw Error("expected valid");
    expect(JSON.parse(new TextDecoder().decode(result.correlationBytes)).messageBindings)
      .toEqual([{messageId:"msg_002",taskRef:{artifactId:"task-1",revision:"R1"},scopeKey:"scope-1",tools:[
        {toolId:"tool_001",acRef:{artifactId:"ac-1",revision:"R1"}},
        {toolId:"tool_002",acRef:{artifactId:"ac-2",revision:"R1"}}]}]);
    expect(result.limited).toBe(false);
    expect(result.reasons).toEqual([]);
  });
  it('binds the exact tuple happy path to the public Correlation schema with fixed digests',async()=>{
    const c=await nativeCase(await makeDailyFixture(),'happy');
    const r=collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
    if(r.state!=='VALID')throw Error(`expected VALID, got ${JSON.stringify(r)}`);
    expect(JSON.parse(dec(r.correlationBytes))).toEqual(correlation([{messageId:'msg_002',tools:[{toolId:'tool_001',acRef:ac('ac-1')}]}],SID));
    expect(r.bindingKey).toBe(c.binding.key);
    expect(r.sourceSha256).toBe(sha(r.rawWrapper));
    expect(r.correlationSha256).toBe(sha(r.correlationBytes));
    expect(dec(r.rawWrapper)).toBe(dec(c.snapshot.rawWrapper));
    expect(r.rawWrapper).not.toBe(c.snapshot.rawWrapper);
    expect(r.limited).toBe(true);
    expect(r.reasons).toEqual(['RULE_UNMATCHED']);
    // Existing projector keeps the legacy local-part labels (UNKNOWN), never EXECUTED.
    const src=validateS2bSource(r.rawWrapper),corr=validateS2bCorrelation(r.correlationBytes);
    if(src.state!=='ACCEPTED'||corr.state!=='ACCEPTED')throw Error('expected accepted inputs');
    const p=projectS2bEvidence(src.value,corr,c.binding.intent);
    expect(p.evidenceRefs.map(e=>[e.acRef.artifactId,e.reportedExecutionState,e.reportedOutcome])).toEqual([['ac-1','UNKNOWN','UNKNOWN']]);
  });
  const none:readonly [Variant,readonly string[]][]=[
    ['different-workdir',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['different-timeout',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['background-true',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['extra-input-key',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['wrong-session',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['wrong-message',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['wrong-id',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['distinct-duplicate-candidate',['RULE_AMBIGUOUS','RULE_UNMATCHED']],
    ['before-after-mismatch',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['after-tool-mismatch',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['source-name-mismatch',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['outer-execute',['RULE_UNMATCHED']],
    ['executed-true',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['executed-missing',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['saved-running',['TOOL_NOT_COMPLETED','RULE_UNMATCHED']],
    ['metadata-running',['TOOL_NOT_COMPLETED','RULE_UNMATCHED']],
    ['saved-error',['TOOL_NOT_COMPLETED','RULE_UNMATCHED']],
    ['missing-after',['TOOL_NOT_COMPLETED','RULE_UNMATCHED']],
    ['pre-begin-message',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
    ['unhooked-matching-part',['IDENTITY_UNMATCHED','RULE_UNMATCHED']],
  ];
  it.each(none)('does not attribute %s and reports a fixed reason',async(variant,reasons)=>{
    const c=await nativeCase(await makeDailyFixture(),variant);
    const r=collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
    if(r.state!=='VALID')throw Error(`expected VALID, got ${JSON.stringify(r)}`);
    expect(bindingsOf(r)).toEqual([]);
    expect(r.limited).toBe(true);
    expect(r.reasons).toEqual(reasons);
  });
  it.each(['duplicate-identical-hook','multi-page'] as const)('%s still binds r1 exactly once',async variant=>{
    const c=await nativeCase(await makeDailyFixture(),variant);
    const r=collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
    if(r.state!=='VALID')throw Error(`expected VALID, got ${JSON.stringify(r)}`);
    expect(bindingsOf(r)).toEqual(correlation([{messageId:'msg_002',tools:[{toolId:'tool_001',acRef:ac('ac-1')}]}]).messageBindings);
    expect(r.reasons).toEqual(['RULE_UNMATCHED']);
  });
  it('sorts bindings across messages by UTF-8 message id',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const messages=[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_b',[shell(f,'tool_x','r2')]),
      assistantMessage('msg_a',[shell(f,'tool_y','r1')]),assistantMessage('msg_003',[finishPart()])];
    const snapshot=await snapshotOf(b,messages);
    const epoch:NativeEpoch={begin:{sessionId:SID,messageId:'msg_001',callId:'tool_begin'},finish:{sessionId:SID,messageId:'msg_003',callId:'tool_finish'},
      prefixMessageIds:['msg_001'],observations:[...pair('msg_b','tool_x','r2'),...pair('msg_a','tool_y','r1')]};
    const r=collectDailyNativeEvidence(b,snapshot,epoch);
    if(r.state!=='VALID')throw Error(`expected VALID, got ${JSON.stringify(r)}`);
    expect(bindingsOf(r)).toEqual(correlation([{messageId:'msg_a',tools:[{toolId:'tool_y',acRef:ac('ac-1')}]},{messageId:'msg_b',tools:[{toolId:'tool_x',acRef:ac('ac-2')}]}]).messageBindings);
    expect(r.limited).toBe(false);
  });
  it('rejects a snapshot whose raw Source no longer validates',async()=>{
    const c=await nativeCase(await makeDailyFixture(),'happy');
    const bad={...c.snapshot,rawWrapper:enc(buildSource({hostVersion:'9.9.9'}))};
    expect(collectDailyNativeEvidence(c.binding,bad,c.epoch)).toEqual({state:'REJECTED',reasons:['SOURCE_REJECTED'],diagnostics:[{code:'SOURCE_VERSION_UNSUPPORTED',count:1}]});
    const throwing={...c.snapshot,get rawWrapper():Uint8Array{throw new Error('private fixture detail');}};
    expect(collectDailyNativeEvidence(c.binding,throwing,c.epoch))
      .toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
  });
  it('rejects invalid binding and mismatched session identity before correlating',async()=>{
    const c=await nativeCase(await makeDailyFixture(),'happy');
    expect(collectDailyNativeEvidence(
      {...c.binding,config:{...c.binding.config,approvalSha256:'0'.repeat(64)}},
      c.snapshot,c.epoch,
    )).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
    const mismatches=[
      [{...c.snapshot,sessionId:'ses_other001'},c.epoch],
      [{...c.snapshot,worktreeRoot:'/tmp/other'},c.epoch],
      [c.snapshot,{...c.epoch,begin:{...c.epoch.begin,sessionId:'ses_other001'}}],
      [c.snapshot,{...c.epoch,finish:{...c.epoch.finish,sessionId:'ses_other001'}}],
    ] as const;
    for(const [snapshot,epoch] of mismatches){
      expect(collectDailyNativeEvidence(c.binding,snapshot,epoch))
        .toEqual({state:'UNAVAILABLE',reason:'SESSION_MISMATCH'});
    }
  });
  it.each([
    ['empty prefix',[]],
    ['prefix longer than source',['msg_001','msg_002','msg_003','msg_004']],
    ['prefix drift',['msg_000']],
  ])('refuses collection with %s',async(_name,prefixMessageIds)=>{
    const c=await nativeCase(await makeDailyFixture(),'happy');
    expect(collectDailyNativeEvidence(c.binding,c.snapshot,{...c.epoch,prefixMessageIds}))
      .toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it('refuses a prefix whose final message is not the begin control message',async()=>{
    const c=await nativeCase(await makeDailyFixture(),'happy');
    expect(collectDailyNativeEvidence(c.binding,c.snapshot,{
      ...c.epoch,prefixMessageIds:['msg_001','msg_002'],
    })).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it.each([
    ['finish is absent from a complete source',async(f:DailyFixture)=>{
      const binding=await readyBinding(f);
      const snapshot=await snapshotOf(binding,[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_002',[])]);
      return {binding,snapshot,finishMessageId:'msg_003'};
    }],
    ['finish is at the begin boundary',async(f:DailyFixture)=>{
      const binding=await readyBinding(f);
      const snapshot=await snapshotOf(binding,[assistantMessage('msg_001',[beginPart()])]);
      return {binding,snapshot,finishMessageId:'msg_001'};
    }],
  ])('refuses when %s',async(_name,build)=>{
    const f=await makeDailyFixture();
    const {binding,snapshot,finishMessageId}=await build(f);
    const c=await nativeCase(f,'happy');
    const epoch={...c.epoch,finish:{...c.epoch.finish,messageId:finishMessageId}};
    expect(collectDailyNativeEvidence(binding,snapshot,epoch))
      .toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it('records unknown hook rule IDs without attributing evidence',async()=>{
    const c=await nativeCase(await makeDailyFixture(),'happy');
    const unknown=pair('msg_002','tool_001','unknown-rule');
    const r=collectDailyNativeEvidence(c.binding,c.snapshot,{...c.epoch,observations:[...unknown,finishObs()]});
    if(r.state!=='VALID')throw Error(`expected VALID, got ${JSON.stringify(r)}`);
    expect(r.reasons).toEqual(['IDENTITY_UNMATCHED','RULE_UNMATCHED']);
    expect(bindingsOf(r)).toEqual([]);
  });
  it('returns limited VALID for an incomplete accepted Source',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const s=spec(f,'happy');
    const pages=pagesFor(s.messages,1);pages.delete('cur-2');
    const {port}=fakePort({pages});
    const snap=await readNativeSnapshot(b,port,cid(b,'end-a'),sig());
    if(snap.state!=='READY')throw Error('expected READY');
    expect(snap.snapshot.validated.collectionStatus).toBe('PAGINATION_INCOMPLETE');
    const epoch:NativeEpoch={begin:{sessionId:SID,messageId:'msg_001',callId:'tool_begin'},finish:{sessionId:SID,messageId:'msg_003',callId:'tool_finish'},prefixMessageIds:['msg_001'],observations:s.observations};
    const r=collectDailyNativeEvidence(b,snap.snapshot,epoch);
    if(r.state!=='VALID')throw Error(`expected VALID, got ${JSON.stringify(r)}`);
    expect(r.limited).toBe(true);
    expect(r.reasons).toEqual(['SOURCE_INCOMPLETE','RULE_UNMATCHED']);
    expect(bindingsOf(r)).toEqual(correlation([{messageId:'msg_002',tools:[{toolId:'tool_001',acRef:ac('ac-1')}]}]).messageBindings);
  });
  it('never emits raw payload text in reasons, diagnostics or correlation',async()=>{
    const f=await makeDailyFixture();
    for(const v of ['happy','different-command','saved-error','nested-id-not-saved'] as const){
      const c=await nativeCase(f,v);
      const r=collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
      if(r.state!=='VALID')throw Error('expected VALID');
      const visible=[...r.reasons,dec(r.correlationBytes)].join('\n');
      for(const secret of ['vitest','fixture"','await shell',ROOT,'"x"'])expect(visible).not.toContain(secret);
    }
  });
});

describe('daily native evidence: snapshot acquisition',()=>{
  it('reads session, pages and sessionAfter by exact queries and embeds raw responses verbatim',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const s=spec(f,'happy');
    const raw=` { "data" : ${JSON.stringify(s.messages)} , "cursor" : {} } `;
    const {port,calls}=fakePort({pages:new Map([['<first>',raw]])});
    const r=await readNativeSnapshot(b,port,cid(b,'begin'),sig());
    if(r.state!=='READY')throw Error(`expected READY, got ${JSON.stringify(r)}`);
    expect(calls).toEqual([{op:'session',sessionId:SID},{op:'messages',sessionId:SID,query:{order:'asc',limit:100}},{op:'session',sessionId:SID}]);
    const wrapper=dec(r.snapshot.rawWrapper);
    expect(wrapper).toContain(raw.trim());
    const w=JSON.parse(wrapper) as Rec;
    expect(Object.keys(w)).toEqual(['schemaVersion','collectionId','hostVersion','sessionId','session','sessionAfter','messagePages','diff']);
    expect(w).toMatchObject({schemaVersion:'justice-s2b-source-v1',collectionId:cid(b,'begin'),hostVersion:'2.3.2',sessionId:SID,diff:null});
    const pages=w.messagePages as Rec[];
    expect(pages.map(p=>[p.pageIndex,p.request])).toEqual([[0,{sessionId:SID,order:'asc',limit:100}]]);
    expect(Number.isNaN(Date.parse(String(pages[0]!.collectedAt)))).toBe(false);
    expect(r.snapshot.validated.collectionStatus).toBe('PAGINATION_COMPLETE');
    expect(r.snapshot.validated.messages.map(m=>m.id)).toEqual(['msg_001','msg_002','msg_003']);
    expect(r.snapshot.sessionId).toBe(SID);expect(r.snapshot.worktreeRoot).toBe(ROOT);
    const body=enc(raw);const len=new Uint8Array(4);new DataView(len.buffer).setUint32(0,body.byteLength,false);
    expect(r.snapshot.pageDigest).toBe(createHash('sha256').update(len).update(body).digest('hex'));
  });
  it('follows opaque cursors in order and frames every page in the digest',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const s=spec(f,'happy');const pages=pagesFor(s.messages,1);
    const {port,calls}=fakePort({pages});
    const r=await readNativeSnapshot(b,port,cid(b,'end-a'),sig());
    if(r.state!=='READY')throw Error('expected READY');
    expect(calls.filter(c=>c.op==='messages').map(c=>c.query)).toEqual([{order:'asc',limit:100},{cursor:'cur-1',limit:100},{cursor:'cur-2',limit:100}]);
    const reqs=(JSON.parse(dec(r.snapshot.rawWrapper)).messagePages as Rec[]).map(p=>p.request);
    expect(reqs).toEqual([{sessionId:SID,order:'asc',limit:100},{sessionId:SID,cursor:'cur-1',limit:100},{sessionId:SID,cursor:'cur-2',limit:100}]);
    const h=createHash('sha256');
    for(const k of ['<first>','cur-1','cur-2']){const body=enc(pages.get(k)!);const l=new Uint8Array(4);new DataView(l.buffer).setUint32(0,body.byteLength,false);h.update(l).update(body);}
    expect(r.snapshot.pageDigest).toBe(h.digest('hex'));
  });
  it('never re-requests a looping cursor and leaves the collection incomplete',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const m=spec(f,'happy').messages;
    const {port,calls}=fakePort({pages:new Map([['<first>',pageResponse([m[0]],'cur-1')],['cur-1',pageResponse([m[1]],'cur-1')]])});
    const r=await readNativeSnapshot(b,port,cid(b,'end-a'),sig());
    if(r.state!=='READY')throw Error('expected READY');
    expect(calls.filter(c=>c.op==='messages')).toHaveLength(2);
    expect(r.snapshot.validated.collectionStatus).toBe('PAGINATION_INCOMPLETE');
  });
  it('caps collection at 64 pages',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const msgs=Array.from({length:70},(_,i)=>assistantMessage(`msg_${String(i).padStart(3,'0')}`,[]));
    const {port,calls}=fakePort({pages:pagesFor(msgs,1)});
    const r=await readNativeSnapshot(b,port,cid(b,'end-a'),sig());
    if(r.state!=='READY')throw Error('expected READY');
    expect(calls.filter(c=>c.op==='messages')).toHaveLength(64);
    expect(r.snapshot.validated.validatedPageCount).toBe(64);
    expect(r.snapshot.validated.collectionStatus).toBe('PAGINATION_INCOMPLETE');
  });
  it('maps first-page failures and keeps later-page failures as incomplete',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const s=spec(f,'happy');
    const missing=fakePort({pages:new Map()});
    expect(await readNativeSnapshot(b,missing.port,cid(b,'end-a'),sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
    const over=fakePort({pages:new Map([['<first>',{state:'OK',bytes:new Uint8Array(4_194_305)} as NativeBytes]])});
    expect(await readNativeSnapshot(b,over.port,cid(b,'end-a'),sig())).toEqual({state:'UNAVAILABLE',reason:'OBSERVATION_LIMIT'});
    const malformed=fakePort({pages:new Map([['<first>','{"data":[],"cursor":{}} ,"x":1']])});
    expect(await readNativeSnapshot(b,malformed.port,cid(b,'end-a'),sig())).toEqual({state:'REJECTED',reasons:['SOURCE_REJECTED'],diagnostics:[{code:'SOURCE_SCHEMA_INVALID',count:1}]});
    const pages=pagesFor(s.messages,1);pages.set('cur-1',JSON.stringify({data:'nope',cursor:{}}));
    const later=fakePort({pages});
    const r=await readNativeSnapshot(b,later.port,cid(b,'end-a'),sig());
    if(r.state!=='READY')throw Error('expected READY');
    expect(r.snapshot.validated.collectionStatus).toBe('PAGINATION_INCOMPLETE');
    expect(r.snapshot.validated.validatedPageCount).toBe(1);
    expect(later.calls.filter(c=>c.op==='messages')).toHaveLength(2);
  });
  it('keeps a valid page prefix when a later page exceeds the collection cap',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const messages=spec(f,'happy').messages;
    const pages=pagesFor(messages,1);
    const {port}=fakePort({pages});
    const oversized:NativeReadPort={...port,getMessages:async(sessionId,query,signal)=>{
      if('cursor' in query&&query.cursor==='cur-2'){
        return {state:'OK',bytes:new Uint8Array(4_194_305)};
      }
      return port.getMessages(sessionId,query,signal);
    }};
    const result=await readNativeSnapshot(b,oversized,cid(b,'end-a'),sig());
    expect(result.state).toBe('READY');
    if(result.state==='READY')expect(result.snapshot.validated.collectionStatus).toBe('PAGINATION_INCOMPLETE');
  });
  it('keeps a valid page prefix when encoding a later cursor throws URIError',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const messages=spec(f,'happy').messages;
    const pages=pagesFor(messages,1);
    const {port,calls}=fakePort({pages});
    const nativePort=createNativeReadPort(f.config);
    const unavailableOnCursor:NativeReadPort={...port,getMessages:async(sessionId,query,signal)=>{
      if('cursor' in query)return nativePort.getMessages(sessionId,{cursor:'\uD800',limit:100},signal);
      return port.getMessages(sessionId,query,signal);
    }};
    const result=await readNativeSnapshot(b,unavailableOnCursor,cid(b,'end-a'),sig());
    expect(result.state).toBe('READY');
    if(result.state==='READY')expect(result.snapshot.validated.collectionStatus).toBe('PAGINATION_INCOMPLETE');
    expect(calls.filter(c=>c.op==='messages')).toHaveLength(1);
    expect(await nativePort.getMessages(SID,{cursor:'\uD800',limit:100},sig()))
      .toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
  });
  it('maps session read failures, exceptions, and in-flight aborts to fixed results',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const noSession:NativeReadPort={...fakePort({}).port,
      async getSession(){return {state:'UNAVAILABLE',reason:'TIMEOUT'};}};
    expect(await readNativeSnapshot(b,noSession,cid(b,'end-a'),sig()))
      .toEqual({state:'UNAVAILABLE',reason:'TIMEOUT'});

    const throwing:NativeReadPort={...fakePort({}).port,
      async getSession(){throw new Error('private fixture detail');}};
    expect(await readNativeSnapshot(b,throwing,cid(b,'end-a'),sig()))
      .toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});

    const ctl=new AbortController();
    const aborting:NativeReadPort={...fakePort({}).port,
      async getSession(){ctl.abort();return {state:'UNAVAILABLE',reason:'ABORTED'};}};
    expect(await readNativeSnapshot(b,aborting,cid(b,'end-a'),ctl.signal))
      .toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
  it('rejects oversized or malformed session responses before reading messages',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const pages=pagesFor(spec(f,'happy').messages);
    const oversized=fakePort({sessions:[JSON.stringify({data:{id:SID,location:{directory:ROOT}}})],pages});
    const oversizedPort:NativeReadPort={...oversized.port,
      async getSession(){return {state:'OK',bytes:new Uint8Array(1_048_577)};}};
    expect(await readNativeSnapshot(b,oversizedPort,cid(b,'end-a'),sig()))
      .toEqual({state:'UNAVAILABLE',reason:'OBSERVATION_LIMIT'});

    const malformed=fakePort({sessions:['{"data":[]}'],pages});
    expect(await readNativeSnapshot(b,malformed.port,cid(b,'end-a'),sig()))
      .toEqual({state:'REJECTED',reasons:['SOURCE_REJECTED'],diagnostics:[{code:'SOURCE_SCHEMA_INVALID',count:1}]});
  });
  it('rejects a raw wrapper the existing validator does not accept',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const dup=fakePort({pages:new Map([['<first>',pageResponse([assistantMessage('msg_001',[]),assistantMessage('msg_001',[])])]])});
    expect(await readNativeSnapshot(b,dup.port,cid(b,'end-a'),sig())).toEqual({state:'REJECTED',reasons:['SOURCE_REJECTED'],diagnostics:[{code:'CONFLICT',count:1}]});
  });
  it.each([
    ['other session',sessionResponse({id:'ses_other001',location:{directory:ROOT}}),'SESSION_MISMATCH'],
    ['parent session',sessionResponse({parentID:'ses_parent01',location:{directory:ROOT}}),'SESSION_MISMATCH'],
    ['fork',sessionResponse({fork:{},location:{directory:ROOT}}),'SESSION_MISMATCH'],
    ['other workspace',sessionResponse({location:{directory:'/tmp/other'}}),'WORKSPACE_MISMATCH'],
    ['no directory',sessionResponse(),'WORKSPACE_MISMATCH'],
  ])('refuses %s at start and after collection',async(_n,bad,reason)=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const pages=pagesFor(spec(f,'happy').messages);
    const start=fakePort({sessions:[bad],pages});
    expect(await readNativeSnapshot(b,start.port,cid(b,'end-a'),sig())).toEqual({state:'UNAVAILABLE',reason});
    expect(start.calls).toHaveLength(1);
    const after=fakePort({sessions:[sessionResponse({location:{directory:ROOT}}),bad],pages});
    expect(await readNativeSnapshot(b,after.port,cid(b,'end-a'),sig())).toEqual({state:'UNAVAILABLE',reason});
  });
  it('accepts only the fixed collectionId forms bound to the binding key',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const pages=pagesFor(spec(f,'happy').messages);
    for(const s of ['begin','end-a','end-b'])expect((await readNativeSnapshot(b,fakePort({pages}).port,cid(b,s),sig())).state).toBe('READY');
    for(const bad of [cid(b,'end-c'),'collection-001',`daily-${'0'.repeat(16)}-begin`,`${cid(b,'begin')}x`]){
      const {port,calls}=fakePort({pages});
      expect(await readNativeSnapshot(b,port,bad,sig())).toEqual({state:'UNAVAILABLE',reason:'BINDING_INVALID'});
      expect(calls).toEqual([]);
    }
  });
  it('does no I/O when already aborted and maps the 30s collection deadline to TIMEOUT',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const {port,calls}=fakePort({});
    const ctl=new AbortController();ctl.abort();
    expect(await readNativeSnapshot(b,port,cid(b,'end-a'),ctl.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    expect(calls).toEqual([]);
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    try{
      let seen:AbortSignal|undefined;
      const hang:NativeReadPort={...port,getSession:(_s,signal)=>{seen=signal;return new Promise(res=>signal.addEventListener('abort',()=>res({state:'UNAVAILABLE',reason:'ABORTED'})));}};
      const p=readNativeSnapshot(b,hang,cid(b,'end-a'),sig());
      await vi.advanceTimersByTimeAsync(29_999);
      expect(seen?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).toEqual({state:'UNAVAILABLE',reason:'TIMEOUT'});
    }finally{vi.useRealTimers();}
  });
  it('checks the monotonic collection deadline before synchronous source validation',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const {port}=fakePort({pages:pagesFor(spec(f,'happy').messages)});
    const now=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValue(30_001);
    try{
      expect(await readNativeSnapshot(b,port,cid(b,'end-a'),sig()))
        .toEqual({state:'UNAVAILABLE',reason:'TIMEOUT'});
    }finally{now.mockRestore();}
  });
});

describe('daily native evidence: boundary',()=>{
  const beginEpochIdentity={sessionId:SID,messageId:'msg_001',callId:'tool_begin'};
  it('captures the pre-begin prefix including the begin message',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const setup=assistantMessage('msg_000',[part('tool_skill','skill',{name:'executing-plans'})]);
    const snap=await snapshotOf(b,[setup,assistantMessage('msg_001',[beginPart('running')])],100,'begin');
    expect(checkBeginPrefix(snap,beginEpochIdentity)).toEqual({state:'READY',prefixMessageIds:['msg_000','msg_001']});
  });
  it.each([
    ['missing begin',(f:DailyFixture)=>[assistantMessage('msg_000',[shell(f,'tool_001')])]],
    ['wrong begin call id',()=>[assistantMessage('msg_001',[part('tool_other','justice_task_begin',{},'running')])]],
    ['wrong begin name',()=>[assistantMessage('msg_001',[part('tool_begin','shell',{},'running')])]],
    ['extra tool in begin message',(f:DailyFixture)=>[assistantMessage('msg_001',[beginPart('running'),shell(f,'tool_001')])]],
    ['running prior tool',(f:DailyFixture)=>[assistantMessage('msg_000',[shell(f,'tool_001','r1','running')]),assistantMessage('msg_001',[beginPart('running')])]],
    ['prior child task',()=>[assistantMessage('msg_000',[part('tool_t','task',{prompt:'p'})]),assistantMessage('msg_001',[beginPart('running')])]],
    ['prior task begin',()=>[assistantMessage('msg_000',[part('tool_old','justice_task_begin',{})]),assistantMessage('msg_001',[beginPart('running')])]],
    ['location switch',()=>[{id:'msg_000',type:'location-switched',location:{directory:'/tmp/x'},time:{created:1}},assistantMessage('msg_001',[beginPart('running')])]],
    ['message after begin',()=>[assistantMessage('msg_001',[beginPart('running')]),assistantMessage('msg_002',[])]],
  ])('refuses begin prefix with %s',async(_n,build)=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const snap=await snapshotOf(b,build(f),100,'begin');
    expect(checkBeginPrefix(snap,beginEpochIdentity)).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it('refuses begin prefix from an incomplete Source',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const pages=pagesFor([assistantMessage('msg_000',[]),assistantMessage('msg_001',[beginPart('running')])],1);pages.delete('cur-1');
    const {port}=fakePort({pages});
    const r=await readNativeSnapshot(b,port,cid(b,'begin'),sig());
    if(r.state!=='READY')throw Error('expected READY');
    expect(checkBeginPrefix(r.snapshot,beginEpochIdentity)).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it('refuses a running metadata status even when the shell input says background false',async()=>{
    const f=await makeDailyFixture();
    const c=await nativeCase(f,'happy');
    const saved=shell(f,'tool_001');
    (saved.state as Rec).metadata={status:'running'};
    const running=assistantMessage('msg_002',[saved]);
    const a=await snapshotOf(c.binding,[c.spec.messages[0],running,c.spec.messages[2]],100,'end-a');
    const b=await snapshotOf(c.binding,[c.spec.messages[0],running,c.spec.messages[2]],100,'end-b');
    expect(checkFinishBoundary(a,b,c.epoch)).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it('treats a saved subagent part in the epoch as an uncertain finish boundary',async()=>{
    const f=await makeDailyFixture();const c=await nativeCase(f,'happy');
    const messages=[c.spec.messages[0],assistantMessage('msg_002',[part('tool_subagent','subagent',{description:'delegation'})]),c.spec.messages[2]];
    const a=await snapshotOf(c.binding,messages,100,'end-a');
    const b=await snapshotOf(c.binding,messages,100,'end-b');
    expect(checkFinishBoundary(a,b,c.epoch)).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it('accepts identical A/B snapshots with preserved prefix and a single running finish',async()=>{
    const c=await nativeCase(await makeDailyFixture(),'happy');
    const b2=await snapshotOf(c.binding,c.spec.messages,100,'end-b');
    expect(checkFinishBoundary(c.snapshot,b2,c.epoch)).toEqual({state:'BOUNDED'});
  });
  const finishCases:readonly [string,(f:DailyFixture)=>unknown[]][]=[
    ['missing finish',f=>[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_002',[shell(f,'tool_001')])]],
    ['extra tool in finish message',f=>[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_003',[finishPart(),shell(f,'tool_001')])]],
    ['running other tool',f=>[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_002',[shell(f,'tool_001','r1','running')]),assistantMessage('msg_003',[finishPart()])]],
    ['begin not completed',()=>[assistantMessage('msg_001',[beginPart('running')]),assistantMessage('msg_003',[finishPart()])]],
    ['message after finish',()=>[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_003',[finishPart()]),assistantMessage('msg_004',[])]],
    ['compaction in epoch',()=>[assistantMessage('msg_001',[beginPart()]),{id:'msg_002',type:'compaction',status:'completed',reason:'auto',summary:'s',time:{created:1}},assistantMessage('msg_003',[finishPart()])]],
    ['child task in epoch',()=>[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_002',[part('tool_t','task',{prompt:'p'})]),assistantMessage('msg_003',[finishPart()])]],
    ['duplicate tool part id',f=>[assistantMessage('msg_001',[beginPart()]),assistantMessage('msg_002',[shell(f,'tool_001')]),assistantMessage('msg_005',[shell(f,'tool_001')]),assistantMessage('msg_003',[finishPart()])]],
  ];
  it.each(finishCases)('refuses finish boundary with %s',async(_n,build)=>{
    const f=await makeDailyFixture();const c=await nativeCase(f,'happy');
    const a=await snapshotOf(c.binding,build(f),100,'end-a');
    const b2=await snapshotOf(c.binding,build(f),100,'end-b');
    expect(checkFinishBoundary(a,b2,c.epoch)).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
  });
  it('refuses prefix drift, pageDigest mismatch and foreign observations',async()=>{
    const f=await makeDailyFixture();const c=await nativeCase(f,'happy');
    const U={state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'};
    expect(checkFinishBoundary(c.snapshot,c.snapshot,{...c.epoch,prefixMessageIds:['msg_000','msg_001']})).toEqual(U);
    expect(checkFinishBoundary(c.snapshot,c.snapshot,{...c.epoch,prefixMessageIds:[]})).toEqual(U);
    const grown=await snapshotOf(c.binding,[...c.spec.messages.slice(0,2),assistantMessage('msg_00x',[]),c.spec.messages[2]],100,'end-b');
    expect(checkFinishBoundary(c.snapshot,grown,c.epoch)).toEqual(U);
    expect(checkFinishBoundary(c.snapshot,{...c.snapshot,pageDigest:'0'.repeat(64)},c.epoch)).toEqual(U);
    expect(checkFinishBoundary(c.snapshot,c.snapshot,{...c.epoch,observations:[...c.epoch.observations,...pair('msg_002','tool_z',null,{sessionId:'ses_other001'})]})).toEqual(U);
    expect(checkFinishBoundary(c.snapshot,c.snapshot,{...c.epoch,finish:{...c.epoch.finish,callId:'tool_other'}})).toEqual(U);
    expect(checkFinishBoundary(c.snapshot,c.snapshot,{
      ...c.epoch,finish:{...c.epoch.finish,sessionId:'ses_other001'},
    })).toEqual(U);
    const differentIds={...c.snapshot,validated:{
      ...c.snapshot.validated,
      messages:[assistantMessage('msg_010',[beginPart()]),...c.snapshot.validated.messages.slice(1)],
    }};
    expect(checkFinishBoundary(c.snapshot,differentIds,c.epoch)).toEqual(U);
  });
  it('requires an empty running-shell list for the fixed root',async()=>{
    const f=await makeDailyFixture();const b=await readyBinding(f);
    const okPort=fakePort({});
    expect(await checkNoRunningShells(b,okPort.port,sig())).toEqual({state:'OK'});
    expect(okPort.calls).toEqual([{op:'shells',root:ROOT}]);
    const cases:[string,string][]=[
      [JSON.stringify({location:{directory:ROOT},data:[{id:'sh_1',status:'running'}]}),'TOOL_IN_FLIGHT'],
      [JSON.stringify({location:{directory:'/tmp/other'},data:[]}),'BOUNDARY_UNCERTAIN'],
      [JSON.stringify({location:{directory:ROOT},data:[],extra:1}),'BOUNDARY_UNCERTAIN'],
      [JSON.stringify({data:[]}),'BOUNDARY_UNCERTAIN'],
      ['not json','BOUNDARY_UNCERTAIN'],
    ];
    for(const [shells,reason] of cases)expect(await checkNoRunningShells(b,fakePort({shells}).port,sig())).toEqual({state:'UNAVAILABLE',reason});
    const down:NativeReadPort={...okPort.port,async getRunningShells(){return {state:'UNAVAILABLE',reason:'TIMEOUT'};}};
    expect(await checkNoRunningShells(b,down,sig())).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
    const throws:NativeReadPort={...okPort.port,async getRunningShells(){throw new Error('private fixture detail');}};
    expect(await checkNoRunningShells(b,throws,sig())).toEqual({state:'UNAVAILABLE',reason:'BOUNDARY_UNCERTAIN'});
    const ctl=new AbortController();ctl.abort();
    expect(await checkNoRunningShells(b,okPort.port,ctl.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
});

describe('daily native evidence: fixed Native HTTP port',()=>{
  const PROXY_KEYS=['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy'];
  const DUMMY_PW='dummy-pw:with:colons';
  const basic=(pw:string)=>`Basic ${Buffer.from(`opencode:${pw}`,'utf8').toString('base64')}`;
  beforeEach(()=>{for(const k of PROXY_KEYS)vi.stubEnv(k,'');vi.stubEnv('OPENCODE_PASSWORD',DUMMY_PW);vi.stubEnv('OPENCODE_SERVER_PASSWORD','');});
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
  type Seen={url:string;init:RequestInit};
  function stub(respond:(url:string,init:RequestInit)=>Promise<Response>|Response){
    const seen:Seen[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{seen.push({url,init});return respond(url,init);}));
    return seen;
  }
  const json=(body:BodyInit|null,status=200,type='application/json; charset=utf-8')=>new Response(body,{status,headers:{'content-type':type}});
  it('uses only the fixed loopback origin, paths and queries with Basic auth, no cookies or redirects',async()=>{
    const f=await makeDailyFixture();
    const seen=stub(()=>json('{"ok":true}'));
    const port=createNativeReadPort(f.config);
    const r=await port.getSession(SID,sig());
    expect(r.state).toBe('OK');
    if(r.state==='OK')expect(dec(r.bytes)).toBe('{"ok":true}');
    await port.getMessages(SID,{order:'asc',limit:100},sig());
    await port.getMessages(SID,{cursor:'a/b=c&d',limit:100},sig());
    await port.getRunningShells(ROOT,sig());
    expect(seen.map(s=>s.url)).toEqual([
      'http://127.0.0.1:49187/api/session/ses_fixture001',
      'http://127.0.0.1:49187/api/session/ses_fixture001/message?order=asc&limit=100',
      'http://127.0.0.1:49187/api/session/ses_fixture001/message?cursor=a%2Fb%3Dc%26d&limit=100',
      'http://127.0.0.1:49187/api/shell?location%5Bdirectory%5D=%2Ftmp%2Fjustice-daily-fixture',
    ]);
    for(const {init} of seen){
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
      expect(init.body).toBeUndefined();
      const h=new Headers(init.headers);
      expect(h.get('authorization')).toBe(basic(DUMMY_PW));expect(h.has('cookie')).toBe(false);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('refuses non-configured session or root without any request',async()=>{
    const f=await makeDailyFixture();
    const seen=stub(()=>json('{}'));
    const port=createNativeReadPort(f.config);
    expect(await port.getSession('ses_other001',sig())).toEqual({state:'UNAVAILABLE',reason:'SESSION_MISMATCH'});
    expect(await port.getMessages('ses_other001',{order:'asc',limit:100},sig())).toEqual({state:'UNAVAILABLE',reason:'SESSION_MISMATCH'});
    expect(await port.getMessages(SID,{cursor:'',limit:100},sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
    expect(await port.getRunningShells('/tmp/other',sig())).toEqual({state:'UNAVAILABLE',reason:'WORKSPACE_MISMATCH'});
    expect(seen).toEqual([]);
  });
  it('rejects malformed queries and handles empty response bodies and an aborted caller',async()=>{
    const f=await makeDailyFixture();
    const seen=stub(()=>json(null));
    const port=createNativeReadPort(f.config);
    expect(await port.getSession(SID,sig())).toEqual({state:'OK',bytes:new Uint8Array()});
    expect(await port.getMessages(SID,{order:'desc',limit:100} as unknown as NativePageQuery,sig()))
      .toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
    expect(seen).toHaveLength(1);

    const ctl=new AbortController();ctl.abort();
    expect(await port.getSession(SID,ctl.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    expect(seen).toHaveLength(1);
  });
  it.each([
    ['non-200',()=>json('{}',500),'SOURCE_UNAVAILABLE'],
    ['redirect status',()=>new Response(null,{status:302,headers:{location:'http://example.invalid/'}}),'SOURCE_UNAVAILABLE'],
    ['non-JSON content type',()=>json('{}',200,'text/html'),'SOURCE_UNAVAILABLE'],
    ['missing content type',()=>new Response('{}',{status:200,headers:{}}),'SOURCE_UNAVAILABLE'],
    ['fetch failure',()=>Promise.reject(new TypeError('redirect')),'SOURCE_UNAVAILABLE'],
    ['declared Content-Length over the cap',()=>new Response('{}',{status:200,headers:{'content-type':'application/json','content-length':'1048577'}}),'OBSERVATION_LIMIT'],
    ['oversize streamed body',()=>json(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(600_000));c.enqueue(new Uint8Array(600_000));c.close();}})),'OBSERVATION_LIMIT'],
  ] as const)('maps %s to a fixed reason without retry',async(_n,respond,reason)=>{
    const f=await makeDailyFixture();
    const seen=stub(respond);
    const r=await createNativeReadPort(f.config).getSession(SID,sig());
    expect(r).toEqual({state:'UNAVAILABLE',reason});
    expect(seen).toHaveLength(1);
  });
  it('applies per-endpoint caps: a 1 MiB+ message page is allowed, a 4 MiB+ page is not',async()=>{
    const f=await makeDailyFixture();
    stub(()=>json(new Uint8Array(2_000_000)));
    const port=createNativeReadPort(f.config);
    expect((await port.getMessages(SID,{order:'asc',limit:100},sig())).state).toBe('OK');
    expect(await port.getSession(SID,sig())).toEqual({state:'UNAVAILABLE',reason:'OBSERVATION_LIMIT'});
    expect(await port.getRunningShells(ROOT,sig())).toEqual({state:'UNAVAILABLE',reason:'OBSERVATION_LIMIT'});
    stub(()=>json(new Uint8Array(4_194_305)));
    expect(await createNativeReadPort(f.config).getMessages(SID,{order:'asc',limit:100},sig())).toEqual({state:'UNAVAILABLE',reason:'OBSERVATION_LIMIT'});
  });
  it.each([
    ['HTTP_PROXY'],['http_proxy'],['HTTPS_PROXY'],['https_proxy'],['ALL_PROXY'],['all_proxy'],
  ])('refuses all reads without any request when %s is set and NO_PROXY does not cover loopback',async key=>{
    const f=await makeDailyFixture();
    const seen=stub(()=>json('{}'));
    vi.stubEnv(key,'http://127.0.0.1:9');
    const port=createNativeReadPort(f.config);
    const U={state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'};
    expect(await port.getSession(SID,sig())).toEqual(U);
    expect(await port.getMessages(SID,{order:'asc',limit:100},sig())).toEqual(U);
    expect(await port.getRunningShells(ROOT,sig())).toEqual(U);
    vi.stubEnv('NO_PROXY','localhost,10.0.0.1,127.0.0.2');
    expect(await port.getSession(SID,sig())).toEqual(U);
    vi.stubEnv('NO_PROXY','');vi.stubEnv('no_proxy','127.0.0.1.example');
    expect(await port.getSession(SID,sig())).toEqual(U);
    expect(seen).toHaveLength(0);
  });
  it.each([
    ['NO_PROXY','127.0.0.1'],['NO_PROXY','*'],['no_proxy','example.com,127.0.0.1'],
  ])('refuses reads with proxy configured even when %s=%s excludes loopback',async(key,value)=>{
    const f=await makeDailyFixture();
    const seen=stub(()=>json('{"ok":true}'));
    vi.stubEnv('HTTP_PROXY','http://127.0.0.1:9');vi.stubEnv('ALL_PROXY','socks5://127.0.0.1:9');
    vi.stubEnv(key,value);
    const r=await createNativeReadPort(f.config).getSession(SID,sig());
    expect(r).toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
    expect(seen).toHaveLength(0);
  });
  it('fails closed for any non-empty proxy-related environment variable',async()=>{
    const f=await makeDailyFixture();const seen=stub(()=>json('{}'));
    for(const key of PROXY_KEYS){
      vi.stubEnv(key,'configured');
      expect(await createNativeReadPort(f.config).getSession(SID,sig()))
        .toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
      vi.stubEnv(key,'');
    }
    expect(seen).toHaveLength(0);
  });
  it('proceeds when no proxy variable is set and reads env at call time without mutating it',async()=>{
    const f=await makeDailyFixture();
    const seen=stub(()=>json('{}'));
    const port=createNativeReadPort(f.config);
    expect((await port.getSession(SID,sig())).state).toBe('OK');
    vi.stubEnv('HTTP_PROXY','http://127.0.0.1:9');
    expect(await port.getSession(SID,sig())).toEqual({state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'});
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:9');
    expect(process.env.NO_PROXY).toBe('');
    expect(seen).toHaveLength(1);
  });
  describe('loopback no-proxy compatibility (OpenCode 2.3.2 sets NO_PROXY/no_proxy to include 127.0.0.1,localhost,::1)',()=>{
    const OPENCODE_DEFAULT='127.0.0.1,localhost,::1';
    const U={state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'};
    const env=(o:Record<string,string>)=>{for(const [k,v] of Object.entries(o))vi.stubEnv(k,v);};
    const snapshotEnv=()=>Object.fromEntries(PROXY_KEYS.map(k=>[k,process.env[k]]));
    it.each([
      ['no proxy-related variable set',{}],
      ['NO_PROXY=127.0.0.1 only',{NO_PROXY:'127.0.0.1'}],
      ['no_proxy=127.0.0.1 only',{no_proxy:'127.0.0.1'}],
      ['both set to the OpenCode default',{NO_PROXY:OPENCODE_DEFAULT,no_proxy:OPENCODE_DEFAULT}],
      ['comma list with an exact 127.0.0.1 token',{NO_PROXY:'example.com,127.0.0.1,10.0.0.1'}],
      ['whitespace around tokens',{NO_PROXY:' localhost , 127.0.0.1 ',no_proxy:'\t127.0.0.1\t,::1'}],
    ] as [string,Record<string,string>][])('allows fixed-loopback reads with %s',async(_n,vars)=>{
      const f=await makeDailyFixture();
      const seen=stub(()=>json('{"ok":true}'));
      env(vars);
      const before=snapshotEnv();
      const port=createNativeReadPort(f.config);
      expect((await port.getSession(SID,sig())).state).toBe('OK');
      expect((await port.getMessages(SID,{order:'asc',limit:100},sig())).state).toBe('OK');
      expect((await port.getRunningShells(ROOT,sig())).state).toBe('OK');
      expect(seen).toHaveLength(3);
      for(const s of seen)expect(s.url.startsWith('http://127.0.0.1:49187/api/')).toBe(true);
      expect(snapshotEnv()).toEqual(before);
    });
    it.each(PROXY_KEYS.slice(0,6).map(k=>[k]))('refuses without any request when %s is set even if both NO_PROXY variables cover loopback',async key=>{
      const f=await makeDailyFixture();
      const seen=stub(()=>json('{}'));
      env({NO_PROXY:OPENCODE_DEFAULT,no_proxy:OPENCODE_DEFAULT});
      vi.stubEnv(key,'http://127.0.0.1:9');
      const port=createNativeReadPort(f.config);
      expect(await port.getSession(SID,sig())).toEqual(U);
      expect(await port.getMessages(SID,{order:'asc',limit:100},sig())).toEqual(U);
      expect(await port.getRunningShells(ROOT,sig())).toEqual(U);
      expect(seen).toHaveLength(0);
    });
    it.each([
      ['NO_PROXY without 127.0.0.1',{NO_PROXY:'localhost,::1'}],
      ['no_proxy without 127.0.0.1',{no_proxy:'localhost,::1'}],
      ['only NO_PROXY satisfies the condition',{NO_PROXY:'127.0.0.1',no_proxy:'localhost'}],
      ['only no_proxy satisfies the condition',{NO_PROXY:'localhost',no_proxy:'127.0.0.1'}],
      ['127.0.0.10',{NO_PROXY:'127.0.0.10'}],
      ['1127.0.0.1',{no_proxy:'1127.0.0.1'}],
      ['127.0.0.1.example.com',{NO_PROXY:'127.0.0.1.example.com'}],
      ['127.0.0.1 with a port',{NO_PROXY:'127.0.0.1:49187'}],
      ['wildcard only',{NO_PROXY:'*'}],
      ['wildcard host only',{no_proxy:'*.example.com'}],
      ['CIDR only',{NO_PROXY:'127.0.0.0/8'}],
      ['dot-prefixed suffix',{NO_PROXY:'.0.0.1'}],
      ['empty tokens only',{NO_PROXY:' , ,'}],
      ['arbitrary non-empty value',{no_proxy:'configured'}],
    ] as [string,Record<string,string>][])('refuses without any request when %s',async(_n,vars)=>{
      const f=await makeDailyFixture();
      const seen=stub(()=>json('{}'));
      env(vars);
      const before=snapshotEnv();
      const port=createNativeReadPort(f.config);
      expect(await port.getSession(SID,sig())).toEqual(U);
      expect(await port.getMessages(SID,{order:'asc',limit:100},sig())).toEqual(U);
      expect(await port.getRunningShells(ROOT,sig())).toEqual(U);
      expect(seen).toHaveLength(0);
      expect(snapshotEnv()).toEqual(before);
    });
    it('re-evaluates the environment at every call',async()=>{
      const f=await makeDailyFixture();
      const seen=stub(()=>json('{}'));
      env({NO_PROXY:OPENCODE_DEFAULT,no_proxy:OPENCODE_DEFAULT});
      const port=createNativeReadPort(f.config);
      expect((await port.getSession(SID,sig())).state).toBe('OK');
      vi.stubEnv('no_proxy','localhost');
      expect(await port.getSession(SID,sig())).toEqual(U);
      vi.stubEnv('no_proxy',OPENCODE_DEFAULT);
      expect((await port.getSession(SID,sig())).state).toBe('OK');
      expect(seen).toHaveLength(2);
    });
  });
  it('times out each GET at 5s and maps caller abort to ABORTED',async()=>{
    const f=await makeDailyFixture();
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    stub((_u,init)=>new Promise((_res,rej)=>init.signal!.addEventListener('abort',()=>rej(new DOMException('aborted','AbortError')))));
    const port=createNativeReadPort(f.config);
    const p=port.getSession(SID,sig());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toEqual({state:'UNAVAILABLE',reason:'TIMEOUT'});
    const ctl=new AbortController();
    const q=port.getSession(SID,ctl.signal);
    ctl.abort();
    expect(await q).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
  });
});

describe('daily native evidence: Native API Basic authentication (OpenCode 2.3.2 contract)',()=>{
  const PROXY_KEYS=['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy'];
  const PW='dummy-pw-1';
  const basic=(pw:string)=>`Basic ${Buffer.from(`opencode:${pw}`,'utf8').toString('base64')}`;
  beforeEach(()=>{for(const k of PROXY_KEYS)vi.stubEnv(k,'');vi.stubEnv('OPENCODE_PASSWORD','');vi.stubEnv('OPENCODE_SERVER_PASSWORD','');});
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
  type Seen={url:string;init:RequestInit};
  function stub(respond:(url:string,init:RequestInit)=>Promise<Response>|Response=()=>json('{}')){
    const seen:Seen[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{seen.push({url,init});return respond(url,init);}));
    return seen;
  }
  const json=(body:BodyInit|null,status=200)=>new Response(body,{status,headers:{'content-type':'application/json'}});
  const U={state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'};
  const readAll=async(port:NativeReadPort)=>[
    await port.getSession(SID,sig()),
    await port.getMessages(SID,{order:'asc',limit:100},sig()),
    await port.getRunningShells(ROOT,sig()),
  ];

  it('sends opencode:<OPENCODE_PASSWORD> Basic credentials on all three endpoints, only to the fixed origin',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    const f=await makeDailyFixture();const seen=stub();
    const results=await readAll(createNativeReadPort(f.config));
    expect(results.map(r=>r.state)).toEqual(['OK','OK','OK']);
    expect(seen).toHaveLength(3);
    for(const {url,init} of seen){
      expect(url.startsWith('http://127.0.0.1:49187/')).toBe(true);
      expect(new Headers(init.headers).get('authorization')).toBe(basic(PW));
      expect(init.redirect).toBe('error');expect(init.credentials).toBe('omit');
    }
  });
  it('falls back to OPENCODE_SERVER_PASSWORD and prefers OPENCODE_PASSWORD (host precedence)',async()=>{
    const f=await makeDailyFixture();const seen=stub();
    vi.stubEnv('OPENCODE_SERVER_PASSWORD','legacy-pw');
    await createNativeReadPort(f.config).getSession(SID,sig());
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    await createNativeReadPort(f.config).getSession(SID,sig());
    expect(seen.map(s=>new Headers(s.init.headers).get('authorization'))).toEqual([basic('legacy-pw'),basic(PW)]);
  });
  it('encodes non-ASCII passwords as UTF-8',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD','pässwörd');
    const f=await makeDailyFixture();const seen=stub();
    await createNativeReadPort(f.config).getSession(SID,sig());
    expect(new Headers(seen[0]!.init.headers).get('authorization')).toBe(basic('pässwörd'));
  });
  it('fails closed without any request when no credential is available (no unauthenticated fallback)',async()=>{
    const f=await makeDailyFixture();const seen=stub();
    expect(await readAll(createNativeReadPort(f.config))).toEqual([U,U,U]);
    expect(seen).toHaveLength(0);
  });
  it('reads the credential at call time and does not retain it at construction',async()=>{
    const f=await makeDailyFixture();const seen=stub();
    const port=createNativeReadPort(f.config);
    expect(seen).toHaveLength(0);
    expect(await port.getSession(SID,sig())).toEqual(U);
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    expect((await port.getSession(SID,sig())).state).toBe('OK');
    vi.stubEnv('OPENCODE_PASSWORD','');
    expect(await port.getSession(SID,sig())).toEqual(U);
    expect(seen).toHaveLength(1);
  });
  it.each([401,403])('treats HTTP %i as fail-closed with a single attempt and no credential switch',async status=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);vi.stubEnv('OPENCODE_SERVER_PASSWORD','other-pw');
    const f=await makeDailyFixture();const seen=stub(()=>json('{"_tag":"UnauthorizedError"}',status));
    expect(await createNativeReadPort(f.config).getSession(SID,sig())).toEqual(U);
    expect(seen).toHaveLength(1);
  });
  it('does not forward credentials across a redirect (redirect:error) and fails closed',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    const f=await makeDailyFixture();
    const seen=stub(()=>Promise.reject(new TypeError('redirect')));
    expect(await createNativeReadPort(f.config).getSession(SID,sig())).toEqual(U);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.init.redirect).toBe('error');
  });
  it('refuses to send the credential when a proxy is configured',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);vi.stubEnv('HTTP_PROXY','http://127.0.0.1:9');
    const f=await makeDailyFixture();const seen=stub();
    expect(await readAll(createNativeReadPort(f.config))).toEqual([U,U,U]);
    expect(seen).toHaveLength(0);
  });
  it('keeps session/workspace pinning: mismatches send nothing',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    const f=await makeDailyFixture();const seen=stub();
    const port=createNativeReadPort(f.config);
    await port.getSession('ses_other001',sig());await port.getRunningShells('/tmp/other',sig());
    expect(seen).toHaveLength(0);
  });
  it('never leaks the credential (raw or Base64) into results, even when the host response echoes it',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    const f=await makeDailyFixture();
    stub((_u,init)=>json(`{"echo":"${new Headers(init.headers).get('authorization')}"}`,401));
    const results=await readAll(createNativeReadPort(f.config));
    const text=JSON.stringify(results);
    expect(text).not.toContain(PW);expect(text).not.toContain(Buffer.from(`opencode:${PW}`).toString('base64'));
    stub(()=>Promise.reject(new Error(`boom ${PW}`)));
    const failed=JSON.stringify(await readAll(createNativeReadPort(f.config)));
    expect(failed).not.toContain(PW);
  });
  it('does not mutate or export the password environment variables',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    const f=await makeDailyFixture();stub();
    await createNativeReadPort(f.config).getSession(SID,sig());
    expect(process.env.OPENCODE_PASSWORD).toBe(PW);
  });
  it('keeps abort behaviour: an aborted caller sends no request even with a credential',async()=>{
    vi.stubEnv('OPENCODE_PASSWORD',PW);
    const f=await makeDailyFixture();const seen=stub();
    const ctl=new AbortController();ctl.abort();
    expect(await createNativeReadPort(f.config).getSession(SID,ctl.signal)).toEqual({state:'UNAVAILABLE',reason:'ABORTED'});
    expect(seen).toHaveLength(0);
  });
});
