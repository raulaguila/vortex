const {test}=require('node:test');const assert=require('node:assert/strict');
const {nativePayload,decodeNative}=require('../dist/native');const {toolDefinitions,validateAction}=require('../dist/actions');
const budget={tokens:16384,output:2048};
test('compatibility requests retain tool history without native wire fields',async()=>{
 const {Client}=require('../dist/providers');let body;
 const client=new Client({id:'p',kind:'anthropic',baseUrl:'https://example.test'},'key',async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({content:[{type:'text',text:'summary'}]}));});
 await client.chat('model','summarize',[{role:'assistant',content:'',toolCalls:[{id:'c',name:'read',arguments:{path:'a.ts'}}],continuation:[{type:'thinking',thinking:'opaque'}]},{role:'user',content:'',toolResult:{id:'c',name:'read',status:'success',output:'source text'}}],new AbortController().signal,budget);
 assert.deepEqual(Object.keys(body.messages[0]),['role','content']);assert.match(body.messages[0].content,/a.ts/);assert.match(body.messages[1].content,/source text/);assert.ok(!JSON.stringify(body).includes('opaque'));
});
for(const kind of ['openai','compatible','ollama','anthropic','gemini'])test(kind+' native tools retain arguments and result association',()=>{
 const call={id:'call1',name:'read',arguments:{path:'a.ts'}};
 const wire=kind==='anthropic'?{content:[{type:'tool_use',id:call.id,name:call.name,input:call.arguments}]}:kind==='gemini'?{candidates:[{content:{parts:[{functionCall:{id:call.id,name:call.name,args:call.arguments},thoughtSignature:'opaque'}]}}]}:kind==='ollama'?{message:{content:'',thinking:'opaque',tool_calls:[{id:call.id,function:{name:call.name,arguments:call.arguments}}]}}:{choices:[{message:{content:null,tool_calls:[{id:call.id,function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}}]};
 const turn=decodeNative(kind,wire);assert.deepEqual(turn.calls,[call]);
 const messages=[{role:'user',content:'read file'},{role:'assistant',content:turn.text,toolCalls:turn.calls,continuation:turn.continuation},{role:'user',content:'result',toolResult:{id:call.id,name:call.name,status:'success',output:'file content'}}];
 const request=nativePayload(kind,'model','system',messages,toolDefinitions('ask'),budget);
 const body=JSON.stringify(request.body);assert.match(body,/file content/);assert.match(body,/read/);assert.ok(!body.includes('"name":"write"'));
 if(kind==='gemini')assert.match(body,/thoughtSignature/);if(kind==='ollama')assert.match(body,/thinking/);
});
test('partial and malformed native tool calls never become actions',()=>{
 assert.throws(()=>decodeNative('openai',{choices:[{finish_reason:'length',message:{tool_calls:[]}}]}),/output limit/);
 assert.throws(()=>decodeNative('openai',{choices:[{message:{tool_calls:[{id:'a',function:{name:'write',arguments:'{"path":'}}]}}]}));
 assert.throws(()=>validateAction({action:'write',path:'a',content:'x'},'ask'),/not allowed/);
});
test('native schemas expose only the allowed tools in each mode',()=>{
 assert.deepEqual(toolDefinitions('ask').map(t=>t.name),['list','read','search','diagnostics','editor','question','readOutput','symbols','skill']);
 assert.equal(toolDefinitions('plan').at(-1).name,'plan');assert.equal(toolDefinitions('agent').at(-1).name,'command');assert.deepEqual(toolDefinitions('agent',true),[]);
});
