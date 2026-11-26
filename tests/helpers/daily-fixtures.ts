import type {TaskIntent,S1aReadOnlySource,OwnerManifest} from '../../src/core/s1a/contract.js';
import {
  DAILY_HOST_SHA256,DAILY_OWNER_ROOT,loadDailyOwnerConfig,
  type AcquisitionRule,type CheckResult,type DailyOwnerApproval,type DailyOwnerConfig,
  type DailyPreflightPorts,type OwnerConfigReadPort,
} from '../../src/runtime/daily-intent.js';
import {jsonBytes,s1aFixture,sha256} from './s1a-fixtures.js';

export type DailyFixture={
  approval:DailyOwnerApproval;approvalBytes:Uint8Array;expectedSha256:string;
  configPort:OwnerConfigReadPort;config:DailyOwnerConfig;ports:DailyPreflightPorts;
  source:S1aReadOnlySource;
  setApprovalBytes(bytes:Uint8Array):void;setArtifactBytes(path:string,bytes:Uint8Array):void;
  setRuntimeCheck(result:CheckResult):void;setCleanCheck(result:CheckResult):void;
};
export type DailyFixtureOptions={
  planText?:string;intent?:TaskIntent;
  approvalPatch?:Readonly<Record<string,unknown>>;
};
const HEADING='## Justice S1-c Task Scope Policies';
const BEGIN='<!-- justice:s1c-task-scope:begin -->';
const END='<!-- justice:s1c-task-scope:end -->';
export const defaultPolicy=()=>({schemaVersion:'justice-s1c-task-scope-v1',planRef:{artifactId:'plan-1',revision:'R1'},taskRef:{artifactId:'task-1',revision:'R1'},scopeKey:'scope-1',allowedPaths:['src/a.ts','tests/**']});
export const defaultPlanText=()=>`${HEADING}\n${BEGIN}\n${JSON.stringify(defaultPolicy())}\n${END}\n`;
const WORKTREE='/tmp/justice-daily-fixture';
const rule=(ruleId:string,ac:string,file:string):AcquisitionRule=>({ruleId,acRef:{artifactId:ac,revision:'R1'},purpose:'TEST_INVOCATION',tool:'shell',input:{command:`bun run vitest run tests/${file}`,workdir:WORKTREE,timeout:5000,background:false}});

/** TEST_ONLY approval; never live authority. */
export async function makeDailyFixture(options:DailyFixtureOptions={}):Promise<DailyFixture>{
  const base=s1aFixture();
  const files:Record<string,Uint8Array>={};
  for(const [k,v] of Object.entries(base.files))files[k]=Uint8Array.from(v);
  files['plan-1.md']=new TextEncoder().encode(options.planText??defaultPlanText());
  const manifest:OwnerManifest={...base.manifest,artifacts:base.manifest.artifacts.map(a=>a.artifactId==='plan-1'?{...a,digest:{algorithm:'sha256' as const,hex:sha256(files['plan-1.md']!)}}:a)};
  const intent=options.intent??base.intent;
  const manifestBytes=jsonBytes(manifest),intentBytes=jsonBytes(intent);
  const approval={
    schemaVersion:'justice-daily-owner-approval-v1',enabled:true,ownerDecisionRef:'owner-fixture-only',
    hostVersion:'2.3.2',hostBinarySha256:DAILY_HOST_SHA256,manifestSha256:sha256(manifestBytes),
    intentSha256:sha256(intentBytes),intent,rules:[rule('r1','ac-1','a.test.ts'),rule('r2','ac-2','b.test.ts')],
    sessionId:'ses_fixture001',worktreeRoot:WORKTREE,baseCommit:'a'.repeat(40),nativePort:49187,
    skill:{id:'skill-fixture',name:'executing-plans',path:'/tmp/justice-daily-fixture-skill/SKILL.md',contentSha256:sha256('fixture-skill')},
    ...(options.approvalPatch??{}),
  } as unknown as DailyOwnerApproval;
  let approvalBytes=jsonBytes(approval);
  const expectedSha256=sha256(approvalBytes);
  const config:DailyOwnerConfig={approval,approvalSha256:expectedSha256,loaderInput:{
    manifestPath:`${DAILY_OWNER_ROOT}/manifest.json`,intentPath:`${DAILY_OWNER_ROOT}/intent.json`,
    artifactsRoot:`${DAILY_OWNER_ROOT}/artifacts`,expectedManifestSha256:approval.manifestSha256}};
  let runtime:CheckResult={state:'OK'},clean:CheckResult={state:'OK'};
  const source:S1aReadOnlySource={
    async readInputFile(p,maxBytes){
      const raw=p===config.loaderInput.manifestPath?manifestBytes:p===config.loaderInput.intentPath?intentBytes:undefined;
      if(!raw)throw Error('unreadable');
      if(raw.length>maxBytes)throw Object.assign(Error('over_limit'),{kind:'over_limit'});
      return Uint8Array.from(raw);
    },
    async readArtifact(root,p,maxBytes){
      const raw=root===config.loaderInput.artifactsRoot?files[p]:undefined;
      if(!raw)throw Error('unreadable');
      if(raw.length>maxBytes)throw Object.assign(Error('over_limit'),{kind:'over_limit'});
      return Uint8Array.from(raw);
    },
  };
  const configPort:OwnerConfigReadPort={
    async verifyReadOnlyMount(){return {state:'OK'};},
    async readApproval(){return Uint8Array.from(approvalBytes);},
  };
  const ports:DailyPreflightPorts={
    reloadOwnerConfig:(signal)=>loadDailyOwnerConfig(expectedSha256,configPort,signal),
    source,
    async verifyRuntime(){return runtime;},
    async checkCleanBase(){return clean;},
  };
  return {
    approval,get approvalBytes(){return approvalBytes;},expectedSha256,configPort,config,ports,source,
    setApprovalBytes(bytes){approvalBytes=Uint8Array.from(bytes);},
    setArtifactBytes(path,bytes){files[path]=Uint8Array.from(bytes);},
    setRuntimeCheck(r){runtime=r;},setCleanCheck(r){clean=r;},
  };
}
