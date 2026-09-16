import {ModelTimeouts,ResponseDeadline,ExecutionError} from "../core/execution";
import {RunTrace} from "../session/trace";
import {compatibilityAnswer,responseMetadata} from "../core/chatResponse";
import {randomUUID} from 'node:crypto';
import type {ModelLimits} from "../ui/protocol";
import {compatibleRequest,connectionError} from "./httpTransport";
import {setTimeout as delay} from 'node:timers/promises';
import {nativePayload,decodeNative,Turn,ToolCall,ToolResult,ToolsUnsupported} from "../core/native";
import {readStream} from "./stream";
import type {ToolDefinition} from "../tools/actions";
export type Kind = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'compatible';
export interface Provider { id: string; name: string; kind: Kind; baseUrl: string; tlsInsecure?: boolean; timeouts?:ModelTimeouts|null }
export interface Message { origin?:'vortex_orchestrator'; role: 'user' | 'assistant'; content: string; toolCalls?:ToolCall[]; toolResult?:ToolResult; continuation?:unknown; continuationKind?:Kind }
export const defaults: Record<Kind, string> = {openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta',ollama:'http://localhost:11434',compatible:''};
export function validateUrl(value: string): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || !['http:', 'https:'].includes(u.protocol)) throw new Error('URL inválida. Use uma URL HTTP(S) sem credenciais ou parâmetros.');
  return u.toString().replace(/\/$/, '');
}
export class Client {
  constructor(private p: Provider, private key: string, private transport?: typeof fetch, private log?: (record:Record<string,unknown>)=>void, private modelTimeout:number|ModelTimeouts=120) {}
  private trace?:RunTrace;
  attachTrace(trace:RunTrace){this.trace=trace;trace.addSecret(this.key);}
  private async request(path:string,body?:unknown,signal?:AbortSignal,consume?:(response:Response,signal:AbortSignal,progress:()=>void)=>Promise<unknown>):Promise<any>{
    const generation=/\/(?:api\/chat|chat\/completions|messages)$|:(?:streamGenerateContent|generateContent)/.test(path);
    const trace=generation?this.trace:undefined;
    const index=trace?await trace.request(path,body):undefined;
    try{const result=await this.requestImpl(path,body,signal,consume);if(trace)await trace.response(index!,result,undefined,this.p.kind);return result;}
    catch(error){if(trace)await trace.response(index!,undefined,error instanceof Error?error.message:String(error));throw error;}
  }
  private async requestImpl(path:string,body?:unknown,signal?:AbortSignal,consume?:(response:Response,signal:AbortSignal,progress:()=>void)=>Promise<unknown>,attempt=0):Promise<any>{
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(this.p.kind==='anthropic'){headers['x-api-key']=this.key;headers['anthropic-version']='2023-06-01';}
    else if(this.p.kind==='gemini')headers['x-goog-api-key']=this.key;
    else if(this.key)headers.Authorization=`Bearer ${this.key}`;
    const requestId=randomUUID(),started=Date.now(),generation=/\/(?:api\/chat|chat\/completions|messages)$|:(?:streamGenerateContent|generateContent)/.test(path);
    const limits=typeof this.modelTimeout==='number'?{firstResponseTimeout:this.modelTimeout,idleTimeout:this.modelTimeout}:this.modelTimeout;
    const deadline=new ResponseDeadline(generation?limits:{firstResponseTimeout:30,idleTimeout:30});
    const requestSignal=signal?AbortSignal.any([signal,deadline.controller.signal]):deadline.controller.signal;
    this.log?.({event:'providerRequest',requestId,kind:this.p.kind,operation:generation?'generation':'metadata',attempt});
    try{
      requestSignal.throwIfAborted();const options:RequestInit={method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:requestSignal,redirect:'manual'};
      const url=`${validateUrl(this.p.baseUrl)}${path}`;
      const response=await (this.transport?this.transport(url,options):this.p.kind==='compatible'?compatibleRequest(url,options,!!this.p.tlsInsecure):fetch(url,options));
      this.log?.({event:'providerResponse',requestId,httpStatus:response.status,elapsed:Date.now()-started});
      if([429,502,503,504].includes(response.status)&&attempt<2){
        const retry=response.headers.get('retry-after');const ms=retry?(Number.isFinite(Number(retry))?Math.max(0,Number(retry)*1000):Math.max(0,Date.parse(retry)-Date.now())):250*2**attempt;
        await response.body?.cancel();await delay(Number.isFinite(ms)?Math.min(ms,86400000):250,undefined,{signal:requestSignal});deadline.dispose();return await this.requestImpl(path,body,signal,consume,attempt+1);
      }
      if(!response.ok){
        if([400,422].includes(response.status)&&body&&typeof body==='object'&&'tools' in body){const text=(await response.text()).slice(0,16384);if(/(?:does not support|unsupported|not supported)[^\n]{0,80}(?:tools|function.call)|(?:tools|function.call)[^\n]{0,80}(?:not supported|unsupported)/i.test(text))throw new ToolsUnsupported();}
        await response.body?.cancel().catch(()=>undefined);
        const detail=response.status>=300&&response.status<400?'A API redirecionou a requisição. Configure a URL base final do serviço.':[401,403].includes(response.status)?'Falha de autenticação. Verifique a chave e as permissões.':response.status===404?'Endpoint ou modelo não encontrado. Verifique a URL e o ID.':'Provedor indisponível. Tente novamente.';
        throw new ExecutionError([401,403].includes(response.status)?'authentication':'provider',`${this.p.name}: HTTP ${response.status}. ${detail}`,[429,502,503,504].includes(response.status));
      }
      let result:any;
      try{result=consume?await consume(response,requestSignal,()=>{deadline.progress();this.onProgress?.();}):await response.json();}
      catch(error){requestSignal.throwIfAborted();throw new ExecutionError('invalid_response',`${this.p.name}: resposta inválida da API. Verifique a URL base.`);}
      requestSignal.throwIfAborted();
      if(generation)this.log?.({event:'providerResponseShape',requestId,elapsed:Date.now()-started,...responseMetadata(this.p.kind,result)});
      return result;
    }catch(error){
      if(signal?.aborted)throw signal.reason;
      if(deadline.controller.signal.aborted)throw deadline.controller.signal.reason;
      if(error instanceof ExecutionError||error instanceof ToolsUnsupported)throw error;
      this.log?.({event:'providerTransportError',requestId,elapsed:Date.now()-started});
      throw new ExecutionError('transport',`${this.p.name}: conexão indisponível. ${connectionError(error)}`,true);
    }finally{deadline.dispose();}
  }
  onProgress?:()=>void;
  async models(): Promise<string[]> {
    const all:string[]=[];
    let cursor='';
    for(let page=0;page<100;page++) {
      const kind=this.p.kind;
      const path=kind==='ollama'?'/api/tags':kind==='gemini'?`/models?pageSize=1000${cursor?'&pageToken='+encodeURIComponent(cursor):''}`:`/models${kind==='anthropic'?'?limit=1000'+(cursor?'&after_id='+encodeURIComponent(cursor):''):''}`;
      const data=await this.request(path);
      const rows=kind==='ollama'?data.models:kind==='gemini'?data.models:data.data;
      if(!Array.isArray(rows)) throw new Error('O provedor retornou um catálogo inválido.');
      for(const row of rows) { if(kind==='gemini' && !row.supportedGenerationMethods?.includes('generateContent')) continue; const id=kind==='ollama'?row.name:kind==='gemini'?row.name.replace(/^models\//,''):row.id; if(typeof id==='string') all.push(id); }
      const next=kind==='gemini'?data.nextPageToken:kind==='anthropic'&&data.has_more?data.last_id:'';
      if(!next || next===cursor) break; cursor=next;
    }
    return [...new Set(all)].sort();
  }
  async modelInfo(model: string, signal?: AbortSignal): Promise<ModelLimits> {
    let raw: any;
    try { raw = this.p.kind === 'ollama' ? await this.request('/api/show',{model},signal) : await this.request(`/models/${encodeURIComponent(model)}`,undefined,signal); }
    catch(error) {
      if(!['openai','compatible'].includes(this.p.kind)) throw error;
      signal?.throwIfAborted();const catalog=await this.request('/models',undefined,signal);raw=catalog.data?.find((entry:any)=>entry.id===model)||{};
    }
    const positive = (n: unknown): number | null => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
    const input = this.p.kind === 'gemini' ? positive(raw.inputTokenLimit)
      : this.p.kind === 'anthropic' ? positive(raw.max_input_tokens)
      : this.p.kind === 'ollama' ? positive(Object.entries(raw.model_info || {}).find(([k]) => k.endsWith('.context_length'))?.[1])
      : positive(raw.context_length ?? raw.max_context_length ?? raw.max_model_len);
    const output = positive(this.p.kind === 'gemini' ? raw.outputTokenLimit : raw.max_tokens ?? raw.max_output_tokens);
    return {input,output,status:input?'ready':'unknown',...(Array.isArray(raw.capabilities)?{tools:raw.capabilities.includes('tools')}:{})};
  }
  async turn(model:string,system:string,messages:Message[],signal:AbortSignal,budget:{tokens:number;output:number},tools:ToolDefinition[],onText?:(text:string)=>void):Promise<Turn>{
    this.trace?.prepare(system,messages);
    const request=nativePayload(this.p.kind,model,system,messages,tools,budget);
    if(onText){
      if(this.p.kind==='gemini')request.path=request.path.replace(':generateContent',':streamGenerateContent?alt=sse');
      else Object.assign(request.body,{stream:true});
    }
    return decodeNative(this.p.kind,await this.request(request.path,request.body,signal,onText?(response,requestSignal,progress)=>{
      if(response.headers.get('content-type')?.includes('application/json'))return response.json();
      return readStream(response,this.p.kind,requestSignal,onText,progress);
    }:undefined));
  }
  async chat(model:string, system:string, messages:Message[], signal:AbortSignal, budget?: {tokens:number;output:number}):Promise<string> {
    this.trace?.prepare(system,messages);
    const request=compatibilityPayload(this.p.kind,model,system,messages,budget);
    return compatibilityAnswer(this.p.kind,await this.request(request.path,request.body,signal));
  }

}

export function compatibilityPayload(kind:Kind,model:string,system:string,messages:Message[],budget={tokens:16384,output:4096}){
 const rows=messages.map(m=>({role:m.role,content:m.toolResult?`Tool result ${m.toolResult.name} [${m.toolResult.id}] (${m.toolResult.status}): ${m.toolResult.output}`:[m.content,...(m.toolCalls||[]).map(call=>`Tool call ${call.name} [${call.id}]: ${JSON.stringify(call.arguments)}`)].filter(Boolean).join('\n')}));
 if(kind==='anthropic')return {path:'/messages',body:{model,system,max_tokens:budget.output,messages:rows}};
 if(kind==='gemini')return {path:`/models/${encodeURIComponent(model)}:generateContent`,body:{generationConfig:{maxOutputTokens:budget.output},systemInstruction:{parts:[{text:system}]},contents:rows.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}))}};
 return {path:kind==='ollama'?'/api/chat':'/chat/completions',body:{model,...(kind==='ollama'?{options:{num_ctx:budget.tokens,num_predict:budget.output}}:kind==='compatible'?{max_tokens:budget.output}:{max_completion_tokens:budget.output}),messages:[{role:'system',content:system},...rows],stream:false}};
}
