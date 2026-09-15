import type {Kind} from './providers';
// Accumulate structured deltas. No caller receives tool arguments until the stream ends.
export async function readStream(response:Response,kind:Kind,signal:AbortSignal,onText:(text:string)=>void):Promise<unknown>{
 if(!response.body)throw new Error('Empty stream.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',bytes=0,complete=false;
 const raw:any=kind==='anthropic'?{content:[]}:kind==='gemini'?{candidates:[{content:{parts:[]}}]}:kind==='ollama'?{message:{content:'',tool_calls:[]}}:{choices:[{message:{content:'',tool_calls:[]}}]};
 const accept=(data:any)=>{
  if(data.error||data.type==='error')throw new Error('Provider stream failed.');
  if(kind==='anthropic'){
   if(data.type?.startsWith('content_block_')&&(!Number.isInteger(data.index)||data.index<0||data.index>=100))throw new Error('Invalid stream block index.');
   if(data.type==='message_start')Object.assign(raw,{usage:data.message.usage});
   if(data.type==='content_block_start')raw.content[data.index]={...data.content_block};
   if(data.type==='content_block_delta'){
    const block=raw.content[data.index],d=data.delta;if(!block)throw new Error('Invalid stream block.');
    if(d.type==='text_delta'){block.text=(block.text||'')+d.text;onText(d.text);}
    if(d.type==='input_json_delta')block.partial=(block.partial||'')+d.partial_json;
    if(d.type==='thinking_delta')block.thinking=(block.thinking||'')+d.thinking;
    if(d.type==='signature_delta')block.signature=(block.signature||'')+d.signature;
   }
   if(data.type==='content_block_stop'){const block=raw.content[data.index];if(block?.partial){block.input=JSON.parse(block.partial);delete block.partial;}}
   if(data.type==='message_delta'){raw.stop_reason=data.delta.stop_reason;raw.usage={...raw.usage,...data.usage};}
   if(data.type==='message_stop')complete=true;
  }else if(kind==='gemini'){
   const candidate=data.candidates?.[0];if(candidate){for(const part of candidate.content?.parts||[]){raw.candidates[0].content.parts.push(part);if(part.text&&!part.thought)onText(part.text);}if(candidate.finishReason){raw.candidates[0].finishReason=candidate.finishReason;complete=true;}}
   if(data.usageMetadata)raw.usageMetadata=data.usageMetadata;
  }else{
   const choice=data.choices?.[0];const d=kind==='ollama'?data.message:choice?.delta;
   const message=kind==='ollama'?raw.message:raw.choices[0].message;
   if(d){if(d.content){message.content+=d.content;onText(d.content);}for(const field of ['thinking','reasoning_content'])if(d[field])message[field]=(message[field]||'')+d[field];
    for(const [i,c] of (d.tool_calls||[]).entries()){
     if(kind==='ollama'){message.tool_calls.push(c);continue;}
     const index=c.index??i;if(!Number.isInteger(index)||index<0||index>=50)throw new Error('Invalid stream tool index.');const old=message.tool_calls[index]??={id:'',type:'function',function:{name:'',arguments:''}};
     if(c.id)old.id=c.id;if(c.function?.name)old.function.name+=c.function.name;if(c.function?.arguments)old.function.arguments+=c.function.arguments;
    }
   }
   if(kind==='ollama'&&data.done){complete=true;for(const field of ['done_reason','prompt_eval_count','eval_count'])raw[field]=data[field];}
   if(choice?.finish_reason){raw.choices[0].finish_reason=choice.finish_reason;complete=true;}
   if(data.usage)raw.usage=data.usage;
  }
 };
 const line=(value:string)=>{const trimmed=value.trim();if(!trimmed)return;if(kind==='ollama'){accept(JSON.parse(trimmed));return;}const data=trimmed.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]')accept(JSON.parse(data));};
 const aborted=()=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',aborted,{once:true});
 try{
  while(true){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8*1024*1024)throw new Error('Provider stream exceeded 8 MB.');pending+=decoder.decode(part.value,{stream:true});pending=pending.replace(/\r\n/g,'\n');const delimiter=kind==='ollama'?'\n':'\n\n';let end;while((end=pending.indexOf(delimiter))>=0){line(pending.slice(0,end));pending=pending.slice(end+delimiter.length);}}
  pending+=decoder.decode();if(pending.trim())line(pending);if(!complete)throw new Error('Provider stream ended before completion. No tools were executed.');return raw;
 }finally{signal.removeEventListener('abort',aborted);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
