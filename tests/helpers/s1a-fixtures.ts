import {createHash} from 'node:crypto';
import type {OwnerManifest,TaskIntent,S1aReadOnlySource,LoaderInput} from '../../src/core/s1a/contract.js';
export const sha256=(bytes:Uint8Array|string):string=>createHash('sha256').update(bytes).digest('hex');
export const jsonBytes=(v:unknown):Uint8Array=>Buffer.from(JSON.stringify(v));
export function s1aFixture():{readonly manifest:OwnerManifest;readonly intent:TaskIntent;readonly files:Readonly<Record<string,Uint8Array>>;readonly input:LoaderInput;readonly source:S1aReadOnlySource}{
 const defs:[string,'design'|'plan'|'task'|'ac',string?][]=[['design-1','design'],['plan-1','plan','design-1'],['task-1','task','plan-1'],['ac-1','ac','task-1'],['ac-2','ac','task-1']];
 const files:Record<string,Uint8Array>={};
 const artifacts=defs.map(([artifactId,kind,parentId])=>{
   files[artifactId+'.md']=Buffer.from(artifactId);
   return {...{artifactId,kind,revision:'R1',digest:{algorithm:'sha256' as const,hex:sha256(files[artifactId+'.md']!)},relativePath:artifactId+'.md',scopeKey:'scope-1',approvalRef:'untrusted-reference'},...(parentId?{parentId}:{})};
 });
 const manifest:OwnerManifest={schemaVersion:'justice-s1a-manifest-v1',manifestId:'fixture-1',artifacts};
 const intent:TaskIntent={schemaVersion:'justice-s1a-task-intent-v1',scopeKey:'scope-1',design:{artifactId:'design-1',revision:'R1'},plan:{artifactId:'plan-1',revision:'R1'},task:{artifactId:'task-1',revision:'R1'},ac:[{artifactId:'ac-1',revision:'R1'},{artifactId:'ac-2',revision:'R1'}]};
 const input:LoaderInput={manifestPath:'manifest',expectedManifestSha256:sha256(jsonBytes(manifest)),intentPath:'intent',artifactsRoot:'root'};
 const source:S1aReadOnlySource={async readInputFile(p){return jsonBytes(p==='manifest'?manifest:intent);},async readArtifact(_root,p,maxBytes){const raw=files[p];if(!raw)throw Error('unreadable');if(raw.length>maxBytes)throw Object.assign(Error('over_limit'),{kind:'over_limit'});return raw;}};
 return {manifest,intent,files,input,source};
}
