import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import type {S1aReadOnlySource} from '../../src/core/s1a/contract.js';
import type {S1dReportV1} from '../../src/core/s1d/contract.js';
import {
  makeDailyUnavailable,markDailyBoundaryUncertain,projectDailyEvidence,runDailyAdvisory,
  type DailyAdvisoryReport,type DailyDiagnosticPort,
} from '../../src/runtime/daily-advisory.js';
import type {DailyChangeSetResult} from '../../src/runtime/daily-changeset.js';
import {prepareDailyBinding,type DailyBinding,type DailyPreflightPorts,type DailyReason} from '../../src/runtime/daily-intent.js';
import type {DailyEvidenceResult} from '../../src/runtime/daily-native-evidence.js';
import {runS1dDiagnostic} from '../../src/runtime/s1d-diagnostic.js';
import {validateS2bCorrelation,validateS2bSource} from '../../src/runtime/s2b-input.js';
import {projectS2bEvidence} from '../../src/runtime/s2b-projector.js';
import {makeDailyFixture} from '../helpers/daily-fixtures.js';
import {assistantMessage,buildSource,correlation,enc,firstRequest,idleMessage,pageResponse,userMessage} from '../s2b/fixtures.js';

type Rec=Record<string,unknown>;
const sig=()=>new AbortController().signal;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const dec=(b:Uint8Array)=>new TextDecoder().decode(b);
const SECRET='SECRET_FIXTURE_TOKEN_do_not_leak';
const ac=(id:string)=>({artifactId:id,revision:'R1'});

/** Local direct shell part exactly as approved for the rule (executed:false), plus a secret marker in its output. */
function shellPart(binding:DailyBinding,id:string,ruleId:string,executed:boolean=false):Rec{
  const input={...binding.config.approval.rules.find(r=>r.ruleId===ruleId)!.input};
  return {type:'tool',id,name:'shell',state:{status:'completed',input,content:[{type:'text',text:SECRET}]},time:{created:2_000},executed};
}
type EvidenceSpec={parts?:Rec[];tools?:{toolId:string;ac:string}[];limited?:boolean;reasons?:DailyReason[];incomplete?:boolean};
function evidenceOf(binding:DailyBinding,spec:EvidenceSpec={}):Extract<DailyEvidenceResult,{state:'VALID'}>{
  const parts=spec.parts??[shellPart(binding,'tool_001','r1')];
  const messages=[userMessage('msg_001'),assistantMessage('msg_002',parts),idleMessage('msg_003')];
  const response=spec.incomplete?pageResponse(messages,'cur-1'):pageResponse(messages);
  const rawWrapper=enc(buildSource({pages:[{request:firstRequest(),response}]}));
  const tools=(spec.tools??[{toolId:'tool_001',ac:'ac-1'}]).map(t=>({toolId:t.toolId,acRef:ac(t.ac)}));
  const correlationBytes=enc(JSON.stringify(correlation(tools.length===0?[]:[{messageId:'msg_002',tools}])));
  return {state:'VALID',bindingKey:binding.key,rawWrapper,correlationBytes,sourceSha256:sha(rawWrapper),correlationSha256:sha(correlationBytes),
    limited:spec.limited??true,reasons:spec.reasons??['RULE_UNMATCHED']};
}

async function makeAdvisoryFixture(){
  const f=await makeDailyFixture();
  const r=await prepareDailyBinding(f.config,f.ports,sig());
  if(r.state!=='READY')throw Error(`binding not ready: ${r.reason}`);
  const binding=r.binding;
  const preflight:DailyPreflightPorts=f.ports;
  // r1 matched exactly; r2 intentionally missing → accepted limited evidence.
  const validEvidence=evidenceOf(binding);
  const fullEvidence=evidenceOf(binding,{parts:[shellPart(binding,'tool_001','r1'),shellPart(binding,'tool_002','r2')],
    tools:[{toolId:'tool_001',ac:'ac-1'},{toolId:'tool_002',ac:'ac-2'}],limited:false,reasons:[]});
  const missingEvidence:DailyEvidenceResult={state:'UNAVAILABLE',reason:'SOURCE_UNAVAILABLE'};
  const rejectedEvidence:DailyEvidenceResult={state:'REJECTED',reasons:['SOURCE_REJECTED'],diagnostics:[{code:'SOURCE_SCHEMA_INVALID',count:1}]};
  const validGit:DailyChangeSetResult={state:'VALID',baseCommit:f.approval.baseCommit,headCommit:f.approval.baseCommit,
    changeSet:{availability:'PRESENT',changes:[{kind:'ADD',path:'outside.txt'}]}};
  const missingGit:DailyChangeSetResult={state:'UNAVAILABLE',reason:'GIT_UNAVAILABLE'};
  return {f,approval:f.approval,binding,preflight,validEvidence,fullEvidence,missingEvidence,rejectedEvidence,validGit,missingGit};
}
type Fx=Awaited<ReturnType<typeof makeAdvisoryFixture>>;
const invalidPorts=(f:Fx):DailyPreflightPorts=>({...f.preflight,reloadOwnerConfig:async()=>({state:'OFF' as const,reason:'APPROVAL_DIGEST_MISMATCH' as const})});

