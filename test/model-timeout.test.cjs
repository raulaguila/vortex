const {test}=require('node:test');const assert=require('node:assert/strict');
const {Client}=require('../dist/providers');const {ProviderManager}=require('../dist/providerManager');const {parseRequest,defaultExecution}=require('../dist/protocol');
const provider=kind=>({id:'p',kind,name:'Test',baseUrl:'http://example.test'});
const stalled=(_url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
test('model timeout is validated and old profiles receive 120 seconds without losing other limits',async()=>{
 const data={modelPreferences:{execution:{maxSteps:42,commandTimeout:9,taskTimeout:900,tokenBudget:null}}};
 const storage={get:(key,fallback)=>data[key]??fallback,update:async(key,value)=>{data[key]=value;}};
 const manager=new ProviderManager(storage,{});assert.equal(manager.preferences().execution.firstResponseTimeout,120);assert.equal(manager.preferences().execution.maxRounds,42);
 for(const firstResponseTimeout of [0,-1,3601,1.5,'300',null])assert.throws(()=>parseRequest({type:'setExecution',requestId:'test',execution:{...defaultExecution(),firstResponseTimeout}}));
 await manager.setExecution({...defaultExecution(),firstResponseTimeout:600});assert.equal(new ProviderManager(storage,{}).preferences().execution.firstResponseTimeout,600);
 assert.equal(parseRequest({type:'setExecution',requestId:'test',execution:{...defaultExecution(),firstResponseTimeout:3600}}).execution.firstResponseTimeout,3600);
});
test('all five chat adapters actually abort the request at the configured deadline',async()=>{
 // AbortSignal.timeout timers are unrefed; keep the test runner alive until assertions finish.
 const keepAlive=setInterval(()=>{},1000);try{await Promise.all(['openai','compatible','ollama','anthropic','gemini'].map(async kind=>{
  const manager=new ProviderManager({get:(key,fallback)=>key==='providers'?[provider(kind)]:key==='modelPreferences'?{execution:{...defaultExecution(),firstResponseTimeout:1}}:fallback,update:async()=>{}},{get:async()=>''},stalled);const client=await manager.client('p'),start=Date.now();await assert.rejects(client.chat('m','system',[],new AbortController().signal),/configured timeout/);assert.ok(Date.now()-start>=900);assert.ok(Date.now()-start<3000);
 }));}finally{clearInterval(keepAlive);}
});
test('timeout after HTTP headers retains the timeout error, and Stop takes precedence',async()=>{
 const keepAlive=setInterval(()=>{},1000);try{
  const transport=async(_url,options)=>({ok:true,status:200,json:()=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))});
  await assert.rejects(new Client(provider('compatible'),'',transport,undefined,1).chat('m','system',[],new AbortController().signal),/configured timeout/);
  const controller=new AbortController();const pending=new Client(provider('compatible'),'',stalled,undefined,600).chat('m','system',[],controller.signal);controller.abort(new Error('user stopped'));await assert.rejects(pending,/user stopped/);
 }finally{clearInterval(keepAlive);}
});
test('native streaming uses the configured deadline too',async()=>{
 const keepAlive=setInterval(()=>{},1000);try{
  const transport=async(_url,options)=>new Response(new ReadableStream({start(stream){options.signal.addEventListener('abort',()=>stream.error(options.signal.reason),{once:true});}}),{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(new Client(provider('compatible'),'',transport,undefined,1).turn('m','system',[],new AbortController().signal,{tokens:16384,output:4096},[],()=>{}),/configured timeout/);
 }finally{clearInterval(keepAlive);}
});
