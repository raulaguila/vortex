const {test}=require('node:test');const assert=require('node:assert/strict');
const {migrateExecution,ResponseDeadline,awaitApproval}=require('../dist/execution');
const {ProviderManager}=require('../dist/providerManager');const {ContextEstimator}=require('../dist/context');
const {Client}=require('../dist/providers');const {RunTrace}=require('../dist/trace');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('old execution limits migrate independently; malformed stored values are replaced',()=>{
 const p=migrateExecution({maxSteps:42,modelTimeout:900,commandTimeout:9});assert.equal(p.maxRounds,42);assert.equal(p.maxToolCalls,42);assert.equal(p.firstResponseTimeout,900);assert.equal(p.idleTimeout,900);assert.equal(p.commandTimeout,9);assert.equal(migrateExecution({maxRounds:0,idleTimeout:'9'}).idleTimeout,120);
});
test('active streaming resets idle timeout and first response timeout ends after progress',async()=>{
 const d=new ResponseDeadline({firstResponseTimeout:.025,idleTimeout:.06});await wait(10);d.progress();await wait(30);assert.equal(d.controller.signal.aborted,false);d.progress();await wait(35);assert.equal(d.controller.signal.aborted,false);await wait(35);assert.equal(d.controller.signal.reason.code,'idle_timeout');d.dispose();
});
test('late approval cannot authorize a cancelled run',async()=>{
 const c=new AbortController();let approve;const pending=awaitApproval(()=>new Promise(r=>approve=r),c.signal);c.abort(new Error('stopped'));await assert.rejects(pending,/stopped/);approve('Allow');
});
test('tool-only stream progress counts, heartbeat does not',async()=>{
 const p={id:'p',kind:'compatible',name:'T',baseUrl:'http://localhost'};
 const transport=async()=>new Response(new ReadableStream({start(s){s.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'a',function:{name:'read_file',arguments:'{"path":"x"}'}}]}}]})+'\n\n'));s.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'tool_calls'}]})+'\n\n'));s.close();}}),{headers:{'content-type':'text/event-stream'}});
 const client=new Client(p,'',transport);let progress=0;client.onProgress=()=>progress++;const turn=await client.turn('m','s',[],new AbortController().signal,{tokens:1000,output:100},[],()=>{});assert.equal(turn.calls[0].id,'a');assert.equal(progress,1);
});
test('context calibration is scoped to model and uses five samples',()=>{
 const estimator=new ContextEstimator(),payload='x'.repeat(300);const initial=estimator.estimate('p:m',payload);assert.equal(initial,136);for(let i=0;i<5;i++)estimator.record('p:m',payload,200);assert.equal(estimator.estimate('p:m',payload),256);assert.equal(estimator.estimate('other',payload),initial);estimator.record('p:m',payload,0);assert.equal(estimator.estimate('p:m',payload),256);
});
test('model section save is atomic and rejects removed connections',async()=>{
 let writes=0;const manager=new ProviderManager({get:(k,f)=>k==='providers'?[{id:'p',kind:'compatible'}]:f,update:async()=>writes++},{});
 const old=manager.preferences();await assert.rejects(manager.saveModels({defaults:{ask:null,plan:null,agent:null},favorites:[{providerId:'missing',modelId:'m'}],manualModels:[],context:{},toolProtocols:{}}));assert.equal(writes,0);assert.deepEqual(manager.preferences(),old);
});
test('new run owns trace even if old run flushes later',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-traces-'));try{const file=path.join(dir,'last.json');const a=new RunTrace(file,{sessionId:'old',model:{modelId:'m'}});await a.save();const b=new RunTrace(file,{sessionId:'new',model:{modelId:'m'}});await b.save();await b.finish('complete',[]);await a.finish('complete',[]);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).conversation_id,'new');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('connection timeouts override globals and otherwise inherit them',async()=>{
 for(const custom of [null,{firstResponseTimeout:7,idleTimeout:15}]){
  const manager=new ProviderManager({get:(k,f)=>k==='providers'?[{id:'p',kind:'compatible',name:'T',baseUrl:'http://local',timeouts:custom}]:k==='modelPreferences'?{execution:{modelTimeout:900}}:f,update:async()=>{}},{get:async()=>''});const client=await manager.client('p');assert.equal(client.modelTimeout.firstResponseTimeout,custom?.firstResponseTimeout||900);assert.equal(client.modelTimeout.idleTimeout,custom?.idleTimeout||900);
 }
});
test('trace write failure is reported without throwing into execution',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-trace-failure-'));try{const file=path.join(dir,'parent');await fs.writeFile(file,'file');let errors=0;const trace=new RunTrace(path.join(file,'flow'),{sessionId:'s',model:{modelId:'m'}},()=>errors++);await trace.finish('complete',[]);assert.equal(errors,1);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unchanged API context can be saved after restart without rediscovering every model',async()=>{
 const key=JSON.stringify(['p','m']);const preferences={context:{[key]:{source:'api',tokens:32768}}};const manager=new ProviderManager({get:(k,f)=>k==='providers'?[{id:'p',kind:'compatible'}]:k==='modelPreferences'?preferences:f,update:async()=>{}},{});const p=manager.preferences();await manager.saveModels({defaults:p.defaults,favorites:[],manualModels:[],context:p.context,toolProtocols:{}});assert.equal(manager.preferences().context[key].tokens,32768);
});

test('malformed execution requests report validation errors',()=>{const {parseRequest}=require('../dist/protocol');for(const execution of [undefined,null,{},'invalid'])assert.throws(()=>parseRequest({type:'setExecution',requestId:'test',execution}),/Mensagem inválida/);});
