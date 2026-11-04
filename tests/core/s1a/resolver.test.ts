import {describe,it,expect} from 'vitest';
import {parseTaskIntent,resolveTaskIntent} from '../../../src/core/s1a/resolver.js';
import {s1aFixture,jsonBytes} from '../../helpers/s1a-fixtures.js';
describe('TaskIntent/mandatory AC resolution',()=>{
 it('resolvesOneDesignPlanTaskAndTwoAcs',()=>{
  const f=s1aFixture();expect(resolveTaskIntent(f.manifest,f.intent).refs.map(r=>r.kind)).toEqual(['design','plan','task','ac','ac']);
 });
 it('missingMandatoryAcNeverResolvesPartially',()=>{
  const f=s1aFixture();const resolved=resolveTaskIntent(f.manifest,{...f.intent,ac:[f.intent.ac[0]!]});
  expect(resolved.checks.map(x=>x.reasonCode)).toContain('REQUIRED_AC_MISSING');expect(resolved.complete).toBe(false);expect(resolved.refs).toEqual([]);
 });
 it('stalePlanRevisionNoFallback',()=>{
  const f=s1aFixture();const result=resolveTaskIntent(f.manifest,{...f.intent,plan:{...f.intent.plan,revision:'R0'}});
  expect(result.checks.map(x=>x.reasonCode)).toContain('REVISION_MISMATCH');expect(result.complete).toBe(true);
 });
 it('scopeAndParentConflict',()=>{
  const f=s1aFixture();const scope=resolveTaskIntent(f.manifest,{...f.intent,scopeKey:'scope-2'});
  expect(scope.checks.map(x=>x.reasonCode)).toContain('SCOPE_MISMATCH');
  const swapped={...f.intent,design:{artifactId:'design-1',revision:'R1'}};
  expect(resolveTaskIntent(f.manifest,swapped).complete).toBe(true);
 });
 it('rejectUnsafeIntentIdentifiers',()=>{
  const f=s1aFixture();for(const v of ['../token','S1\nBearer-secret','Y'.repeat(65)])
   expect(()=>parseTaskIntent(jsonBytes({...f.intent,scopeKey:v}))).toThrow('TASK_INTENT_INVALID');
 });
 it('selectedArtifactCountBoundary128And129',()=>{
  const f=s1aFixture();const m={...f.manifest,artifacts:f.manifest.artifacts.filter(x=>x.kind!=='ac')};const intent={...f.intent,ac:[] as {artifactId:string,revision:string}[]};
  for(let n=1;n<=126;n++){const id='ac-'+n;(m.artifacts as unknown as unknown[]).push({...f.manifest.artifacts[3],artifactId:id,relativePath:id+'.json'});intent.ac.push({artifactId:id,revision:'R1'});}
  const good=resolveTaskIntent({...m,artifacts:m.artifacts.slice(0,-1)},{...intent,ac:intent.ac.slice(0,-1)});
  expect(good.complete).toBe(true);expect(good.refs).toHaveLength(128);
  const bad=resolveTaskIntent(m,intent);expect(bad.complete).toBe(false);expect(bad.refs).toEqual([]);expect(bad.checks[0]?.reasonCode).toBe('SELECTED_ARTIFACT_LIMIT_EXCEEDED');
 });

 it('revisionMismatchAndUnknownAcKeepsObservedMismatch',()=>{
  const f=s1aFixture();const missing='ac-private-secret';
  const intent={...f.intent,plan:{...f.intent.plan,revision:'R0'},ac:[f.intent.ac[0]!,{artifactId:missing,revision:'R1'}]};
  const result=resolveTaskIntent(f.manifest,intent);
  expect(result.complete).toBe(false);expect(result.refs).toEqual([]);
  expect(result.checks.map(x=>x.reasonCode)).toContain('REVISION_MISMATCH');
  expect(result.checks.some(x=>x.outcome==='UNKNOWN')).toBe(true);
  expect(JSON.stringify(result)).not.toContain(missing);
 });
 it('wrongKindAndDuplicatedSelectedIdPreservesKindMismatch',()=>{
  const f=s1aFixture();const intent={...f.intent,plan:{artifactId:f.intent.design.artifactId,revision:'R1'}};
  const result=resolveTaskIntent(f.manifest,intent);
  expect(result.complete).toBe(false);expect(result.refs).toEqual([]);
  expect(result.checks.map(x=>x.reasonCode)).toContain('KIND_MISMATCH');
  expect(result.checks.some(x=>x.outcome==='UNKNOWN')).toBe(true);
 });
 it('onlyUnknownIncompleteRefsNeverReturnPartialSelection',()=>{
  const f=s1aFixture();const intent={...f.intent,ac:[f.intent.ac[0]!,{artifactId:'ac-not-registered',revision:'R1'}]};
  const result=resolveTaskIntent(f.manifest,intent);
  expect(result.complete).toBe(false);expect(result.refs).toEqual([]);
  expect(result.checks.some(x=>x.outcome==='MISMATCH')).toBe(false);
  expect(result.checks.some(x=>x.outcome==='UNKNOWN')).toBe(true);
 });
 it('positiveFixtureRemainsCompleteMatch',()=>{
  const f=s1aFixture();const result=resolveTaskIntent(f.manifest,f.intent);
  expect(result.complete).toBe(true);expect(result.refs).toHaveLength(5);
  expect(result.checks.every(x=>x.outcome==='MATCH')).toBe(true);
 });
});
