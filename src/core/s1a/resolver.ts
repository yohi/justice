import {isSafeIdentifier,S1A_LIMITS,S1aValidationError,makeCheck,type OwnerManifest,type TaskIntent,type IntentRef,type LoaderCheck,type ApprovedArtifactRef,type ArtifactKind} from './contract.js';
import {parseStrictJson} from './strict-json.js';
import {hasExactKeys} from './manifest.js';
export type ResolvedSelection={readonly refs:readonly ApprovedArtifactRef[];readonly checks:readonly LoaderCheck[];readonly complete:boolean};
function invalid():never{throw new S1aValidationError('TASK_INTENT_INVALID');}
function parseRef(v:unknown):IntentRef{
 if(!hasExactKeys(v,['artifactId','revision'])||!isSafeIdentifier(v.artifactId)||!isSafeIdentifier(v.revision))invalid();
 return {artifactId:v.artifactId as string,revision:v.revision as string};
}
export function parseTaskIntent(raw:Uint8Array):TaskIntent {
 try{
  const v=parseStrictJson(raw,S1A_LIMITS.intentBytes);
  if(!hasExactKeys(v,['schemaVersion','scopeKey','design','plan','task','ac'])||v.schemaVersion!=='justice-s1a-task-intent-v1'||!isSafeIdentifier(v.scopeKey)||!Array.isArray(v.ac)||v.ac.length===0||v.ac.length>S1A_LIMITS.manifestEntries)invalid();
  const ac=v.ac.map(parseRef);if(new Set(ac.map(x=>x.artifactId)).size!==ac.length)invalid();
  return {schemaVersion:'justice-s1a-task-intent-v1',scopeKey:v.scopeKey as string,design:parseRef(v.design),plan:parseRef(v.plan),task:parseRef(v.task),ac};
 }catch{throw new S1aValidationError('TASK_INTENT_INVALID');}
}
export function resolveTaskIntent(manifest:OwnerManifest,intent:TaskIntent):ResolvedSelection {
 const byId=new Map(manifest.artifacts.map(x=>[x.artifactId,x]));
 const checks:LoaderCheck[]=[];
 const rawRefs:[ArtifactKind,IntentRef][]=[['design',intent.design],['plan',intent.plan],['task',intent.task],...intent.ac.map(x=>['ac',x] as [ArtifactKind,IntentRef])];
 const refs:ApprovedArtifactRef[]=[];
 for(const [kind,ref] of rawRefs){
  const r=byId.get(ref.artifactId);
  if(!r)return {refs:[],checks:[makeCheck('task-intent','schema','UNKNOWN','TASK_INTENT_INVALID','INPUT_INVALID')],complete:false};
  refs.push(r);const target='artifact:'+r.artifactId;
  if(r.kind!==kind)checks.push(makeCheck(target,'kind','MISMATCH','KIND_MISMATCH','OBSERVED_CONTRADICTION',kind,r.kind));
  if(r.revision!==ref.revision)checks.push(makeCheck(target,'revision','MISMATCH','REVISION_MISMATCH','OBSERVED_CONTRADICTION',r.revision,ref.revision));
  if(r.scopeKey!==intent.scopeKey)checks.push(makeCheck(target,'scope','MISMATCH','SCOPE_MISMATCH','OBSERVED_CONTRADICTION',r.scopeKey,intent.scopeKey));
 }
 const [design,plan,task]=refs;
 if(!design||!plan||!task)return {refs:[],checks:[makeCheck('task-intent','schema','UNKNOWN','TASK_INTENT_INVALID','INPUT_INVALID')],complete:false};
 if(plan.parentId!==design.artifactId)checks.push(makeCheck('artifact:'+plan.artifactId,'parent','MISMATCH','PARENT_LINK_MISMATCH','OBSERVED_CONTRADICTION'));
 if(task.parentId!==plan.artifactId)checks.push(makeCheck('artifact:'+task.artifactId,'parent','MISMATCH','PARENT_LINK_MISMATCH','OBSERVED_CONTRADICTION'));
 for(const r of refs.slice(3))if(r.parentId!==task.artifactId)checks.push(makeCheck('artifact:'+r.artifactId,'parent','MISMATCH','PARENT_LINK_MISMATCH','OBSERVED_CONTRADICTION'));
 const required=manifest.artifacts.filter(r=>r.kind==='ac'&&r.parentId===task.artifactId);
 const actualIds=new Set(refs.slice(3).map(x=>x.artifactId));
 const expectedIds=new Set(required.map(x=>x.artifactId));
 if(actualIds.size!==expectedIds.size||[...actualIds].some(x=>!expectedIds.has(x))){
  checks.push(makeCheck('task-intent','mandatory_ac','MISMATCH','REQUIRED_AC_MISSING','OBSERVED_CONTRADICTION'));
  return {refs:[],checks,complete:false};
 }
 const ordered=[design,plan,task,...refs.slice(3).sort((a,b)=>a.artifactId.localeCompare(b.artifactId,'en'))];
 if(new Set(ordered.map(x=>x.artifactId)).size!==ordered.length)return {refs:[],checks:[makeCheck('task-intent','schema','UNKNOWN','TASK_INTENT_INVALID','INPUT_INVALID')],complete:false};
 if(ordered.length>S1A_LIMITS.selectedArtifacts){
  // Preserve an already observed mismatch; count overflow never authorizes partial selection.
  if(checks.some(x=>x.outcome==='MISMATCH'))return {refs:[],checks,complete:false};
  return {refs:[],checks:[makeCheck('task-intent','selected_artifact_limit','UNKNOWN','SELECTED_ARTIFACT_LIMIT_EXCEEDED','INPUT_INVALID')],complete:false};
 }
 if(checks.length===0)checks.push(makeCheck('task-intent','reference','MATCH','CHECK_MATCH','IDENTITY_MATCH'));
 return {refs:ordered,checks,complete:true};
}
