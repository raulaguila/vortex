import {mkdir,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {decodeNative,Turn} from './native';
import type {Kind,Message} from './providers';

const calls=(items:any[])=>items.map(c=>({id:c.id,name:c.name||c.function?.name,input:typeof (c.input??c.function?.arguments)==='string'?(c.input??c.function.arguments):JSON.stringify(c.input??c.arguments??c.args??c.function?.arguments??{})}));
function messages(body:any):any[]{
 if(body.contents)return [{role:'system',content:body.systemInstruction?.parts?.map((p:any)=>p.text||'').join('')||''},...body.contents.flatMap((m:any)=>m.parts.flatMap((p:any)=>p.functionResponse?[{role:'tool',content:JSON.stringify(p.functionResponse.response),tool_call_id:p.functionResponse.id,tool_name:p.functionResponse.name}]:p.functionCall?[{role:'assistant',content:'',tool_calls:calls([p.functionCall])}]:[{role:m.role==='model'?'assistant':'user',content:p.text||''}]))];
 return [...(body.system?[{role:'system',content:body.system}]:[]),...(body.messages||[]).flatMap((m:any)=>Array.isArray(m.content)?[
 ...(m.content.some((p:any)=>p.type!=='tool_result')?[{role:m.role,content:m.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join(''),...(m.content.some((p:any)=>p.type==='tool_use')?{tool_calls:calls(m.content.filter((p:any)=>p.type==='tool_use'))}:{})}]:[]),
 ...m.content.filter((p:any)=>p.type==='tool_result').map((p:any)=>({role:'tool',content:p.content,tool_call_id:p.tool_use_id}))
 ]:[{role:m.role,content:m.content||'',...(m.tool_calls?{tool_calls:calls(m.tool_calls)}:{}),...(m.role==='tool'?{tool_call_id:m.tool_call_id,tool_name:m.tool_name}:{})}])];
}
/** Same trace envelope as the reference; provider wire formats are normalized. */
export class RunTrace {
 private static owners=new Map<string,string>();
 private static queues=new Map<string,Promise<void>>();
 private id=randomUUID();private dirty=false;private scheduled?:ReturnType<typeof setTimeout>;
 private logical?:any[];
 private secrets:string[]=[];
 private data:Record<string,any>;
 constructor(readonly path:string,metadata:Record<string,any>,private onError:()=>void=()=>{}){RunTrace.owners.set(path,this.id);this.data={conversation_id:metadata.sessionId,model:metadata.model.modelId,temperature:null,max_tokens:null,system_prompt:'',user_question:metadata.prompt||'',turns:[],final_answer:'',sources:[]};}
 binding(value:ReturnType<typeof import('./modelRequest').requestBinding>){(this.data.request_bindings??=[]).push({...value,contract_version:2});}
 addSecret(secret:string){if(secret)this.secrets.push(secret);}
 prepare(system:string,history:Message[]){this.logical=[{role:'system',content:system},...history.map(m=>m.toolResult?{role:'tool',content:m.toolResult.output,tool_call_id:m.toolResult.id,tool_name:m.toolResult.name}:{role:m.role,content:m.content,...(m.origin?{origin:m.origin}:{}),...(m.toolCalls?.length?{tool_calls:calls(m.toolCalls)}:{})})];}
 async save(){this.dirty=true;if(!this.scheduled)this.scheduled=setTimeout(()=>{this.scheduled=undefined;void this.flush();},20);}
 async flush(){
  clearTimeout(this.scheduled);this.scheduled=undefined;if(!this.dirty){await RunTrace.queues.get(this.path);return;}this.dirty=false;
  const snapshot=this.data,secrets=[...this.secrets];
  const work=(RunTrace.queues.get(this.path)||Promise.resolve()).then(async()=>{
   if(RunTrace.owners.get(this.path)!==this.id)return;
   try{await mkdir(dirname(this.path),{recursive:true});let json=JSON.stringify(snapshot,null,2);for(const secret of secrets)json=json.split(JSON.stringify(secret).slice(1,-1)).join('[REDACTED]');
    const tmp=this.path+'.'+this.id+'.tmp';await writeFile(tmp,json,{mode:0o600});if(RunTrace.owners.get(this.path)===this.id)await rename(tmp,this.path);else await import('node:fs/promises').then(fs=>fs.unlink(tmp));
   }catch{this.onError();}
  });RunTrace.queues.set(this.path,work);await work;
 }
 static async settled(path:string){await RunTrace.queues.get(path);}
 async request(path:string,body:any){
 const rows=this.logical||messages(body),tools=(body.tools||[]).flatMap((t:any)=>t.functionDeclarations||[t]).map((t:any)=>({name:t.function?.name||t.name,description:t.function?.description||t.description,parameters:t.function?.parameters||t.input_schema||t.parametersJsonSchema||t.parameters}));
 this.logical=undefined;const known=new Map<string,any>();const sources=[];for(const row of rows){for(const call of row.tool_calls||[])known.set(call.id,call);if(row.role==='tool'){const call=known.get(row.tool_call_id);row.tool_name??=call?.name;sources.push({tool:row.tool_name||'',input:call?.input||'{}',result:row.content});}}this.data.sources=sources;
 const max=body.max_tokens??body.max_completion_tokens??body.options?.num_predict??body.generationConfig?.maxOutputTokens??null;
 if(!this.data.turns.length){this.data.system_prompt=rows.find(m=>m.role==='system')?.content||'';this.data.max_tokens=max;this.data.temperature=body.temperature??null;}
 const context=rows.find(m=>m.role==='system')?.content?.match(/<execution_context>([\s\S]*?)<\/execution_context>/)?.[1];
 let orchestration;try{orchestration=context?JSON.parse(context):undefined;}catch{}
 const entry={binding:this.data.request_bindings?.at(-1),iteration:this.data.turns.length+1,...(orchestration?{orchestration}:{}),request:{Model:body.model||this.data.model,Messages:rows,Tools:tools,Temperature:body.temperature??null,MaxTokens:max},response:null};
 this.data.turns.push(entry);await this.save();return this.data.turns.length-1;
 }
 async response(index:number,result:unknown,error?:string,kind:Kind='compatible'){
 let response:any;
 if(error)response={content:'',tool_calls:[],stop_reason:'error',error};
 else try{const turn=decodeNative(kind,result);const normalized=turn.kind==='tool_use'?'tool_use':'stop';response={content:turn.text,tool_calls:calls(turn.calls),stop_reason:normalized,...(turn.stopReason!==normalized?{provider_stop_reason:turn.stopReason}:{})};}catch{response={content:'',tool_calls:[],stop_reason:'invalid_response',raw_response:result};}
 this.data.turns[index].response=response;await this.save();
 }
 /** Record host interpretation without losing what the provider actually returned. */
 async interpreted(turn:Turn|undefined,validationError?:string){
  const response=this.data.turns.at(-1)?.response;if(!response)return;
  const original=response.provider_stop_reason??response.stop_reason;
  const normalized=turn?(turn.calls.length?'tool_use':'stop'):'invalid_response';
  if(original!==normalized)response.provider_stop_reason=original;
  response.stop_reason=normalized;
  if(turn){
   if(response.content!==turn.text)response.provider_content??=response.content;
   response.content=turn.text;response.tool_calls=calls(turn.calls);
  }
  if(validationError)response.validation_error=validationError;
  await this.save();
 }
 async plan(plan:import('./plan').PlanState){const state=structuredClone(plan);(this.data.plan_transitions??=[]).push({at:Date.now(),plan_id:state.plan_id,version:state.version,execution_id:state.execution_id,status:state.status,active_step:state.active_step,steps:state.executions.map(e=>({id:e.id,status:e.status,attempt:e.attempts.at(-1)?.number,criteria:e.attempts.at(-1)?.criteria}))});this.data.plan=state;await this.save();}
 async finish(status:string,history:Message[]){
 this.data.final_answer=status==='complete'?(history.at(-1)?.role==='assistant'?history.at(-1)!.content:''):'';
 const sources:any[]=[],known=new Map();for(const m of history){for(const call of m.toolCalls||[])known.set(call.id,call);if(m.toolResult){const call=known.get(m.toolResult.id);sources.push({tool:m.toolResult.name,input:JSON.stringify(call?.arguments||{}),result:m.toolResult.output});}}
 this.data.sources=sources;await this.save();await this.flush();
 }
}
