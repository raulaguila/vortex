const {test}=require('node:test');const assert=require('node:assert/strict');
const {nativePayload,decodeNative}=require('../dist/native');const {toolDefinitions,validateAction}=require('../dist/actions');
const budget={tokens:16384,output:2048};
test('compatibility requests retain tool history without native wire fields',async()=>{
 const {Client}=require('../dist/providers');let body;
 const client=new Client({id:'p',kind:'anthropic',baseUrl:'https://example.test'},'key',async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({content:[{type:'text',text:'summary'}]}));});
 await client.chat('model','summarize',[{role:'assistant',content:'',toolCalls:[{id:'c',name:'read_file',arguments:{path:'a.ts'}}],continuation:[{type:'thinking',thinking:'opaque'}]},{role:'user',content:'',toolResult:{id:'c',name:'read_file',status:'success',output:'source text'}}],new AbortController().signal,budget);
 assert.deepEqual(Object.keys(body.messages[0]),['role','content']);assert.match(body.messages[0].content,/a.ts/);assert.match(body.messages[1].content,/source text/);assert.ok(!JSON.stringify(body).includes('opaque'));
});
for(const kind of ['openai','compatible','ollama','anthropic','gemini'])test(kind+' native tools retain arguments and result association',()=>{
 const call={id:'call1',name:'read_file',arguments:{path:'a.ts'}};
 const wire=kind==='anthropic'?{content:[{type:'tool_use',id:call.id,name:call.name,input:call.arguments}]}:kind==='gemini'?{candidates:[{content:{parts:[{functionCall:{id:call.id,name:call.name,args:call.arguments},thoughtSignature:'opaque'}]}}]}:kind==='ollama'?{message:{content:'',thinking:'opaque',tool_calls:[{id:call.id,function:{name:call.name,arguments:call.arguments}}]}}:{choices:[{message:{content:null,tool_calls:[{id:call.id,function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}}]};
 const turn=decodeNative(kind,wire);assert.deepEqual(turn.calls,[call]);
 const messages=[{role:'user',content:'read file'},{role:'assistant',content:turn.text,toolCalls:turn.calls,continuation:turn.continuation},{role:'user',content:'result',toolResult:{id:call.id,name:call.name,status:'success',output:'file content'}}];
 const request=nativePayload(kind,'model','system',messages,toolDefinitions('ask'),budget);
 const body=JSON.stringify(request.body);assert.match(body,/file content/);assert.match(body,/read/);assert.ok(!body.includes('"name":"write_file"'));
 if(kind==='gemini')assert.match(body,/thoughtSignature/);if(kind==='ollama')assert.match(body,/thinking/);
});
test('partial and malformed native tool calls never become actions',()=>{
 assert.throws(()=>decodeNative('openai',{choices:[{finish_reason:'length',message:{tool_calls:[]}}]}),/output limit/);
 assert.throws(()=>decodeNative('openai',{choices:[{message:{tool_calls:[{id:'a',function:{name:'write_file',arguments:'{"path":'}}]}}]}));
 assert.throws(()=>validateAction({action:'write_file',path:'a',content:'x'},'ask'),/not allowed/);
});
test('native schemas expose only the allowed tools in each mode',()=>{
 assert.deepEqual(toolDefinitions('ask').map(t=>t.name),['list_files','read_file','search_files','get_diagnostics','get_editor_context','ask_user','read_tool_output','query_symbols','get_project_skill']);
 assert.equal(toolDefinitions('plan').at(-1).name,'propose_plan');assert.equal(toolDefinitions('agent').at(-1).name,'run_command');assert.deepEqual(toolDefinitions('agent',true),[]);
});
test('every provider omits mutation tools in Ask and Plan and the response boundary rejects them',()=>{
 const {systemPrompt}=require('../dist/prompt');const {turnActions,compatibilityTurn}=require('../dist/turnProtocol');
 const mutations=['write_file','edit_file','edit_file_batch','delete_file','run_command'];
 for(const mode of ['ask','plan'])for(const permission of ['supervised','autonomous']){
  for(const protocol of ['native','compatibility']){
   const prompt=systemPrompt(mode,'auto',[],false,permission,protocol);
   for(const name of mutations)assert.ok(!prompt.includes(name),`${mode}/${protocol} must not advertise ${name}`);
  }
  for(const kind of ['openai','compatible','ollama','anthropic','gemini']){
   const body=nativePayload(kind,'model',systemPrompt(mode,'auto',[],false,permission,'native'),[{role:'user',content:'Fix the bug.'}],toolDefinitions(mode),budget).body;
   const definitions=kind==='gemini'?body.tools[0].functionDeclarations:kind==='anthropic'?body.tools:body.tools.map(t=>t.function);
   assert.ok(definitions.some(t=>t.name==='read_file'));
   assert.equal(definitions.some(t=>t.name==='propose_plan'),mode==='plan');
   for(const name of mutations)assert.ok(!definitions.some(t=>t.name===name),`${kind}/${mode} exposed ${name}`);
  }
  for(const name of mutations){
   const turn={kind:'tool_use',stopReason:'tool_calls',text:'',calls:[{id:'read',name:'read_file',arguments:{path:'a.ts'}},{id:'blocked',name,arguments:{}}]};
   assert.throws(()=>turnActions(turn,mode),/not exposed/); // Reject the entire batch, including the preceding read.
   assert.throws(()=>compatibilityTurn(JSON.stringify({action:name}),mode),/not allowed/);
  }
 }
});
for(const kind of ['openai','compatible','ollama','anthropic','gemini'])test(kind+' preserves the controlled plan schema and report boundary',()=>{
 const {turnActions,compatibilityTurn}=require('../dist/turnProtocol');
 const args={outcome:'completed',summary:'Verified',evidence:[{criterion_id:'test',tool_call_ids:['host-evidence']}],remaining_issues:[]};
 const call={id:'report',name:'report_step_result',arguments:args};
 const wire=kind==='anthropic'?{content:[{type:'tool_use',id:call.id,name:call.name,input:args}]}:kind==='gemini'?{candidates:[{content:{parts:[{functionCall:{id:call.id,name:call.name,args}}]}}]}:kind==='ollama'?{message:{tool_calls:[{id:call.id,function:{name:call.name,arguments:args}}]}}:{choices:[{message:{tool_calls:[{id:call.id,function:{name:call.name,arguments:JSON.stringify(args)}}]}}]};
 const turn=decodeNative(kind,wire);assert.deepEqual(turnActions(turn,'agent',false,true),[{action:call.name,...args}]);assert.throws(()=>turnActions(turn,'agent'),/not exposed/);
 const compat=compatibilityTurn(JSON.stringify({action:call.name,...args}),'agent');assert.deepEqual(turnActions(compat,'agent',false,true),[{action:call.name,...args}]);
 const body=nativePayload(kind,'model','system',[],toolDefinitions('agent',false,true),budget).body;
 const defs=kind==='gemini'?body.tools[0].functionDeclarations:kind==='anthropic'?body.tools:body.tools.map(t=>t.function);
 const schema=defs.find(t=>t.name===call.name);assert.ok(schema);assert.equal((schema.parameters||schema.input_schema||schema.parametersJsonSchema).properties.execution_id,undefined);assert.match(JSON.stringify(schema),/tool_call_ids/);
 assert.throws(()=>turnActions({...turn,calls:[{id:'read',name:'read_file',arguments:{path:'a'}},...turn.calls]},'agent',false,true),/only tool call/);
});

test('empty-response recovery never sends empty assistant blocks to any provider',()=>{
 const {rejectionFeedback}=require('../dist/turnProtocol');
 for(const kind of ['openai','compatible','anthropic','gemini','ollama']){
  const rows=rejectionFeedback('',{kind:'final',text:'',calls:[],stopReason:'stop'},'agent',false,true,kind,'Empty response.',false,true);
  assert.equal(rows.length,1);assert.equal(rows[0].role,'user');assert.equal(rows[0].origin,'vortex_orchestrator');
  const wire=nativePayload(kind,'m','system',rows,[],{tokens:8000,output:500}).body;
  assert.ok(wire);assert.equal(rows.some(m=>m.role==='assistant'),false);
 }
 const compatibility=rejectionFeedback('',undefined,'plan',false,false,'anthropic','Empty response.',true);assert.equal(compatibility.length,1);assert.equal(compatibility[0].role,'user');
});