const FORBIDDEN=[SECRET,'outside.txt','src/a.ts','ses_fixture001','msg_00','tool_00','/tmp/','/run/','justice-daily-fixture','unreadable','boom','vitest run','oc225-msg-'];
function expectSafe(report:DailyAdvisoryReport):void{
  expect(report.schemaVersion).toBe('justice-daily-advisory-v1');
  expect(report.formalVerdict).toBe('UNKNOWN');
  expect(report.ownerAuthorityStatus).toBe('NOT_PROVEN');
  expect(report.coverageCompleteness).toBe('NOT_ESTABLISHED');
  expect(report.nativeDiffProjection).toBe('UNAVAILABLE');
  expect(Object.isFrozen(report)).toBe(true);
  expect(Object.isFrozen(report.evidence)).toBe(true);
  expect(Object.isFrozen(report.scope)).toBe(true);
  const json=JSON.stringify(report);
  for(const token of FORBIDDEN)expect(json,token).not.toContain(token);
  expect(json).not.toMatch(/[0-9a-f]{40}/);
}
const unknownScope=(reason:string)=>({state:'NOT_EVALUATED',comparison:'UNKNOWN',reason});
const fallbackOutside={state:'EVALUATED',origin:'S1D_SCOPE_FALLBACK',comparison:'OUTSIDE_CANDIDATE_SCOPE',outsidePathCount:1,formalVerdictAvailable:false};
const s1cOutside={state:'EVALUATED',origin:'S1C',comparison:'OUTSIDE_CANDIDATE_SCOPE',outsidePathCount:1,formalVerdictAvailable:false};

describe('daily advisory: brief examples',()=>{
  it("keeps known scope deviation when native evidence is rejected",async()=>{
    const f=await makeAdvisoryFixture(); const run=vi.fn(runS1dDiagnostic);
    const report=await runDailyAdvisory(f.binding,f.rejectedEvidence,f.validGit,
      "BOUNDED",f.preflight,new AbortController().signal,run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report.state).toBe("LIMITED");
    expect(report.evidence.state).toBe("REJECTED");
    expect(report.scope).toEqual({state:"EVALUATED",origin:"S1D_SCOPE_FALLBACK",
      comparison:"OUTSIDE_CANDIDATE_SCOPE",outsidePathCount:1,formalVerdictAvailable:false});
    expect(report.formalVerdict).toBe("UNKNOWN");
    expect(report.ownerAuthorityStatus).toBe("NOT_PROVEN");
    expect(report.evidence).toEqual({state:'REJECTED',diagnostics:[{code:'SOURCE_SCHEMA_INVALID',count:1}],reasons:['SOURCE_REJECTED']});
    expect(report.limitations).toContain('NO_FORMAL_S1C_RESULT');
    expect(report.s1cCodes).toEqual([]);
    expectSafe(report);
  });
  it("does not diagnose an invalid intent even with valid git",async()=>{
    const f=await makeAdvisoryFixture(); const run=vi.fn(runS1dDiagnostic);
    const ports={...f.preflight,reloadOwnerConfig:async()=>({state:"OFF" as const,reason:"APPROVAL_DIGEST_MISMATCH" as const})};
    const r=await runDailyAdvisory(f.binding,f.validEvidence,f.validGit,"BOUNDED",ports,new AbortController().signal,run);
    expect(run).not.toHaveBeenCalled(); expect(r.state).toBe("UNAVAILABLE");
    expect(r.scope.comparison).toBe("UNKNOWN"); expect(r.evidence.state).toBe("NOT_EVALUATED");
    expect(r.reasons).toEqual(['BINDING_INVALID']);
    expectSafe(r);
  });
});

