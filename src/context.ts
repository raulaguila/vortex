import {Message} from './providers';
export const estimateTokens = (text:string):number => Buffer.byteLength(text,'utf8')+16;
// Conservative byte estimate, not a provider-specific tokenizer.
export function fitContext(system:string,messages:Message[],window:number,output:number,currentTurnStart=0){
  const budget=window-output-128;
  const result=messages.map(m=>({...m}));
  let removed=0;
  const size=()=>estimateTokens(system)+result.reduce((n,m)=>n+estimateTokens(m.content),0);
  // Drop completed turns first. The current user message must never be evicted.
  if(size()>budget && currentTurnStart>0){
    result.splice(0,currentTurnStart);removed+=currentTurnStart;
  }
  // Within a long turn, discard oldest action/result pairs, keeping its request and latest result.
  while(result.length>3 && size()>budget){
    const count=result[1].role==='assistant' && result[2].role==='user'?2:1;
    result.splice(1,count);removed+=count;
  }
  if(size()>budget)throw new Error('The current request exceeds the context budget. Shorten it or increase the model context setting.');
  return {messages:result,used:size(),budget:window,removed};
}
