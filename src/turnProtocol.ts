import {randomUUID} from 'node:crypto';
import {Action,validateAction,toolDefinitions} from './actions';
import {decodeReply} from './reply';
import {Mode} from './policy';
import {Turn} from './native';

// The legacy text protocol is a boundary adapter, not a separate execution loop.
export function compatibilityTurn(reply:string,mode:Mode,conversationOnly=false):Turn {
 const action=decodeReply(reply,mode,conversationOnly);
 if(action.action==='finish')return {kind:'final',stopReason:'stop',text:action.text,calls:[]};
 const {action:name,...args}=action;
 return {kind:'tool_use',stopReason:'tool_use',text:'',calls:[{id:randomUUID(),name,arguments:args}]};
}
export function turnActions(turn:Turn,mode:Mode,conversationOnly=false):Action[]{
 const allowed=new Set(toolDefinitions(mode,conversationOnly).map(t=>t.name));
 if(turn.kind==='final'&&turn.calls.length||turn.kind==='tool_use'&&!turn.calls.length)throw new Error('Inconsistent model response state.');
 if(turn.calls.some(c=>!allowed.has(c.name)))throw new Error('Tool not exposed in this mode.');
 // Validate the whole batch before executing anything, including its first read.
 return turn.calls.length?turn.calls.map(c=>validateAction({...c.arguments as object,action:c.name},mode,conversationOnly)):[validateAction({action:'finish',text:turn.text},mode,conversationOnly)];
}
