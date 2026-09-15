const {test}=require('node:test');const assert=require('node:assert/strict');
const {Client}=require('../dist/providers');const {toolDefinitions}=require('../dist/actions');const {ProviderManager}=require('../dist/providerManager');
const {decodeNative,nativePayload,ToolsUnsupported}=require('../dist/native');const {compatibilityTurn,turnActions}=require('../dist/turnProtocol');
const budget={tokens:16384,output:4096};
test('structured multi-round flow preserves every call ID, result and message prefix',async()=>{
 const requests=[];let iteration=0;const client=new Client({id:'p',kind:'compatible',name:'test',baseUrl:'http://example.test'},'',async(_url,options)=>{
  requests.push(JSON.parse(options.body));const message=iteration++===0?{content:'',tool_calls:[{id:'a',type:'function',function:{name:'list',arguments:'{}'}},{id:'b',type:'function',function:{name:'diagnostics',arguments:'{}'}}]}:iteration===2?{content:'',tool_calls:[{id:'c',type:'function',function:{name:'read',arguments:'{"path":"README.md"}'}}]}:{content:'This is a TypeScript extension.'};
  return new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));
 });const messages=[{role:'user',content:'Explain this project'}];
 for(let i=0;i<3;i++){
  const turn=await client.turn('model','Answer from tool evidence.',messages,new AbortController().signal,budget,toolDefinitions('ask'));
  assert.equal(turn.kind,i<2?'tool_use':'final');turnActions(turn,'ask');messages.push({role:'assistant',content:turn.text,toolCalls:turn.calls});
  for(const call of turn.calls)messages.push({role:'user',content:'fixture',toolResult:{id:call.id,name:call.name,status:'success',output:call.name==='read'?'TypeScript extension':'Structured fixture result'}});
 }
 assert.deepEqual(requests[1].messages.slice(0,requests[0].messages.length),requests[0].messages);
 assert.deepEqual(requests[2].messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['a','b','c']);
 for(const request of requests)for(const tool of request.tools){assert.ok(tool.function.parameters);assert.ok(!('inputSchema' in tool.function));}
});
test('empty tool-use markers and blocked or incomplete responses never become completed tasks',()=>{
 assert.throws(()=>decodeNative('compatible',{choices:[{finish_reason:'tool_calls',message:{content:'I will inspect'}}]}),/no tool calls/);
 assert.throws(()=>decodeNative('compatible',{choices:[{finish_reason:'content_filter',message:{content:'blocked',tool_calls:[{id:'a',function:{name:'write',arguments:'{}'}}]}}]}),/blocked/);
 assert.throws(()=>decodeNative('compatible',{choices:[{finish_reason:'length',message:{content:''}}]}),/output limit/);
});
test('compatibility also produces structured calls with correlated IDs',()=>{
 const turn=compatibilityTurn('{"action":"read","path":"README.md"}','ask');assert.equal(turn.kind,'tool_use');assert.ok(turn.calls[0].id);assert.deepEqual(turnActions(turn,'ask'),[{action:'read',path:'README.md'}]);
 assert.equal(compatibilityTurn('A useful answer','ask').kind,'final');assert.throws(()=>turnActions({kind:'tool_use',text:'',calls:[{id:'x',name:'finish',arguments:{text:'bad'}}]},'agent'),/not exposed/);
});
test('Auto tries native tools on unknown compatible endpoints and falls back only explicitly',()=>{
 const storage={get:(key,fallback)=>key==='providers'?[{id:'p',kind:'compatible'}]:fallback,update:async()=>{}};const manager=new ProviderManager(storage,{}),ref={providerId:'p',modelId:'m'};
 assert.equal(manager.toolProtocol(ref),'native');assert.equal(manager.fallbackTools(ref),true);assert.equal(manager.toolProtocol(ref),'compatibility');
});
test('native provider-specific requests omit tool definitions for synthesis rounds',()=>{
 for(const kind of ['openai','compatible','anthropic','gemini','ollama'])assert.equal('tools' in nativePayload(kind,'m','Summarize',[],[],budget).body,false);
});

