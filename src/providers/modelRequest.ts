import {randomUUID} from 'node:crypto';
import type {PlanState} from "../plan/plan";
import type {Client,Message} from "./providers";
import type {ToolDefinition} from "../tools/actions";

export function requestBinding(sessionId:string,runId:string,plan?:PlanState){
 return Object.freeze({request_id:randomUUID(),session_id:sessionId,run_id:runId,plan_id:plan?.plan_id,plan_version:plan?.version,execution_id:plan?.execution_id,step_id:plan?.active_step,attempt:plan?.executions.find(e=>e.id===plan.active_step)?.attempts.at(-1)?.number});
}
export function assertRequestBinding(binding:ReturnType<typeof requestBinding>,sessionId:string,runId:string,signal:AbortSignal,plan?:PlanState){
 signal.throwIfAborted();const current=requestBinding(sessionId,runId,plan);
 for(const key of Object.keys(binding) as (keyof typeof binding)[])if(key!=='request_id'&&binding[key]!==current[key])throw new Error('Discarded a response from an obsolete execution.');
}

/** Provider I/O cannot mutate orchestration state; its caller supplies a captured request guard. */
export async function requestModel(client:Pick<Client,'turn'|'chat'>,options:{native:boolean;model:string;system:string;messages:Message[];signal:AbortSignal;budget:{tokens:number;output:number};tools:ToolDefinition[];assertCurrent:()=>void;onText:(text:string)=>void}){
 const o=options;o.assertCurrent();
 if(o.native){const turn=await client.turn(o.model,o.system,o.messages,o.signal,o.budget,o.tools,text=>{if(!o.signal.aborted)o.onText(text);});o.assertCurrent();return {turn,reply:turn.text};}
 const reply=await client.chat(o.model,o.system,o.messages,o.signal,o.budget);o.assertCurrent();return {turn:undefined,reply};
}
