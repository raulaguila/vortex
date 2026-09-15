import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {decodeNative} from './native';
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
 private secrets:string[]=[];
 private data:Record<string,any>;
 constructor(readonly path:string,metadata:Record<string,any>,private onError:()=>void=()=>{}){this.data={conversation_id:metadata.sessionId,model:metadata.model.modelId,temperature:null,max_tokens:null,system_prompt:'',user_question:metadata.prompt||'',turns:[],final_answer:'',sources:[]};}
 addSecret(secret:string){if(secret)this.secrets.push(secret);}
 async save(){try{await mkdir(dirname(this.path),{recursive:true});let json=JSON.stringify(this.data,null,2);for(const secret of this.secrets)json=json.split(JSON.stringify(secret).slice(1,-1)).join('[REDACTED]');await writeFile(this.path+'.tmp',json,{mode:0o600});await rename(this.path+'.tmp',this.path);}catch{this.onError();}}
 async request(path:string,body:any){
 const rows=messages(body),tools=(body.tools||[]).flatMap((t:any)=>t.functionDeclarations||[t]).map((t:any)=>({name:t.function?.name||t.name,description:t.function?.description||t.description,parameters:t.function?.parameters||t.input_schema||t.parametersJsonSchema||t.parameters}));
 const known=rows.flatMap(m=>m.tool_calls||[]);for(const row of rows)if(row.role==='tool'&&!row.tool_name)row.tool_name=known.find(c=>c.id===row.tool_call_id)?.name;
 this.data.sources=rows.filter(m=>m.role==='tool').map(m=>({tool:m.tool_name||'',input:known.find(c=>c.id===m.tool_call_id)?.input||'{}',result:m.content}));
 const max=body.max_tokens??body.max_completion_tokens??body.options?.num_predict??body.generationConfig?.maxOutputTokens??null;
 if(!this.data.turns.length){this.data.system_prompt=rows.find(m=>m.role==='system')?.content||'';this.data.max_tokens=max;this.data.temperature=body.temperature??null;}
 const entry={iteration:this.data.turns.length+1,request:{Model:body.model||this.data.model,Messages:rows,Tools:tools,Temperature:body.temperature??null,MaxTokens:max},response:null};
 this.data.turns.push(entry);await this.save();return this.data.turns.length-1;
 }
 async response(index:number,result:unknown,error?:string,kind:Kind='compatible'){
 let response:any;
 if(error)response={content:'',tool_calls:[],stop_reason:'error',error};
 else try{const turn=decodeNative(kind,result);response={content:turn.text,tool_calls:calls(turn.calls),stop_reason:turn.stopReason};}catch{response={content:'',tool_calls:[],stop_reason:'invalid_response',raw_response:result};}
 this.data.turns[index].response=response;await this.save();
 }
 async finish(status:string,history:Message[]){
 this.data.final_answer=status==='complete'?(history.at(-1)?.role==='assistant'?history.at(-1)!.content:''):'';
 const sources:any[]=[];for(const m of history){if(m.toolResult){const call=history.flatMap(h=>h.toolCalls||[]).find(c=>c.id===m.toolResult!.id);sources.push({tool:m.toolResult.name,input:JSON.stringify(call?.arguments||{}),result:m.toolResult.output});}}
 this.data.sources=sources;await this.save();
 }
}