describe('daily advisory: seven-row table',()=>{
  type Row={name:string;ev:(f:Fx)=>DailyEvidenceResult;git:(f:Fx)=>DailyChangeSetResult;ports?:(f:Fx)=>DailyPreflightPorts;
    state:DailyAdvisoryReport['state'];evidence:unknown;scope:unknown;calls:number;reasons:readonly DailyReason[];
    changeSetOrigin:'GIT_READ_ONLY'|'UNAVAILABLE';taskRef:unknown};
  const task={artifactId:'task-1',revision:'R1'};
  const fullView={state:'VALID',projectionStatus:'PROJECTED',ruleLimited:false,matchedLocalCompletedHookCount:2,
    reportedExecutionState:'UNKNOWN',reportedOutcome:'UNKNOWN',
    coverage:[{acRef:ac('ac-1'),coverageStatus:'MATCHED_REF_PRESENT'},{acRef:ac('ac-2'),coverageStatus:'MATCHED_REF_PRESENT'}],
    diagnostics:[{code:'DIFF_UNAVAILABLE',count:1}],reasons:[]};
  const limitedView={state:'VALID',projectionStatus:'PROJECTED',ruleLimited:true,matchedLocalCompletedHookCount:1,
    reportedExecutionState:'UNKNOWN',reportedOutcome:'UNKNOWN',
    coverage:[{acRef:ac('ac-1'),coverageStatus:'MATCHED_REF_PRESENT'},{acRef:ac('ac-2'),coverageStatus:'MISSING_EVIDENCE'}],
    diagnostics:[{code:'DIFF_UNAVAILABLE',count:1}],reasons:['RULE_UNMATCHED']};
  const rows:Row[]=[
    {name:'1 valid/VALID/VALID bounded, not limited',ev:f=>f.fullEvidence,git:f=>f.validGit,state:'DIAGNOSED',evidence:fullView,scope:s1cOutside,calls:1,
      reasons:[],changeSetOrigin:'GIT_READ_ONLY',taskRef:task},
    {name:'2 valid/VALID rule limited/VALID',ev:f=>f.validEvidence,git:f=>f.validGit,state:'LIMITED',evidence:limitedView,scope:s1cOutside,calls:1,
      reasons:['RULE_UNMATCHED'],changeSetOrigin:'GIT_READ_ONLY',taskRef:task},
    {name:'3 valid/UNAVAILABLE/VALID',ev:f=>f.missingEvidence,git:f=>f.validGit,state:'LIMITED',
      evidence:{state:'UNAVAILABLE',diagnostics:[],reasons:['SOURCE_UNAVAILABLE']},scope:fallbackOutside,calls:1,
      reasons:['SOURCE_UNAVAILABLE'],changeSetOrigin:'GIT_READ_ONLY',taskRef:task},
    {name:'4 valid/REJECTED/VALID',ev:f=>f.rejectedEvidence,git:f=>f.validGit,state:'LIMITED',
      evidence:{state:'REJECTED',diagnostics:[{code:'SOURCE_SCHEMA_INVALID',count:1}],reasons:['SOURCE_REJECTED']},scope:fallbackOutside,calls:1,
      reasons:['SOURCE_REJECTED'],changeSetOrigin:'GIT_READ_ONLY',taskRef:task},
    {name:'5 valid/VALID/UNAVAILABLE',ev:f=>f.validEvidence,git:f=>f.missingGit,state:'LIMITED',evidence:limitedView,scope:unknownScope('GIT_UNAVAILABLE'),calls:1,
      reasons:['RULE_UNMATCHED','GIT_UNAVAILABLE'],changeSetOrigin:'UNAVAILABLE',taskRef:task},
    {name:'6 invalid/any/any',ev:f=>f.fullEvidence,git:f=>f.validGit,ports:invalidPorts,state:'UNAVAILABLE',
      evidence:{state:'NOT_EVALUATED',diagnostics:[],reasons:['BINDING_INVALID']},scope:unknownScope('BINDING_INVALID'),calls:0,
      reasons:['BINDING_INVALID'],changeSetOrigin:'UNAVAILABLE',taskRef:null},
    {name:'7a valid/UNAVAILABLE/UNAVAILABLE',ev:f=>f.missingEvidence,git:f=>f.missingGit,state:'UNAVAILABLE',
      evidence:{state:'UNAVAILABLE',diagnostics:[],reasons:['SOURCE_UNAVAILABLE']},scope:unknownScope('GIT_UNAVAILABLE'),calls:0,
      reasons:['SOURCE_UNAVAILABLE','GIT_UNAVAILABLE'],changeSetOrigin:'UNAVAILABLE',taskRef:task},
    {name:'7b valid/REJECTED/UNAVAILABLE',ev:f=>f.rejectedEvidence,git:f=>f.missingGit,state:'UNAVAILABLE',
      evidence:{state:'REJECTED',diagnostics:[{code:'SOURCE_SCHEMA_INVALID',count:1}],reasons:['SOURCE_REJECTED']},scope:unknownScope('GIT_UNAVAILABLE'),calls:0,
      reasons:['SOURCE_REJECTED','GIT_UNAVAILABLE'],changeSetOrigin:'UNAVAILABLE',taskRef:task},
  ];
  it.each(rows.map(r=>[r.name,r] as const))('%s',async(_n,row)=>{
    const f=await makeAdvisoryFixture(); const run=vi.fn(runS1dDiagnostic);
    const report=await runDailyAdvisory(f.binding,row.ev(f),row.git(f),'BOUNDED',row.ports?.(f)??f.preflight,sig(),run);
    expect(run).toHaveBeenCalledTimes(row.calls);
    expect(report.state).toBe(row.state);
    expect(report.evidence).toEqual(row.evidence);
    expect(report.scope).toEqual(row.scope);
    expect(report.reasons).toEqual(row.reasons);
    expect(report.changeSetOrigin).toBe(row.changeSetOrigin);
    expect(report.taskRef).toEqual(row.taskRef);
    expect(report.scopeKey).toBe(row.taskRef===null?null:'scope-1');
    expect(report.boundary).toBe(row.calls===0&&row.taskRef===null?'NOT_EVALUATED':'BOUNDED');
    expectSafe(report);
  });
  it('row 1/2 expose only actual S1-c codes; row 3/4 fallback fabricates none',async()=>{
    const f=await makeAdvisoryFixture();
    const full=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(full.s1cCodes).toEqual(['OUTSIDE_CANDIDATE_SCOPE','OWNER_AUTHORITY_NOT_VERIFIED']);
    expect(full.limitations).not.toContain('NO_FORMAL_S1C_RESULT');
    const limited=await runDailyAdvisory(f.binding,f.validEvidence,f.validGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    // missing AC is an actual S1-c finding when S1-c is evaluated
    expect(limited.s1cCodes).toEqual(['OUTSIDE_CANDIDATE_SCOPE','AC_EVIDENCE_REF_MISSING','OWNER_AUTHORITY_NOT_VERIFIED']);
    const fb=await runDailyAdvisory(f.binding,f.missingEvidence,f.validGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(fb.s1cCodes).toEqual([]);
    expect(fb.limitations).toContain('NO_FORMAL_S1C_RESULT');
  });
  it('projection-limited (incomplete pagination) with no rule limit is LIMITED with actual projectionStatus',async()=>{
    const f=await makeAdvisoryFixture();
    const ev=evidenceOf(f.binding,{incomplete:true,limited:false,reasons:[]});
    const report=await runDailyAdvisory(f.binding,ev,f.validGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(report.state).toBe('LIMITED');
    expect(report.evidence).toMatchObject({state:'VALID',projectionStatus:'LIMITED',ruleLimited:false,matchedLocalCompletedHookCount:1});
    if(report.evidence.state!=='VALID')throw Error('expected VALID evidence view');
    expect(report.evidence.diagnostics.map(d=>d.code)).toContain('PAGINATION_INCOMPLETE');
    expectSafe(report);
  });
});

describe('daily advisory: projection reuse',()=>{
  it('projects valid evidence once into safe refs with legacy UNKNOWN labels',async()=>{
    const f=await makeAdvisoryFixture();
    const p=projectDailyEvidence(f.binding,f.validEvidence);
    if(p.state!=='VALID')throw Error(`expected VALID, got ${JSON.stringify(p)}`);
    expect(p.projectionStatus).toBe('PROJECTED');
    expect(p.ruleLimited).toBe(true);
    expect(p.reasons).toEqual(['RULE_UNMATCHED']);
    expect(p.refs.map(r=>[r.acRef?.artifactId,r.reportedExecutionState,r.reportedOutcome,r.provenanceClass])).toEqual([['ac-1','UNKNOWN','UNKNOWN','UNVERIFIED_EXTERNAL']]);
  });
  const mutations:readonly [string,(e:Extract<DailyEvidenceResult,{state:'VALID'}>,f:Fx)=>DailyEvidenceResult,DailyReason][]=[
    ['wrapper digest',e=>({...e,sourceSha256:'0'.repeat(64)}),'SOURCE_REJECTED'],
    ['correlation digest',e=>({...e,correlationSha256:'0'.repeat(64)}),'SOURCE_REJECTED'],
    ['wrapper bytes mutated after digest',e=>{const raw=Uint8Array.from(e.rawWrapper);raw[raw.length-2]=0x20;return {...e,rawWrapper:raw};},'SOURCE_REJECTED'],
    ['foreign bindingKey',e=>({...e,bindingKey:'b'.repeat(64)}),'BINDING_KEY_MISMATCH'],
  ];
  it.each(mutations)('mutated %s rejects the projection and S1-d sees no evidence',async(_l,mutate,reason)=>{
    const f=await makeAdvisoryFixture();
    const ev=mutate(f.validEvidence,f);
    const p=projectDailyEvidence(f.binding,ev);
    expect(p).toEqual({state:'REJECTED',diagnostics:[{code:'SOURCE_IDENTITY_MISMATCH',count:1}],reasons:[reason]});
    const run=vi.fn(runS1dDiagnostic);
    const report=await runDailyAdvisory(f.binding,ev,f.validGit,'BOUNDED',f.preflight,sig(),run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report.state).toBe('LIMITED');
    expect(report.evidence).toEqual({state:'REJECTED',diagnostics:[{code:'SOURCE_IDENTITY_MISMATCH',count:1}],reasons:[reason]});
    expect(report.scope).toEqual(fallbackOutside);
    const src=run.mock.calls[0]![1];
    await expect(src.readInputFile('daily://evidence',1_048_576)).rejects.toThrow('unreadable');
    expectSafe(report);
  });
  it('malformed Source is rejected with the existing validator diagnostics',async()=>{
    const f=await makeAdvisoryFixture();
    const raw=enc('{not json');
    const ev={...f.validEvidence,rawWrapper:raw,sourceSha256:sha(raw)};
    const p=projectDailyEvidence(f.binding,ev);
    expect(p.state).toBe('REJECTED');
    if(p.state!=='REJECTED')throw Error('expected REJECTED');
    expect(p.reasons).toEqual(['SOURCE_REJECTED']);
    expect(p.diagnostics.map(d=>d.code)).toEqual(['SOURCE_SCHEMA_INVALID']);
  });
  it('foreign session Source/Correlation is rejected',async()=>{
    const f=await makeAdvisoryFixture();
    const corr=enc(JSON.stringify(correlation([{messageId:'msg_002',tools:[{toolId:'tool_001',acRef:ac('ac-1')}]}],'ses_other001')));
    const ev={...f.validEvidence,correlationBytes:corr,correlationSha256:sha(corr)};
    const p=projectDailyEvidence(f.binding,ev);
    expect(p).toEqual({state:'REJECTED',diagnostics:[{code:'SOURCE_IDENTITY_MISMATCH',count:1}],reasons:['SOURCE_REJECTED']});
  });
  it('an EXECUTED label from the projector is rejected rather than promoted',async()=>{
    const f=await makeAdvisoryFixture();
    const ev=evidenceOf(f.binding,{parts:[shellPart(f.binding,'tool_001','r1',true)]});
    const p=projectDailyEvidence(f.binding,ev);
    expect(p).toEqual({state:'REJECTED',diagnostics:[{code:'SOURCE_IDENTITY_MISMATCH',count:1}],reasons:['SOURCE_REJECTED']});
  });
  it('projector REJECTED is treated as zero accepted refs',async()=>{
    const f=await makeAdvisoryFixture();
    // incomplete pagination + a binding to a tool that does not exist → existing projector REJECTED
    const ev=evidenceOf(f.binding,{incomplete:true,tools:[{toolId:'tool_404',ac:'ac-1'}]});
    // Guard: both validators accept, so the rejection really comes from the existing projector.
    const source=validateS2bSource(ev.rawWrapper);
    const corr=validateS2bCorrelation(ev.correlationBytes);
    expect(source.state).toBe('ACCEPTED');
    expect(corr.state).toBe('ACCEPTED');
    if(source.state!=='ACCEPTED'||corr.state!=='ACCEPTED')throw Error('expected ACCEPTED');
    const legacy=projectS2bEvidence(source.value,corr,f.binding.intent);
    expect(legacy.status).toBe('REJECTED');
    const p=projectDailyEvidence(f.binding,ev);
    expect(p.state).toBe('REJECTED');
    if(p.state!=='REJECTED')throw Error('expected REJECTED');
    expect(p.reasons).toEqual(['SOURCE_REJECTED']);
    expect(p.diagnostics).toEqual(legacy.diagnostics);
    expect(p).not.toHaveProperty('refs');
  });
  it('accepted empty refs are served as [] while a missing read throws',async()=>{
    const f=await makeAdvisoryFixture();
    const empty=evidenceOf(f.binding,{tools:[],reasons:['RULE_UNMATCHED']});
    const p=projectDailyEvidence(f.binding,empty);
    expect(p).toMatchObject({state:'VALID',refs:[],projectionStatus:'PROJECTED'});
    const run=vi.fn(runS1dDiagnostic);
    const report=await runDailyAdvisory(f.binding,empty,f.validGit,'BOUNDED',f.preflight,sig(),run);
    expect(run).toHaveBeenCalledTimes(1);
    const [req,src]=run.mock.calls[0]!;
    expect(req).toEqual({loaderInput:f.binding.config.loaderInput,evidencePath:'daily://evidence',changesetPath:'daily://changeset'});
    expect(dec(await src.readInputFile('daily://evidence',1_048_576))).toBe('[]');
    expect(report.state).toBe('LIMITED');
    expect(report.evidence).toMatchObject({state:'VALID',matchedLocalCompletedHookCount:0,
      coverage:[{acRef:ac('ac-1'),coverageStatus:'MISSING_EVIDENCE'},{acRef:ac('ac-2'),coverageStatus:'MISSING_EVIDENCE'}]});
    expect(report.s1cCodes).toContain('AC_EVIDENCE_REF_MISSING');
    expect(report.scope).toEqual(s1cOutside);

    const missRun=vi.fn(runS1dDiagnostic);
    await runDailyAdvisory(f.binding,f.missingEvidence,f.validGit,'BOUNDED',f.preflight,sig(),missRun);
    const missSrc=missRun.mock.calls[0]![1];
    await expect(missSrc.readInputFile('daily://evidence',1_048_576)).rejects.toThrow('unreadable');
  });
});

describe('daily advisory: invocation path',()=>{
  it('serves a bounded Git ChangeSet or the fixed UNAVAILABLE ChangeSet and never aliases approved inputs',async()=>{
    const f=await makeAdvisoryFixture();
    const run=vi.fn(runS1dDiagnostic);
    await runDailyAdvisory(f.binding,f.validEvidence,f.validGit,'BOUNDED',f.preflight,sig(),run);
    const src:S1aReadOnlySource=run.mock.calls[0]![1];
    expect(JSON.parse(dec(await src.readInputFile('daily://changeset',262_144)))).toEqual({availability:'PRESENT',changes:[{kind:'ADD',path:'outside.txt'}]});
    await expect(src.readInputFile('daily://other',1_048_576)).rejects.toThrow('unreadable');
    await expect(src.readArtifact('/elsewhere','plan-1.md',1_048_576)).rejects.toThrow('unreadable');
    // fresh copies only
    const a=await src.readInputFile('daily://changeset',262_144); a[0]=0;
    expect(dec(await src.readInputFile('daily://changeset',262_144)).startsWith('{')).toBe(true);
    const run2=vi.fn(runS1dDiagnostic);
    await runDailyAdvisory(f.binding,f.validEvidence,f.missingGit,'BOUNDED',f.preflight,sig(),run2);
    expect(dec(await run2.mock.calls[0]![1].readInputFile('daily://changeset',262_144))).toBe('{"availability":"UNAVAILABLE"}');
  });
  it('within-scope src/a.ts is WITHIN_CANDIDATE_SCOPE with zero outside paths',async()=>{
    const f=await makeAdvisoryFixture();
    const git:DailyChangeSetResult={...f.validGit,changeSet:{availability:'PRESENT',changes:[{kind:'MODIFY',path:'src/a.ts'}]}} as DailyChangeSetResult;
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,git,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(report.state).toBe('DIAGNOSED');
    expect(report.scope).toEqual({state:'EVALUATED',origin:'S1C',comparison:'WITHIN_CANDIDATE_SCOPE',outsidePathCount:0,formalVerdictAvailable:false});
    const fb=await runDailyAdvisory(f.binding,f.missingEvidence,git,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(fb.scope).toEqual({state:'EVALUATED',origin:'S1D_SCOPE_FALLBACK',comparison:'WITHIN_CANDIDATE_SCOPE',outsidePathCount:0,formalVerdictAvailable:false});
    expectSafe(report); expectSafe(fb);
  });
  const badGit:readonly [string,(f:Fx)=>DailyChangeSetResult][]=[
    ['invalid ChangeSet path',f=>({...f.validGit,changeSet:{availability:'PRESENT',changes:[{kind:'ADD',path:'../escape'}]}} as DailyChangeSetResult)],
    ['foreign base commit',f=>({...f.validGit,baseCommit:'c'.repeat(40)})],
    ['malformed head commit',f=>({...f.validGit,headCommit:'HEAD'})],
  ];
  it.each(badGit)('Git invalid (%s) is treated as Git UNAVAILABLE',async(_l,git)=>{
    const f=await makeAdvisoryFixture();
    const run=vi.fn(runS1dDiagnostic);
    const report=await runDailyAdvisory(f.binding,f.validEvidence,git(f),'BOUNDED',f.preflight,sig(),run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report.state).toBe('LIMITED');
    expect(report.changeSetOrigin).toBe('UNAVAILABLE');
    expect(report.scope).toEqual(unknownScope('GIT_UNAVAILABLE'));
    expect(dec(await run.mock.calls[0]![1].readInputFile('daily://changeset',262_144))).toBe('{"availability":"UNAVAILABLE"}');
    const none=vi.fn(runS1dDiagnostic);
    const r2=await runDailyAdvisory(f.binding,f.missingEvidence,git(f),'BOUNDED',f.preflight,sig(),none);
    expect(none).not.toHaveBeenCalled();
    expect(r2.state).toBe('UNAVAILABLE');
    expect(r2.reasons).toEqual(['SOURCE_UNAVAILABLE','GIT_UNAVAILABLE']);
    expectSafe(report); expectSafe(r2);
  });
  it('fallback NOT_EVALUATED retains its reason and UNKNOWN; with no evidence the report is UNAVAILABLE',async()=>{
    const f=await makeAdvisoryFixture();
    const run=vi.fn<DailyDiagnosticPort>(async(req,src)=>{
      const real=await runS1dDiagnostic(req,src);
      return {...real,scopeFallback:{state:'NOT_EVALUATED',reason:'SCOPE_POLICY_UNDEFINED'}} as S1dReportV1;
    });
    const report=await runDailyAdvisory(f.binding,f.missingEvidence,f.validGit,'BOUNDED',f.preflight,sig(),run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report.state).toBe('UNAVAILABLE');
    expect(report.scope).toEqual(unknownScope('SCOPE_POLICY_UNDEFINED'));
    expect(report.s1cCodes).toEqual([]);
    expectSafe(report);
  });
  it('S1-d unexpected exception → UNAVAILABLE/DIAGNOSTIC_UNAVAILABLE without retry or error text',async()=>{
    const f=await makeAdvisoryFixture();
    const run=vi.fn<DailyDiagnosticPort>(async()=>{throw new Error(`boom /tmp/secret ${SECRET}`);});
    const report=await runDailyAdvisory(f.binding,f.validEvidence,f.validGit,'BOUNDED',f.preflight,sig(),run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report).toEqual(makeDailyUnavailable('DIAGNOSTIC_UNAVAILABLE'));
    expectSafe(report);
  });
  it('abort before start makes no S1-d call',async()=>{
    const f=await makeAdvisoryFixture();
    const ctl=new AbortController(); ctl.abort();
    const run=vi.fn(runS1dDiagnostic);
    const report=await runDailyAdvisory(f.binding,f.validEvidence,f.validGit,'BOUNDED',f.preflight,ctl.signal,run);
    expect(run).not.toHaveBeenCalled();
    expect(report).toEqual(makeDailyUnavailable('ABORTED'));
  });
  it('cancel during S1-d suppresses the stale result',async()=>{
    const f=await makeAdvisoryFixture();
    const ctl=new AbortController();
    const run=vi.fn<DailyDiagnosticPort>(async(req,src)=>{const r=await runS1dDiagnostic(req,src);ctl.abort();return r;});
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,ctl.signal,run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report).toEqual(makeDailyUnavailable('ABORTED'));
  });
  it('binding changed before publication returns a fresh BINDING_INVALID report',async()=>{
    const f=await makeAdvisoryFixture();
    let changed=false;
    const ports:DailyPreflightPorts={...f.preflight,reloadOwnerConfig:async s=>changed?{state:'OFF',reason:'APPROVAL_DIGEST_MISMATCH'}:f.preflight.reloadOwnerConfig(s)};
    const run=vi.fn<DailyDiagnosticPort>(async(req,src)=>{const r=await runS1dDiagnostic(req,src);changed=true;return r;});
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',ports,sig(),run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report).toEqual(makeDailyUnavailable('BINDING_INVALID'));
  });
  it('runtime revalidation failure before publication returns BINDING_INVALID',async()=>{
    const f=await makeAdvisoryFixture();
    const run=vi.fn<DailyDiagnosticPort>(async(req,src)=>{const r=await runS1dDiagnostic(req,src);f.f.setRuntimeCheck({state:'UNAVAILABLE',reason:'HOST_MISMATCH'});return r;});
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,sig(),run);
    expect(report).toEqual(makeDailyUnavailable('BINDING_INVALID'));
  });
  it('S1-a identity drift in the returned report returns BINDING_INVALID',async()=>{
    const f=await makeAdvisoryFixture();
    const run=vi.fn<DailyDiagnosticPort>(async(req,src)=>{
      const r=await runS1dDiagnostic(req,src);
      if(r.stages.s1a.state!=='EVALUATED')throw Error('fixture expects evaluated S1-a');
      return {...r,stages:{...r.stages,s1a:{state:'EVALUATED',result:{...r.stages.s1a.result,manifestDigestMatch:false}}}} as S1dReportV1;
    });
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,sig(),run);
    expect(report).toEqual(makeDailyUnavailable('BINDING_INVALID'));
  });
  it('S1-b INPUT_REJECTED / BASELINE_UNKNOWN map to REJECTED / UNAVAILABLE evidence without coverage',async()=>{
    const f=await makeAdvisoryFixture();
    const patched=(status:'INPUT_REJECTED'|'BASELINE_UNKNOWN')=>vi.fn<DailyDiagnosticPort>(async(req,src)=>{
      const r=await runS1dDiagnostic(req,src);
      if(r.stages.s1b.state!=='EVALUATED')throw Error('fixture expects evaluated S1-b');
      return {...r,stages:{...r.stages,s1b:{state:'EVALUATED',result:{...r.stages.s1b.result,evaluationStatus:status}}}} as S1dReportV1;
    });
    const rej=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,sig(),patched('INPUT_REJECTED'));
    expect(rej.state).toBe('LIMITED');
    expect(rej.evidence).toEqual({state:'REJECTED',diagnostics:[],reasons:['SOURCE_REJECTED']});
    expect(rej.scope).toEqual(s1cOutside);
    const unk=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,sig(),patched('BASELINE_UNKNOWN'));
    expect(unk.state).toBe('LIMITED');
    expect(unk.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['DIAGNOSTIC_UNAVAILABLE']});
  });
});

