import type {Kind} from './providers';
// Normalize only public answer blocks; thinking/reasoning is never displayed as an answer.
export function answerText(value:unknown):string {
 if(typeof value==='string')return value;
 if(!Array.isArray(value))return '';
 return value.filter(p=>p&&typeof p==='object'&&!p.thought&&['text','output_text'].includes(p.type)&&typeof p.text==='string').map(p=>p.text).join('\n');
}
export function responseMetadata(kind:Kind,raw:any){
 const choice=raw?.choices?.[0],message=kind==='ollama'?raw?.message:choice?.message;
 const parts=kind==='anthropic'?raw?.content:raw?.candidates?.[0]?.content?.parts;
 const rawReason=raw?.done_reason??choice?.finish_reason??raw?.stop_reason??raw?.candidates?.[0]?.finishReason;
 const allowed=['stop','length','tool_calls','function_call','content_filter','max_tokens','end_turn','tool_use','MAX_TOKENS','STOP','SAFETY','RECITATION'];
 return {finishReason:allowed.includes(rawReason)?rawReason:rawReason?'other':null,
  hasTools:!!(message?.tool_calls?.length||message?.function_call||Array.isArray(parts)&&parts.some((p:any)=>p?.type==='tool_use'||p?.functionCall)),
  hasReasoning:!!(message?.thinking||message?.reasoning_content||message?.reasoning||Array.isArray(parts)&&parts.some((p:any)=>['thinking','redacted_thinking'].includes(p?.type)||p?.thought)),
  refused:!!(message?.refusal||raw?.promptFeedback?.blockReason||['content_filter','SAFETY','RECITATION'].includes(rawReason)),
  contentShape:typeof message?.content==='string'?'string':Array.isArray(message?.content)?'blocks':Array.isArray(parts)?'blocks':message?.content===null?'null':'missing'};
}
export function compatibilityAnswer(kind:Kind,raw:any):string {
 const meta=responseMetadata(kind,raw);
 if(['length','max_tokens','MAX_TOKENS'].includes(meta.finishReason||''))throw new Error('[output_limit] A API respondeu, mas atingiu o limite de saída antes de concluir a resposta. Reduza o pedido ou revise os limites de saída do modelo.');
 if(meta.refused)throw new Error('[response_refused] A API bloqueou ou recusou a resposta. Nenhuma ferramenta foi executada nesta resposta.');
 if(meta.hasTools)throw new Error('[tool_protocol_mismatch] A API retornou chamadas de ferramentas no protocolo Compatibilidade. Se este modelo suporta ferramentas, selecione Nativo nas configurações do modelo e tente novamente. Nenhuma dessas chamadas foi executada.');
 const text=kind==='anthropic'?answerText(raw?.content):kind==='gemini'?(Array.isArray(raw?.candidates?.[0]?.content?.parts)?raw.candidates[0].content.parts.filter((p:any)=>!p.thought&&typeof p.text==='string').map((p:any)=>p.text).join('\n'):''):answerText(kind==='ollama'?raw?.message?.content:raw?.choices?.[0]?.message?.content);
 if(text.trim())return text;
 if(meta.hasReasoning)throw new Error('[reasoning_only] A API retornou raciocínio interno, mas nenhuma resposta final. Isso não significa que o modelo não seja de chat. Verifique os limites de saída e a configuração de raciocínio do provedor.');
 throw new Error('[empty_response] A API respondeu sem texto utilizável nem chamadas de ferramentas. Verifique o diagnóstico do Vortex para distinguir formato incompatível de resposta vazia do provedor.');
}
