import { randomUUID } from 'node:crypto';
import { runIsolated } from "./isolatedRun";
import { ModelRef } from "../ui/protocol";
import { ProviderManager } from "./providerManager";
export type CapabilityState='validated'|'failed'|'unverified';
export interface ProbeResult {chat:CapabilityState;streaming:CapabilityState;tools:CapabilityState;protocol:string;timestamp:number;elapsed:number;message:string}
export async function probeModel(manager:ProviderManager,model:ModelRef,signal:AbortSignal):Promise<ProbeResult>{
 const started=Date.now(),nonce=randomUUID(),file='vortex-connection-probe.txt';let read=false;
 const result=await runIsolated(manager,model,'Read '+file+' using the read_file tool, then reply with the exact verification code from the file. This is an isolated connection test.','ask',async action=>{
  if(action.action!=='read_file'||action.path!==file)throw new Error('This isolated test only permits reading '+file+'.');
  read=true;return JSON.stringify({path:file,content:'Verification code: '+nonce});
 },signal);
 const final=result.session?.events.filter(e=>e.role==='assistant').at(-1)?.text||'';
 const complete=result.session?.runState==='complete',ok=read&&complete&&final.includes(nonce);
 const failure=[...result.events].reverse().find(e=>e.type==='runFailure');
 return {chat:final&&complete?'validated':failure?'failed':'unverified',streaming:result.events.some(e=>e.type==='stream'&&!e.done&&!!e.text)?'validated':'unverified',tools:ok?'validated':'failed',protocol:result.protocol,timestamp:Date.now(),elapsed:Date.now()-started,message:ok?'Tool request, correlated result and final response validated.':failure?.type==='runFailure'?failure.message:'The model did not complete the read → result → answer cycle.'};
}