test('native rejection feedback serializes matching tool errors for all provider formats',()=>{
 const {rejectionFeedback}=require('../dist/turnProtocol');const turn={kind:'tool_use',text:'',stopReason:'tool_use',calls:[{id:'rejected-id',name:'read',arguments:{path:42}}]};
 for(const kind of ['openai','compatible','ollama','anthropic','gemini']){
  const history=rejectionFeedback('',turn,'ask',false,true,kind,'Invalid read arguments: arguments.path must be a string.');assert.equal(history[1].toolResult.id,'rejected-id');assert.equal(history[1].toolResult.status,'error');
  const body=nativePayload(kind,'m','s',history,[],{tokens:8192,output:1024}).body;
  if(kind==='anthropic'){assert.equal(body.messages[1].content[0].tool_use_id,'rejected-id');assert.equal(body.messages[1].content[0].is_error,true);}
  else if(kind==='gemini'){assert.equal(body.contents[1].parts[0].functionResponse.id,'rejected-id');assert.equal(body.contents[1].parts[0].functionResponse.response.status,'error');}
  else {assert.equal(body.messages[2].role,'tool');assert.equal(body.messages[2][kind==='ollama'?'tool_name':'tool_call_id'],kind==='ollama'?'read':'rejected-id');}
 }
 assert.throws(()=>turnActions({...turn,calls:[{id:'a',name:'read',arguments:'{"path":"a"}'}]},'ask'),/expected an object/);
});

test('editor selection accepts unambiguous provider spellings in both protocols',()=>{
 const {decodeAction,validateAction}=require('../dist/actions');
 for(const mode of ['ask','plan','agent'])for(const [raw,expected] of [['false',false],['true',true],[' FALSE ',false],[' True ',true],[0,false],[1,true],['0',false],['1',true],['off',false],['ON',true],[false,false],[true,true],[null,undefined]]){
  const input={action:'editor',selection:raw},original=structuredClone(input);const expectedAction=expected===undefined?{action:'editor'}:{action:'editor',selection:expected};
  assert.deepEqual(decodeAction(input,mode),expectedAction);assert.deepEqual(input,original);
  const compatibility=compatibilityTurn(JSON.stringify(input),mode);assert.deepEqual(turnActions(compatibility,mode),[expectedAction]);
  const native={kind:'tool_use',stopReason:'stop',text:'',calls:[{id:'editor-call',name:'editor',arguments:{selection:raw}}]};assert.deepEqual(turnActions(native,mode),[expectedAction]);assert.equal(native.calls[0].arguments.selection,raw);
 }
 assert.throws(()=>validateAction({action:'editor',selection:'false'},'ask'),/must be a boolean/);
 for(const selection of [2,-1,'yes','no','null','selected text',{startLine:1},[],{}])assert.throws(()=>decodeAction({action:'editor',selection},'ask'),/Use \{"selection":true\}/);
 assert.throws(()=>decodeAction({action:'editor',selection:'false',unexpected:true},'ask'),/unknown field/);
 assert.deepEqual(decodeAction({action:'command',command:'echo test',network:'false'},'agent'),{action:'command',command:'echo test',network:false});
 assert.throws(()=>decodeAction({action:'command',command:'echo test',network:false},'ask'),/not allowed/);
 assert.throws(()=>decodeAction({action:'editor',selection:'false'},'agent',true),/not allowed/);
});

test('boolean parsing only applies to declared boolean arguments',()=>{
 const {decodeAction,validateAction}=require('../dist/actions');
 assert.deepEqual(decodeAction({action:'search',query:'false',pattern:'on',caseSensitive:0,regex:'off'},'ask'),{action:'search',query:'false',pattern:'on',caseSensitive:false,regex:false});
 assert.deepEqual(decodeAction({action:'write',path:'off',content:'false'},'agent'),{action:'write',path:'off',content:'false'});
 assert.throws(()=>decodeAction({action:'read',path:'a',startLine:'1'},'ask'),/must be an integer/);
 assert.throws(()=>decodeAction({action:'command',command:'echo',network:'yes'},'agent'),/must be a boolean/);
 assert.throws(()=>validateAction({action:'search',query:'text',regex:'off'},'ask'),/must be a boolean/);
});
