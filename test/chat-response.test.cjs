const {test}=require('node:test');const assert=require('node:assert/strict');
const {Client}=require('../dist/providers');const {decodeNative}=require('../dist/native');
const {compatibilityAnswer,responseMetadata}=require('../dist/chatResponse');
test('greeting succeeds then a tool-only response identifies protocol mismatch after an actual request',async()=>{
 let requests=0;const logs=[];const key='private-key';
 const client=new Client({id:'p',kind:'compatible',name:'Gateway',baseUrl:'http://example.test/company'},key,async(_url,options)=>{requests++;const body=JSON.parse(options.body);assert.equal(body.stream,false);return new Response(JSON.stringify(requests===1?{choices:[{message:{content:'Olá!'}}]}:{choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'c',function:{name:'list',arguments:'{}'}}]}}]}));},record=>logs.push(record));
 const signal=new AbortController().signal;assert.equal(await client.chat('model','system',[{role:'user',content:'oi'}],signal),'Olá!');
 await assert.rejects(client.chat('model','system',[{role:'user',content:'oi'},{role:'assistant',content:'Olá!'},{role:'user',content:'o que pode me dizer sobre o projeto atual?'}],signal),/tool_protocol_mismatch/);
 assert.equal(requests,2);assert.equal(logs.filter(l=>l.event==='providerResponse'&&l.httpStatus===200).length,2);assert.equal(logs.at(-1).hasTools,true);
 assert.ok(!JSON.stringify(logs).includes(key));assert.ok(!JSON.stringify(logs).includes('projeto atual'));assert.ok(!JSON.stringify(logs).includes('Olá'));
});
test('content blocks are answers but reasoning blocks never become user-visible text',()=>{
 const raw={choices:[{message:{content:[{type:'text',text:'Answer'},{type:'reasoning',text:'secret'},{type:'output_text',text:'More'}]}}]};
 assert.equal(compatibilityAnswer('compatible',raw),'Answer\nMore');assert.equal(decodeNative('compatible',raw).text,'Answer\nMore');
 for(const kind of ['openai','compatible','ollama']){const message={content:'',reasoning_content:'private reasoning'};const result=kind==='ollama'?{message}:{choices:[{message}]};assert.throws(()=>compatibilityAnswer(kind,result),/reasoning_only/);assert.ok(!JSON.stringify(responseMetadata(kind,result)).includes('private reasoning'));}
});
test('empty, refused, incomplete, malformed and unexpected tool responses are distinct',()=>{
 assert.throws(()=>compatibilityAnswer('compatible',{choices:[{message:{content:''}}]}),/empty_response/);
 assert.throws(()=>compatibilityAnswer('compatible',null),/empty_response/);
 assert.throws(()=>compatibilityAnswer('compatible',{choices:[{finish_reason:'length',message:{content:''}}]}),/output_limit/);
 assert.throws(()=>compatibilityAnswer('compatible',{choices:[{message:{refusal:'do not log this',content:null}}]}),/response_refused/);
 assert.throws(()=>compatibilityAnswer('anthropic',{content:[{type:'tool_use',id:'c',name:'read',input:{path:'a'}}]}),/tool_protocol_mismatch/);
 assert.throws(()=>compatibilityAnswer('gemini',{candidates:[{content:{parts:[{functionCall:{name:'read',args:{path:'a'}}}]}}]}),/tool_protocol_mismatch/);
});
