import {randomUUID} from 'node:crypto';
import {Action,validateAction,decodeAction,toolDefinitions,allowedActions,registry} from './actions';
import {decodeReply} from './reply';
import {Mode} from './policy';
import {Turn} from './native';
import type {Message,Kind} from './providers';

// The legacy text protocol is a boundary adapter, not a separate execution loop.
export function compatibilityTurn(reply:string,mode:Mode,conversationOnly=false):Turn {
 const action=decodeReply(reply,mode,conversationOnly);
 if(action.action==='finish')return {kind:'final',stopReason:'stop',text:action.text,calls:[]};
 const {action:name,...args}=action;
 return {kind:'tool_use',stopReason:'tool_use',text:'',calls:[{id:randomUUID(),name,arguments:args}]};
}
export function turnActions(turn:Turn,mode:Mode,conversationOnly=false,activeStep=false):Action[]{
 const allowed=new Set(toolDefinitions(mode,conversationOnly,activeStep).map(t=>t.name));
 if(turn.kind==='final'&&turn.calls.length||turn.kind==='tool_use'&&!turn.calls.length)throw new Error('Inconsistent model response state.');
 if(turn.calls.length>1&&turn.calls.some(c=>['propose_plan','report_step_result'].includes(c.name)))throw new Error('Plan transitions must be the only tool call in the response.');
 const unavailable=turn.calls.find(c=>!allowed.has(c.name));
 if(unavailable)throw new Error('Tool '+JSON.stringify(unavailable.name.slice(0,80))+' is not exposed in '+mode+' mode. Allowed tools: '+[...allowed].join(', ')+'. Return a direct answer when no tool is needed.');
 for(const call of turn.calls)if(!call.arguments||typeof call.arguments!=='object'||Array.isArray(call.arguments))throw new Error('Invalid '+call.name+' arguments: expected an object matching the tool schema.');
 // Validate the whole batch before executing anything, including its first read.
 return turn.calls.length?turn.calls.map(c=>decodeAction({...c.arguments as object,action:c.name},mode,conversationOnly)):[validateAction({action:'finish',text:turn.text},mode,conversationOnly)];
}

/** Rejected calls still need a response with the original call ID before another model turn. */
export function rejectionFeedback(reply:string,turn:Turn|undefined,mode:Mode,conversationOnly:boolean,native:boolean,kind:Kind,reason:string,planRequired=false,activeStep=false):Message[]{
 const correction='Host validation feedback (not a new user request or authorization): '+reason+' No calls from this rejected response were executed. '+(activeStep?'Continue the approved active step using the observed results above. Correct the tool request, perform missing work or report a concrete blocker. Plain text does not finish this step.':planRequired?'No valid plan has been accepted for this request. Correct and resend propose_plan as the only call. Each criterion requires description and verification; command verification also requires command. The host assigns IDs and defaults cwd to dot. Markdown cannot create or revise the visible plan. Do not claim the proposal succeeded or tell the user to switch modes. Use ask_user if essential information is missing. Example arguments (adapt to actual evidence; do not assume this test command exists): '+JSON.stringify(registry.propose_plan.example)+'.':'Correct the request within the current mode, or answer the original question directly.')+' Never repeat a rejected action unchanged or claim it ran.';
 if(native&&turn){
  const assistant:Message={role:'assistant',content:turn.text,toolCalls:turn.calls,continuation:turn.continuation,continuationKind:kind};
  return [...(turn.text||turn.calls.length?[assistant]:[]),...(turn.calls.length?turn.calls.map(call=>({role:'user' as const,content:correction,toolResult:{id:call.id,name:call.name,status:'error' as const,output:correction}})):[{role:'user' as const,origin:'vortex_orchestrator' as const,content:correction}])];
 }
 return [...(reply.trim()?[{role:'assistant' as const,content:reply}]:[]),{role:'user',origin:'vortex_orchestrator',content:correction+' Return exactly one complete JSON object with an "action" field and its top-level arguments. Allowed actions: '+allowedActions(mode,conversationOnly).join(', ')+'.'+(planRequired||activeStep?'':' For a normal answer use {"action":"finish","text":"your answer"}.')}];
}
