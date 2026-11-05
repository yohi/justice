export type ArtifactKind = 'design' | 'plan' | 'task' | 'ac';
export type IdentityStatus = 'MATCH' | 'MISMATCH' | 'UNKNOWN';
export type ReasonCategory = 'IDENTITY_MATCH' | 'INPUT_INVALID' | 'CHECK_INCOMPLETE' | 'OBSERVED_CONTRADICTION';
export type ReasonCode =
  | 'CHECK_MATCH' | 'IDENTITY_MATCH_WITH_AUTHORITY_LIMITATION'
  | 'CLI_ARGUMENT_INVALID' | 'MANIFEST_DIGEST_REQUIRED' | 'MANIFEST_DIGEST_FORMAT_INVALID'
  | 'MANIFEST_UNREADABLE' | 'MANIFEST_DIGEST_MISMATCH' | 'MANIFEST_INVALID'
  | 'TASK_INTENT_UNREADABLE' | 'TASK_INTENT_INVALID'
  | 'KIND_MISMATCH' | 'REVISION_MISMATCH' | 'SCOPE_MISMATCH' | 'PARENT_LINK_MISMATCH' | 'REQUIRED_AC_MISSING'
  | 'ARTIFACT_UNREADABLE' | 'ARTIFACT_DIGEST_MISMATCH'
  | 'SELECTED_ARTIFACT_LIMIT_EXCEEDED' | 'TOTAL_ARTIFACT_LIMIT_EXCEEDED' | 'ARTIFACT_SIZE_LIMIT_EXCEEDED';
export const S1A_LIMITS = Object.freeze({
  manifestBytes: 1_048_576, intentBytes: 65_536, artifactBytes: 8_388_608,
  totalArtifactBytes: 33_554_432, manifestEntries: 512,
  selectedArtifacts: 128, jsonDepth: 32, relativePathLength: 1024,
} as const);
export const LIMITATIONS = Object.freeze(['OWNER_ORIGIN_NOT_VERIFIED','SUPERSESSION_NOT_CHECKED','HOST_EXECUTION_NOT_PROVEN','FILESYSTEM_RACE_FREEDOM_NOT_PROVEN'] as const);
export class S1aValidationError extends Error {
  constructor(readonly reasonCode: 'MANIFEST_INVALID' | 'TASK_INTENT_INVALID') {super(reasonCode);this.name='S1aValidationError';}
}
export function isLowercaseSha256Hex(value:unknown):value is string {return typeof value==='string' && /^[0-9a-f]{64}$/.test(value);}
export function isSafeIdentifier(value:unknown):value is string {return typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);}
export type Sha256Digest = {readonly algorithm:'sha256';readonly hex:string};
export interface ApprovedArtifactRef {
 readonly artifactId:string;readonly kind:ArtifactKind;readonly revision:string;readonly digest:Sha256Digest;
 readonly relativePath:string;readonly scopeKey:string;readonly approvalRef:string;readonly parentId?:string;
}
export interface OwnerManifest {readonly schemaVersion:'justice-s1a-manifest-v1';readonly manifestId:string;readonly artifacts:readonly ApprovedArtifactRef[];}
export interface IntentRef {readonly artifactId:string;readonly revision:string;}
export interface TaskIntent {readonly schemaVersion:'justice-s1a-task-intent-v1';readonly scopeKey:string;readonly design:IntentRef;readonly plan:IntentRef;readonly task:IntentRef;readonly ac:readonly IntentRef[];}
export type S1aCheckKind='schema'|'cli_arguments'|'manifest_digest'|'reference'|'revision'|'scope'|'kind'|'parent'|'mandatory_ac'|'artifact_digest'|'selected_artifact_limit'|'total_artifact_bytes';
export interface LoaderCheck {readonly targetId:string;readonly check:S1aCheckKind;readonly outcome:IdentityStatus;readonly reasonCode:ReasonCode;readonly category:ReasonCategory;readonly expected?:string;readonly observed?:string;}
export interface SelectedArtifactRef {readonly artifactId:string;readonly kind:ArtifactKind;readonly revision:string;readonly scopeKey:string;readonly parentId?:string;readonly expectedDigest:string;readonly observedDigest:string|null;readonly digestOutcome:IdentityStatus;}
export interface LoaderResult {readonly schemaVersion:'justice-s1a-result-v1';readonly manifestId?:string;readonly manifestDigestMatch:boolean|'unknown';readonly identityStatus:IdentityStatus;readonly ownerAuthorityStatus:'NOT_PROVEN';readonly ownerTrustPrecondition:'EXTERNAL_NOT_VERIFIED_BY_S1A';readonly identityCandidateReady:boolean;readonly eligibleBaseline:false;readonly selectedRefs:readonly SelectedArtifactRef[];readonly checks:readonly LoaderCheck[];readonly limitations:readonly string[];}
export interface S1aReadOnlySource {readInputFile(path:string,maxBytes:number):Promise<Uint8Array>;readArtifact(root:string,relativePath:string,maxBytes:number):Promise<Uint8Array>;}
export interface LoaderInput {readonly manifestPath:string;readonly expectedManifestSha256?:string;readonly intentPath:string;readonly artifactsRoot:string;}
export function freezeLoaderResult(result:LoaderResult):LoaderResult {
 const refs=result.selectedRefs.map(x=>Object.freeze({...x}));const checks=result.checks.map(x=>Object.freeze({...x}));
 return Object.freeze({...result,selectedRefs:Object.freeze(refs),checks:Object.freeze(checks),limitations:Object.freeze([...result.limitations])});
}
export function makeCheck(targetId:string,check:S1aCheckKind,outcome:IdentityStatus,reasonCode:ReasonCode,category:ReasonCategory,expected?:string,observed?:string):LoaderCheck {
 // No unchecked caller-origin data is allowed into targetId/expected/observed.
 if(targetId!=='manifest' && targetId!=='task-intent' && !(/^artifact:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(targetId))) throw Error('INTERNAL_UNSAFE_DIAGNOSTIC');
 const safe=(v:string|undefined)=>v===undefined||isSafeIdentifier(v)||isLowercaseSha256Hex(v);
 if(!safe(expected)||!safe(observed))throw Error('INTERNAL_UNSAFE_DIAGNOSTIC');
 return {...{targetId,check,outcome,reasonCode,category},...(expected!==undefined?{expected}:{}),...(observed!==undefined?{observed}:{})};
}
