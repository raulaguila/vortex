import type {ModelLimits} from './protocol';
import {Agent} from 'undici';
export type Kind = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'compatible';
export interface Provider { id: string; name: string; kind: Kind; baseUrl: string; tlsInsecure?: boolean }
export interface Message { role: 'user' | 'assistant'; content: string }
export const defaults: Record<Kind, string> = {openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta',ollama:'http://localhost:11434',compatible:''};
export function validateUrl(value: string): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || !['http:', 'https:'].includes(u.protocol)) throw new Error('URL inválida. Use uma URL HTTP(S) sem credenciais ou parâmetros.');
  return u.toString().replace(/\/$/, '');
}
export class Client {
  constructor(private p: Provider, private key: string, private transport: typeof fetch = fetch) {}
  private async request(path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const headers: Record<string,string> = {'Content-Type':'application/json'};
    if(this.p.kind==='anthropic') { headers['x-api-key']=this.key; headers['anthropic-version']='2023-06-01'; }
    else if(this.p.kind==='gemini') headers['x-goog-api-key']=this.key;
    else if(this.key) headers.Authorization=`Bearer ${this.key}`;
    const dispatcher = this.p.kind === 'compatible' && this.p.tlsInsecure && new URL(this.p.baseUrl).protocol === 'https:'
      ? new Agent({connect: {rejectUnauthorized: false}}) : undefined;
    try {
    let response: Response;
    try {
      const options: RequestInit & {dispatcher?: Agent} = {method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(30000),redirect:'error',...(dispatcher ? {dispatcher} : {})};
      response = await this.transport(`${validateUrl(this.p.baseUrl)}${path}`, options);
    } catch (error) {
      if(signal?.aborted) throw error;
      if(error instanceof Error && error.name === 'TimeoutError') throw new Error(`${this.p.name}: tempo de conexão esgotado. Tente novamente.`);
      throw new Error(`${this.p.name}: conexão indisponível. Verifique a URL e se o servidor está acessível.`);
    }
    if(!response.ok) {
      const detail = [401,403].includes(response.status) ? 'Falha de autenticação. Verifique a chave e as permissões.'
        : response.status === 429 ? 'Limite de uso atingido. Tente novamente mais tarde.'
        : response.status === 404 ? 'Endpoint ou modelo não encontrado. Verifique a URL e o ID.'
        : 'Provedor indisponível. Tente novamente.';
      throw new Error(`${this.p.name}: HTTP ${response.status}. ${detail}`);
    }
    try { return await response.json(); }
    catch { signal?.throwIfAborted();throw new Error(`${this.p.name}: resposta inválida da API. Verifique a URL base.`); }
    } finally { await dispatcher?.destroy(); }
  }
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
    return {input,output,status:input?'ready':'unknown'};
  }
  async chat(model:string, system:string, messages:Message[], signal:AbortSignal, budget?: {tokens:number;output:number}):Promise<string> {
    let result:any;
    if(this.p.kind==='anthropic') { result=await this.request('/messages',{model,system,max_tokens:budget?.output||4096,messages},signal); if(result.stop_reason==='max_tokens')throw new Error('The model response reached the output limit. Request a smaller change.');const text=result.content?.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n');if(!text)throw new Error('Anthropic returned no text.');return text; }
    if(this.p.kind==='gemini') { result=await this.request(`/models/${encodeURIComponent(model)}:generateContent`,{generationConfig:{maxOutputTokens:budget?.output||4096},systemInstruction:{parts:[{text:system}]},contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}))},signal); if(result.candidates?.[0]?.finishReason==='MAX_TOKENS')throw new Error('The model response reached the output limit. Request a smaller change.');const text=result.candidates?.[0]?.content?.parts?.map((x:any)=>x.text||'').join('\n'); if(!text) throw new Error('Gemini não retornou texto.'); return text; }
    const payload={model,...(this.p.kind==='ollama'?{options:{num_ctx:budget?.tokens||16384,num_predict:budget?.output||4096}}:this.p.kind==='compatible'?{max_tokens:budget?.output||4096}:{max_completion_tokens:budget?.output||4096}),messages:[{role:'system',content:system},...messages],stream:false};
    result=await this.request(this.p.kind==='ollama'?'/api/chat':'/chat/completions',payload,signal);
    if(result.done_reason==='length'||result.choices?.[0]?.finish_reason==='length')throw new Error('The model response reached the output limit. Request a smaller change.');
    const text=this.p.kind==='ollama'?result.message?.content:result.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text) throw new Error('O modelo não retornou texto. Escolha um modelo de chat.'); return text;
  }
}