describe('daily advisory: boundary handling',()=>{
  it('boundary UNCERTAIN never permits DIAGNOSED',async()=>{
    const f=await makeAdvisoryFixture();
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'UNCERTAIN',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(report.state).toBe('LIMITED');
    expect(report.boundary).toBe('UNCERTAIN');
    expect(report.reasons).toEqual(['BOUNDARY_UNCERTAIN']);
    expect(report.scope).toEqual(s1cOutside);
  });
  it('markDailyBoundaryUncertain downgrades DIAGNOSED and keeps known scope',async()=>{
    const f=await makeAdvisoryFixture();
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(report.state).toBe('DIAGNOSED');
    const marked=markDailyBoundaryUncertain(report,'BOUNDARY_UNCERTAIN');
    expect(marked.state).toBe('LIMITED');
    expect(marked.boundary).toBe('UNCERTAIN');
    expect(marked.scope).toEqual(report.scope);
    expect(marked.evidence).toEqual(report.evidence);
    expect(marked.reasons).toEqual(['BOUNDARY_UNCERTAIN']);
    expect(report.state).toBe('DIAGNOSED'); // prior report not mutated
    expectSafe(marked);
  });
  it('late observation makes evidence UNAVAILABLE while keeping bounded known scope',async()=>{
    const f=await makeAdvisoryFixture();
    const report=await runDailyAdvisory(f.binding,f.fullEvidence,f.validGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    const marked=markDailyBoundaryUncertain(report,'LATE_OBSERVATION');
    expect(marked.state).toBe('LIMITED');
    expect(marked.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['LATE_OBSERVATION']});
    expect(marked.scope).toEqual(s1cOutside);
    expect(marked.reasons).toEqual(['LATE_OBSERVATION']);
    expectSafe(marked);
  });
  it('late observation with no evaluated scope left is UNAVAILABLE before publication (design §4.4)',async()=>{
    const f=await makeAdvisoryFixture();
    const report=await runDailyAdvisory(f.binding,f.validEvidence,f.missingGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(report.state).toBe('LIMITED');
    expect(report.evidence.state).toBe('VALID');
    const marked=markDailyBoundaryUncertain(report,'LATE_OBSERVATION');
    expect(marked.state).toBe('UNAVAILABLE');
    expect(marked.boundary).toBe('UNCERTAIN');
    expect(marked.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['LATE_OBSERVATION']});
    expect(marked.scope).toEqual(report.scope);
    expect(marked.reasons).toContain('LATE_OBSERVATION');
    expect(report.state).toBe('LIMITED'); // prior report not mutated
    expectSafe(marked);
  });
  it('a late observation after the report was returned keeps LIMITED (design §4.3 TERMINAL rule)',async()=>{
    const f=await makeAdvisoryFixture();
    const report=await runDailyAdvisory(f.binding,f.validEvidence,f.missingGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    const marked=markDailyBoundaryUncertain(report,'LATE_OBSERVATION',{afterReturn:true});
    expect(marked.state).toBe('LIMITED');
    expect(marked.evidence).toEqual({state:'UNAVAILABLE',diagnostics:[],reasons:['LATE_OBSERVATION']});
    const un=markDailyBoundaryUncertain(makeDailyUnavailable('BINDING_INVALID'),'LATE_OBSERVATION',{afterReturn:true});
    expect(un.state).toBe('UNAVAILABLE');
  });
  it('LIMITED and UNAVAILABLE keep their state',async()=>{
    const f=await makeAdvisoryFixture();
    const limited=await runDailyAdvisory(f.binding,f.validEvidence,f.validGit,'BOUNDED',f.preflight,sig(),vi.fn(runS1dDiagnostic));
    expect(markDailyBoundaryUncertain(limited,'BOUNDARY_UNCERTAIN').state).toBe('LIMITED');
    const un=makeDailyUnavailable('BINDING_INVALID');
    const markedUn=markDailyBoundaryUncertain(un,'BOUNDARY_UNCERTAIN');
    expect(markedUn.state).toBe('UNAVAILABLE');
    expect(markedUn.evidence).toEqual(un.evidence);
    expect(markedUn.scope).toEqual(un.scope);
  });
  it('makeDailyUnavailable carries only fixed labels and the reason',()=>{
    expect(makeDailyUnavailable('TIMEOUT')).toEqual({
      state:'UNAVAILABLE',schemaVersion:'justice-daily-advisory-v1',taskRef:null,scopeKey:null,boundary:'NOT_EVALUATED',
      evidence:{state:'NOT_EVALUATED',diagnostics:[],reasons:['TIMEOUT']},
      scope:{state:'NOT_EVALUATED',comparison:'UNKNOWN',reason:'TIMEOUT'},
      changeSetOrigin:'UNAVAILABLE',nativeDiffProjection:'UNAVAILABLE',formalVerdict:'UNKNOWN',ownerAuthorityStatus:'NOT_PROVEN',
      coverageCompleteness:'NOT_ESTABLISHED',reasons:['TIMEOUT'],s1cCodes:[],limitations:[],
    });
    expectSafe(makeDailyUnavailable('TIMEOUT'));
  });
});
