import {S1A_LIMITS} from './contract.js';
/** Decode strict UTF-8; scan every object recursively for duplicate decoded keys before JSON.parse. */
export function parseStrictJson(bytes:Uint8Array,maxBytes:number):unknown {
 if(bytes.byteLength>maxBytes)throw Error('JSON_INVALID');
 let source:string;
 try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error('JSON_INVALID');}
 let i=0;
 const fail=()=>{throw Error('JSON_INVALID')};
 const ws=()=>{while(/[\s]/.test(source[i]??'')&&i<source.length)i++;};
 const stringToken=():string=>{
  if(source[i]!=='"')fail();const start=i++;
  for(;i<source.length;i++){
   if(source[i]==='\\'){i++;continue;}
   if(source[i]==='"'){i++;try{return JSON.parse(source.slice(start,i)) as string;}catch{return fail();}}
  }
  return fail();
 };
 const value=(depth:number):void=>{
  if(depth>S1A_LIMITS.jsonDepth)fail();ws();const token=source[i];
  if(token==='{'){
   i++;ws();const seen=new Set<string>();if(source[i]==='}'){i++;return;}
   for(;;){ws();const key=stringToken();if(seen.has(key))fail();seen.add(key);ws();if(source[i++]!==':')fail();value(depth+1);ws();const delim=source[i++];if(delim==='}')return;if(delim!==',')fail();}
  }
  if(token==='['){i++;ws();if(source[i]===']'){i++;return;}for(;;){value(depth+1);ws();const delim=source[i++];if(delim===']')return;if(delim!==',')fail();}}
  if(token==='"'){stringToken();return;}
  if(token===undefined)fail();const start=i;while(i<source.length && !/[\s,}\]]/.test(source[i]??''))i++;if(start===i)fail();
 };
 try{ws();value(0);ws();if(i!==source.length)fail();return JSON.parse(source) as unknown;}catch{throw Error('JSON_INVALID');}
}
