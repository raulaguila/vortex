import { randomUUID } from 'node:crypto';
import { Action } from './actions';
import { AgentRuntime,RuntimeHost } from './agentRuntime';
import { migrateExecution } from './execution';
import { Mode } from './policy';
import { ModelRef,Response } from './protocol';
import { ProviderManager } from './providerManager';
import { Session,SessionStore } from './sessions';

/** Same runtime and protocols as the sidebar, with a fixture executor and no workspace access. */
export async function runIsolated(manager:ProviderManager,model:ModelRef,prompt:string,mode:Mode,execute:RuntimeHost['execute'],signal:AbortSignal){
 const events:Response[]=[],calls:Action[]=[];let saved:Session|undefined;
 const preferences=manager.preferences(),limits=migrateExecution(preferences.execution);
 let protocol=manager.toolProtocol(model);
 const providers={
  client:(id:string)=>manager.client(id),providers:()=>manager.providers(),
  preferences:()=>({...preferences,execution:{...limits,maxRounds:4,maxToolCalls:3,taskTimeout:Math.min(120,limits.taskTimeout)}}),
  ensureLimits:(ref:ModelRef,s?:AbortSignal)=>manager.ensureLimits(ref,s),contextBudget:(ref:ModelRef)=>manager.contextBudget(ref),
  toolProtocol:()=>protocol,
  fallbackTools:()=>{if(preferences.toolProtocols?.[JSON.stringify([model.providerId,model.modelId])]&&preferences.toolProtocols[JSON.stringify([model.providerId,model.modelId])]!=='auto')return false;protocol='compatibility';return true;}
 } as unknown as ProviderManager;
 const store={create:()=>({id:randomUUID(),title:prompt,updatedAt:Date.now(),events:[],messages:[],checklist:[],mode,permission:'supervised',model}),save:async(s:Session)=>{saved=structuredClone(s);}} as unknown as SessionStore;
 const host:RuntimeHost={trusted:()=>true,roots:()=>[],pickRoot:async()=>undefined,choosePermission:async()=>undefined,confirmUncertain:async()=>false,execute:async(...args)=>{calls.push(args[0]);return execute(...args);}};
 const runtime=new AgentRuntime(providers,e=>events.push(e),store,undefined,undefined,undefined,undefined,host);
 const stop=()=>runtime.stop();signal.throwIfAborted();signal.addEventListener('abort',stop,{once:true});
 try{await runtime.start({type:'start',requestId:randomUUID(),prompt,mode,permission:'supervised',model});}
 finally{signal.removeEventListener('abort',stop);runtime.dispose();}
 return {events,calls,session:saved,protocol};
}
