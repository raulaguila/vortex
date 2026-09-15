import {Action,validateAction} from './actions';
import {Mode} from './policy';

// Text replies can end a turn, but only a complete, validated JSON object can invoke a tool.
export function decodeReply(reply:string,mode:Mode,conversationOnly=false):Action {
  const text=reply.trim().replace(/^<think>[\s\S]*?<\/think>\s*/,'');
  if(!text||text.startsWith('<think>'))throw new Error('The model returned no answer.');
  const raw=text.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1').trim();
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}
  catch{
    if(/^[{\[]/.test(raw)||/^```(?:json)?\s*[{\[]/i.test(raw))throw new Error('Incomplete JSON action. Return one complete action object.');
    return validateAction({action:'finish',text},mode,conversationOnly);
  }
  return validateAction(parsed,mode,conversationOnly);
}
