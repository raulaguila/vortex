const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {SessionStore}=require('../dist/sessions');const {fitContext}=require('../dist/context');const {systemPrompt}=require('../dist/prompt');
test('sessions persist conversation and checklist, search old content and reopen',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-sessions-'));try{const store=new SessionStore(dir);const s=store.create('Original title','plan',{providerId:'p',modelId:'m'});s.events=[{role:'user',text:'searchable detail'}];s.checklist=[{id:'a',text:'implement',status:'pending'}];await store.save(s);const reopened=new SessionStore(dir);assert.equal((await reopened.list('detail'))[0].id,s.id);assert.equal((await reopened.load(s.id)).checklist[0].text,'implement');await assert.rejects(reopened.load('../secrets'));await reopened.remove(s.id);assert.deepEqual(await reopened.list(),[]);}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('context fitting removes older pairs without mutating the saved conversation',()=>{const messages=[{role:'user',content:'task'},...Array.from({length:20},(_,i)=>({role:i%2?'user':'assistant',content:'x'.repeat(200)}))];const out=fitContext('system',messages,2048,512);assert.ok(out.removed>0);assert.ok(out.used<1536);assert.equal(messages.length,21);assert.equal(out.messages[0].content,'task');assert.throws(()=>fitContext('system',[{role:'user',content:'x'.repeat(3000)}],1024,256),/exceeds/);});
test('prompt stays concise, follows response language and enforces plan read-only tools',()=>{const plan=systemPrompt('plan','auto',[]);assert.ok(plan.includes("language of the user's message"));assert.ok(plan.includes('checklist'));assert.ok(!plan.includes('{"action":"write_file"'));assert.ok(plan.length<25000);assert.ok(systemPrompt('agent','en',[],false,'autonomous').includes('{"action":"write_file"'));});

test('preference writes remain authoritative with stale storage reads',async()=>{
  const {ProviderManager}=require('../dist/providerManager');
  const provider={id:'p',name:'Local',kind:'ollama',baseUrl:'http://localhost'};
  const manager=new ProviderManager({get:(key,fallback)=>key==='providers'?[provider]:fallback,update:async()=>{}},{get:async()=>'',store:async()=>{},delete:async()=>{}});
  await manager.setSelection({providerId:'p',modelId:'m'});await manager.applyMode('ask');
  await manager.setConversation({uiLanguage:'pt'});
  assert.deepEqual(manager.preferences().selected,{providerId:'p',modelId:'m'});
  assert.equal(manager.preferences().conversation.uiLanguage,'pt');
  assert.equal(manager.preferences().conversation.language,'auto');
});
test('context metadata is discovered again after restart and cached for execution',async()=>{
  const {ProviderManager}=require('../dist/providerManager');let calls=0;
  const provider={id:'p',name:'Local',kind:'ollama',baseUrl:'http://localhost'};
  const manager=new ProviderManager({get:(key,fallback)=>key==='providers'?[provider]:fallback,update:async()=>{}},{get:async()=>'',store:async()=>{},delete:async()=>{}},async()=>{calls++;return new Response(JSON.stringify({model_info:{'llama.context_length':32768}}));});
  const model={providerId:'p',modelId:'m'};await manager.ensureLimits(model);await manager.ensureLimits(model);
  assert.equal(calls,1);assert.equal(manager.contextBudget(model).tokens,32768);
});

test('API source ignores old saved token count; both surfaces receive the effective budget',async()=>{
 const {ProviderManager}=require('../dist/providerManager');const model={providerId:'p',modelId:'m'};const key=JSON.stringify(['p','m']);
 const data={providers:[{id:'p',name:'Local',kind:'ollama',baseUrl:'http://localhost'}],modelPreferences:{selected:model,context:{[key]:{source:'api',tokens:262144}}}};
 const manager=new ProviderManager({get:(k,d)=>data[k]??d,update:async(k,v)=>{data[k]=v;}},{get:async()=>'',store:async()=>{},delete:async()=>{}},async()=>new Response(JSON.stringify({model_info:{'llama.context_length':131072}})));
 await manager.inspect(model);const state=await manager.snapshot();
 assert.equal(state.selectedContext.tokens,131072);assert.equal(state.contextBudgets[key].tokens,131072);
 assert.equal(state.limits[key].input,131072);
 await manager.setContext(model,'custom',65536);const custom=await manager.snapshot();assert.equal(custom.selectedContext.tokens,65536);assert.equal(custom.contextBudgets[key].tokens,65536);
});

test('session policies migrate legacy modes and retain all six new combinations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-policy-'));const store=new SessionStore(dir);
 try{
  for(const legacy of ['ask','plan','supervised','autonomous']){
   const session=store.create('legacy',legacy,{providerId:'p',modelId:'m'});delete session.permission;await store.save(session);
   const loaded=await store.load(session.id);assert.equal(loaded.mode,['ask','plan'].includes(legacy)?legacy:'agent');
   assert.equal(loaded.permission,legacy==='autonomous'?'autonomous':'supervised');
  }
  for(const mode of ['ask','plan','agent'])for(const permission of ['supervised','autonomous']){
   const session=store.create('new',mode,{providerId:'p',modelId:'m'},permission);await store.save(session);
   const loaded=await store.load(session.id);assert.equal(loaded.mode,mode);assert.equal(loaded.permission,permission);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('live start protocol requires an explicit mode and permission, never legacy inference',()=>{
 const {parseRequest}=require('../dist/protocol');const base={type:'start',requestId:'policy',prompt:'hello',model:{providerId:'p',modelId:'m'}};
 for(const mode of ['ask','plan','agent'])for(const permission of ['supervised','autonomous'])assert.equal(parseRequest({...base,mode,permission}).permission,permission);
 for(const policy of [{mode:'agent'},{mode:'autonomous',permission:'autonomous'},{mode:'ask',permission:'full-access'},{mode:'ask',permission:true}])assert.throws(()=>parseRequest({...base,...policy}));
});

test('catalog refresh does not invalidate concurrent model context discovery',async()=>{
 const {ProviderManager}=require('../dist/providerManager');let resolveInfo;
 const data={providers:[{id:'p',name:'Local',kind:'ollama',baseUrl:'http://localhost'}]};
 const manager=new ProviderManager({get:(k,d)=>data[k]??d,update:async(k,v)=>{data[k]=v;}},{get:async()=>'',store:async()=>{},delete:async()=>{}},async(url)=>{
  if(url.endsWith('/api/show'))return new Promise(resolve=>{resolveInfo=resolve;});
  return new Response(JSON.stringify({models:[{name:'m'}]}));
 });
 const pending=manager.inspect({providerId:'p',modelId:'m'});
 while(!resolveInfo)await new Promise(r=>setTimeout(r,1));
 await manager.refresh('p','refresh',async()=>{});
 resolveInfo(new Response(JSON.stringify({model_info:{'test.context_length':262144}})));await pending;
 assert.equal(manager.contextBudget({providerId:'p',modelId:'m'}).tokens,262144);
});
test('provider saves remain usable when backing storage reads are stale',async()=>{
 const {ProviderManager}=require('../dist/providerManager');
 const manager=new ProviderManager({get:(k,d)=>d,update:async()=>{}},{get:async()=>'',store:async()=>{},delete:async()=>{}});
 const id=await manager.save({kind:'ollama',name:'Local',baseUrl:'http://localhost',key:'',clearKey:false});
 assert.equal(manager.providers()[0].id,id);await manager.setSelection({providerId:id,modelId:'m'});await manager.remove(id);
 assert.equal(manager.providers().length,0);assert.equal(manager.preferences().selected,null);
});
test('damaged sessions fail without replacing valid sessions',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-damaged-'));const store=new SessionStore(dir);
 try{
  const session=store.create('Valid','ask',{providerId:'p',modelId:'m'});await store.save(session);
  await fs.writeFile(path.join(dir,session.id+'.json'),JSON.stringify({...session,messages:null}));
  await assert.rejects(store.load(session.id),/damaged/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
