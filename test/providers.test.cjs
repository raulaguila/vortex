const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ProviderManager} = require('../dist/providers/providerManager');
const {parseRequest} = require('../dist/ui/protocol');
class Storage {
  values = new Map();
  get(key, fallback) { return this.values.has(key) ? structuredClone(this.values.get(key)) : fallback; }
  async update(key, value) { this.values.set(key, structuredClone(value)); }
}
class Secrets {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async store(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}
const input = (overrides = {}) => ({name:'Personal',kind:'openai',baseUrl:'https://example.com/v1',key:'test-secret',clearKey:false,...overrides});
const response = ids => new Response(JSON.stringify({data:ids.map(id=>({id}))}));
function setup(transport = async () => response(['model-a'])) { const storage=new Storage(),secrets=new Secrets();return {storage,secrets,manager:new ProviderManager(storage,secrets,transport)}; }
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('existing provider records and IDs survive save; credentials never appear in snapshots',async()=>{
  const {manager,storage,secrets}=setup();
  await storage.update('providers',[{id:'legacy',name:'Old',kind:'openai',baseUrl:'https://example.com/v1'}]);await secrets.store('key:legacy','existing-secret');
  assert.equal(await manager.save(input({id:'legacy',name:'Renamed',key:''})),'legacy');
  assert.equal(await secrets.get('key:legacy'),'existing-secret');
  const snapshot=await manager.snapshot();assert.equal(snapshot.providers[0].hasKey,true);assert.equal(snapshot.providers[0].name,'Renamed');
  assert.ok(!JSON.stringify(snapshot).includes('existing-secret'));assert.ok(!JSON.stringify([...storage.values]).includes('existing-secret'));
});
test('credentials can be replaced, preserved and explicitly removed only for optional providers',async()=>{
  const {manager,secrets}=setup();const id=await manager.save(input({kind:'compatible'}));
  await manager.save(input({id,kind:'compatible',key:'replacement'}));assert.equal(await secrets.get('key:'+id),'replacement');
  await manager.save(input({id,kind:'compatible',key:''}));assert.equal(await secrets.get('key:'+id),'replacement');
  await manager.save(input({id,kind:'compatible',key:'',clearKey:true}));assert.equal(await secrets.get('key:'+id),'');
  await assert.rejects(manager.save(input({clearKey:true})),/exige/);
  const required=await manager.save(input());await assert.rejects(manager.save(input({id:required,kind:'anthropic',key:''})),/mudar o tipo/);
});
test('connection tests use unsaved credentials without changing storage',async()=>{
  let header;const {manager,storage,secrets}=setup(async(_url,opts)=>{header=opts.headers.Authorization;return response(['a','b']);});
  assert.equal(await manager.test(input()),2);assert.equal(header,'Bearer test-secret');assert.equal(storage.values.size,0);assert.equal(secrets.values.size,0);
});
test('model identities and preferences remain separate for two connections with the same model ID',async()=>{
  const {manager,storage,secrets}=setup();const a=await manager.save(input()),b=await manager.save(input());const ma={providerId:a,modelId:'same'},mb={providerId:b,modelId:'same'};
  await Promise.all([manager.favorite(ma,true),manager.favorite(mb,true),manager.manual(ma,false),manager.manual(mb,false)]);await manager.setSelection(ma);
  const restored=new ProviderManager(storage,secrets);assert.deepEqual(restored.preferences().selected,ma);assert.equal(restored.preferences().favorites.length,2);assert.equal(restored.preferences().manualModels.length,2);
  await restored.remove(a);assert.equal(restored.preferences().selected,null);assert.deepEqual(restored.preferences().favorites,[mb]);assert.deepEqual(restored.preferences().manualModels,[mb]);assert.equal(await secrets.get('key:'+a),undefined);
});
test('catalog errors and empty catalogs do not affect other connections; manual include_selection works after failure',async()=>{
  const {manager}=setup(async url=>url.includes('bad')?new Response('secret',{status:401}):response([]));
  const bad=await manager.save(input({baseUrl:'https://bad.example'})),good=await manager.save(input());
  await Promise.all([manager.refresh(bad,'bad-1',async()=>{}),manager.refresh(good,'good-1',async()=>{})]);
  const state=await manager.snapshot();assert.equal(state.providers[0].catalog.status,'error');assert.match(state.providers[0].catalog.error,/autenticação/);assert.equal(state.providers[1].catalog.status,'ready');assert.deepEqual(state.providers[1].catalog.models,[]);
  const manual={providerId:bad,modelId:'custom-id'};await manager.manual(manual,false);await manager.setSelection(manual);assert.deepEqual(manager.preferences().selected,manual);
});
test('late catalog responses cannot overwrite a newer query or resurrect a removed connection',async()=>{
  const waiters=[];const {manager}=setup(()=>new Promise(resolve=>waiters.push(resolve)));const id=await manager.save(input());
  const older=manager.refresh(id,'old',async()=>{});await tick();const newer=manager.refresh(id,'new',async()=>{});await tick();
  waiters[1](response(['new-model']));await newer;waiters[0](response(['old-model']));await older;
  assert.deepEqual((await manager.snapshot()).providers[0].catalog.models,['new-model']);assert.equal((await manager.snapshot()).providers[0].catalog.requestId,'new');
  const pending=manager.refresh(id,'removed',async()=>{});await tick();await manager.remove(id);waiters[2](response(['ghost']));await pending;assert.deepEqual((await manager.snapshot()).providers,[]);
});
test('editing a connection invalidates its in-flight catalog',async()=>{
  let finish;const {manager}=setup(()=>new Promise(resolve=>finish=resolve));const id=await manager.save(input());
  const pending=manager.refresh(id,'before-edit',async()=>{});await tick();await manager.save(input({id,name:'Updated',key:''}));finish(response(['old']));await pending;
  assert.equal((await manager.snapshot()).providers[0].catalog.status,'idle');
});
test('manual removal clears unavailable include_selection and favorite without selecting another model',async()=>{
  const {manager}=setup();const id=await manager.save(input());const model={providerId:id,modelId:'manual'};await manager.manual(model,false);await manager.favorite(model,true);await manager.setSelection(model);await manager.manual(model,true);
  assert.equal(manager.preferences().selected,null);assert.deepEqual(manager.preferences().favorites,[]);assert.deepEqual(manager.preferences().manualModels,[]);
});
test('legacy include_selection migrates once and cannot restore a deliberately cleared include_selection',async()=>{
  const {manager}=setup();const id=await manager.save(input());const legacy={providerId:id,modelId:'legacy-model'};
  await manager.migrateSelection(legacy);assert.deepEqual(manager.preferences().selected,legacy);await manager.setSelection(null);await manager.migrateSelection(legacy);assert.equal(manager.preferences().selected,null);
});
test('bridge rejects malformed requests and unknown provider kinds',()=>{
  for(const bad of [null,{}, {type:'saveProvider',requestId:'a',provider:input({kind:'__proto__'})},{type:'start',requestId:'a',model:{providerId:'p',modelId:''},mode:'ask',prompt:'hi'},{type:'favoriteModel',requestId:'a',model:{providerId:'p',modelId:'m'},favorite:'yes'},{type:'execute',requestId:'a'}])assert.throws(()=>parseRequest(bad));
  assert.equal(parseRequest({type:'saveProvider',requestId:'a',provider:input()}).type,'saveProvider');
});
test('remote HTTP is accepted and TLS insecure persists only for compatible providers',async()=>{
  const {manager}=setup();const id=await manager.save(input({kind:'compatible',baseUrl:'http://192.168.1.30:8080/v1',tlsInsecure:true}));
  assert.equal(manager.providers()[0].baseUrl,'http://192.168.1.30:8080/v1');assert.equal(manager.providers()[0].tlsInsecure,true);
  await manager.save(input({id,kind:'compatible',key:'',tlsInsecure:false}));assert.equal(manager.providers()[0].tlsInsecure,false);
  const other=await manager.save(input({tlsInsecure:true}));assert.equal(manager.providers().find(p=>p.id===other).tlsInsecure,false);
});

test('old preferences gain conversation and context defaults without losing selections',async()=>{
 const {manager,storage}=setup();const id=await manager.save(input());const ref={providerId:id,modelId:'same'};
 await storage.update('modelPreferences',{selected:ref,favorites:[ref],manualModels:[]});
 assert.deepEqual(manager.preferences().selected,ref);assert.equal(manager.preferences().conversation.language,'auto');assert.equal(manager.preferences().conversation.uiLanguage,'en');assert.deepEqual(manager.preferences().context,{});
});
test('mode defaults only change include_selection when applied, and deletion clears defaults',async()=>{
 const {manager}=setup();const id=await manager.save(input());const a={providerId:id,modelId:'a'},b={providerId:id,modelId:'b'};
 await manager.setSelection(a);await manager.setDefault('plan',b);assert.deepEqual(manager.preferences().selected,a);await manager.applyMode('plan');assert.deepEqual(manager.preferences().selected,b);await manager.setSelection(a);await manager.applyMode('ask');assert.deepEqual(manager.preferences().selected,a);await manager.remove(id);assert.equal(manager.preferences().defaults.plan,null);
});
test('context custom values cannot exceed an API-reported model limit',async()=>{
 const {manager}=setup(async()=>new Response(JSON.stringify({context_length:8192,max_tokens:2048})));const id=await manager.save(input({kind:'compatible'}));const model={providerId:id,modelId:'local'};
 assert.equal((await manager.inspect(model)).input,8192);await assert.rejects(manager.setContext(model,'custom',8193),/Maximum/);await manager.setContext(model,'custom',4096);assert.equal(manager.contextBudget(model).tokens,4096);
});
test('conversation patches reject unsupported language, font values and unknown keys',()=>{
 for(const patch of [{uiLanguage:'fr'},{fontSize:99},{sendKey:'space'},{apiKey:'bad'}])assert.throws(()=>parseRequest({type:'setConversation',requestId:'test',patch}));
 assert.equal(parseRequest({type:'setConversation',requestId:'test',patch:{uiLanguage:'pt',language:'auto'}}).type,'setConversation');
});

test('missing connection referenced by saved selection does not prevent settings and history from loading',async()=>{
 const {storage,manager}=setup();storage.values.set('modelPreferences',{selected:{providerId:'removed',modelId:'m'},manualModels:[{providerId:'removed',modelId:'m'}]});
 const state=await manager.snapshot();assert.deepEqual(state.providers,[]);assert.deepEqual(state.effectiveProtocols,{});assert.equal(state.preferences.selected.providerId,'removed');
});
