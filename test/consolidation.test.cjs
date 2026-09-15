const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {performMutation}=require('../dist/operation');const {ChangeStore}=require('../dist/changes');
const {QueryCache,mapLimited}=require('../dist/queryCache');const {SessionStore}=require('../dist/sessions');
const {acquireSessionLock}=require('../dist/sessionLock');
test('mutation faults stop at each durable stage, never repeat effects or proceed past a failed save',async()=>{
 for(const fail of ['prepared','applying','apply','applied','save','saved','record','recorded']){
  const calls=[],states=[];let writes=0;
  await assert.rejects(performMutation({id:'op',path:'file',phase:'prepared',outcome:'not_applied'},async state=>{states.push(state);if(state.phase===fail)throw new Error('disk unavailable');},async()=>{calls.push('apply');writes++;if(fail==='apply')throw new Error();},async()=>{calls.push('save');if(fail==='save')throw new Error();},async()=>{calls.push('record');if(fail==='record')throw new Error();}),e=>e.code===(['prepared','applying'].includes(fail)?'persistence':'uncertain_outcome'));
  assert.ok(writes<=1);if(['prepared','applying'].includes(fail))assert.equal(writes,0);if(fail==='save')assert.deepEqual(calls,['apply','save']);
 }
 const states=[];const result=await performMutation({id:'op',path:'file',phase:'prepared',outcome:'not_applied'},async s=>states.push(s),async()=>{},async()=>{},async()=>{});
 assert.equal(result.outcome,'applied');assert.deepEqual(states.map(s=>s.phase),['prepared','applying','applied','saved','recorded']);
});
test('journal persists snapshots and tolerates a final torn append',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-journal-'));try{
  const store=new ChangeStore(root),id='11111111-1111-1111-1111-111111111111';const c=await store.propose(id,'a','before','after');
  await store.operation(id,{id:c.id,path:'a',phase:'applying',outcome:'uncertain'});
  await fs.appendFile(path.join(root,id+'.changes.json.journal'),'{"torn":');
  assert.equal((await new ChangeStore(root).operations(id))[0].phase,'applying');await store.operation(id,{id:c.id,path:'a',phase:'saved',outcome:'partial'});assert.equal((await store.operations(id))[0].phase,'saved');assert.equal((await store.list(id))[0].before,'before');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('queries reuse discovery and bind cursors to filters, expiry and workspace invalidation',async()=>{
 let time=0,loads=0;const cache=new QueryCache(()=>time),loader=async()=>{loads++;return {files:['a','b'],excluded:'protected',capped:false};};
 const first=await cache.get('root/filter',undefined,loader),cursor=cache.next(first.query,1,12);const next=await cache.get('root/filter',cursor,loader);
 assert.equal(next.offset,1);assert.equal(next.line,12);assert.equal(loads,1);
 await assert.rejects(cache.get('other',cursor,loader),/expired/);time=300001;await assert.rejects(cache.get('root/filter',cursor,loader),/expired/);
 const fresh=await cache.get('root/filter',undefined,loader),freshCursor=cache.next(fresh.query,1);cache.invalidate();await assert.rejects(cache.get('root/filter',freshCursor,loader),/expired/);
 const evict=await cache.get('0',undefined,loader),old=cache.next(evict.query,1);for(let i=1;i<9;i++){time++;await cache.get(String(i),undefined,loader);}await assert.rejects(cache.get('0',old,loader),/expired/);
});
test('bounded reads preserve input order',async()=>{
 let active=0,peak=0;const result=await mapLimited(Array.from({length:40},(_,i)=>i),8,async n=>{active++;peak=Math.max(active,peak);await new Promise(r=>setImmediate(r));active--;return n*2;});
 assert.equal(peak,8);assert.deepEqual(result,Array.from({length:40},(_,i)=>i*2));
});
test('session backup recovery preserves the damaged snapshot and credentials are not involved',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-backup-'));try{
  const store=new SessionStore(root),session=store.create('first','ask',{providerId:'p',modelId:'m'});await store.save(session);session.title='second';await store.save(session);
  const file=path.join(root,session.id+'.json');await fs.writeFile(file,'damaged');await assert.rejects(store.load(session.id));
  assert.deepEqual(await store.recoverable(),[{id:session.id,kind:'backup'}]);await store.recover(session.id,'backup');assert.equal((await store.load(session.id)).title,'first');
  const damaged=(await fs.readdir(root)).find(f=>f.includes('.damaged-'));assert.equal(await fs.readFile(path.join(root,damaged),'utf8'),'damaged');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('atomic lock publication has an owner immediately and empty legacy locks require explicit recovery',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-publish-'));try{
  const id='11111111-1111-1111-1111-111111111111',lock=path.join(root,id+'.json.lock');const release=await acquireSessionLock(lock);
  const entries=await fs.readdir(lock);assert.equal(entries.length,1);assert.equal(JSON.parse(await fs.readFile(path.join(lock,entries[0]))).pid,process.pid);await release();
  await fs.mkdir(lock);await assert.rejects(acquireSessionLock(lock),/manual recovery/);const store=new SessionStore(root);assert.deepEqual(await store.recoverable(),[{id,kind:'lock'}]);await store.recover(id,'lock');await assert.rejects(fs.stat(lock));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('evaluation checks behavior rather than a matching source substring',async()=>{
 const {verifySum}=require('../scripts/eval-math.cjs');assert.equal(await verifySum('export const sum=(a,b)=>b+a;'),true);assert.equal(await verifySum('export const sum=(a,b)=>5; // a + b'),false);assert.equal(await verifySum('while(true){}'),false);
});
test('process termination around snapshot rename leaves a valid session and reclaimable lock',async()=>{
 const {spawn}=require('node:child_process');
 for(const stage of ['before','after']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-crash-'));
  try{
   const store=new SessionStore(root),session=store.create('original','ask',{providerId:'p',modelId:'m'});await store.save(session);
   const script=`const fs=require('node:fs/promises');const rename=fs.rename;fs.rename=async(a,b)=>{if(b===process.argv[1]&&process.argv[3]==='before')process.kill(process.pid,'SIGKILL');await rename(a,b);if(b===process.argv[1]&&process.argv[3]==='after')process.kill(process.pid,'SIGKILL');};const {SessionStore}=require(${JSON.stringify(path.resolve(__dirname,'../dist/sessions'))});(async()=>{const store=new SessionStore(process.argv[2]),s=await store.load(${JSON.stringify(session.id)});s.title='updated';await store.save(s);})().catch(()=>process.exit(2));`;
   const exit=await new Promise(resolve=>{const child=spawn(process.execPath,['-e',script,path.join(root,session.id+'.json'),root,stage],{stdio:'ignore'});child.on('exit',(code,signal)=>resolve({code,signal}));});
   assert.ok(exit.signal==='SIGKILL'||exit.code!==0);const recovered=await store.load(session.id);assert.equal(recovered.title,stage==='before'?'original':'updated');const release=await store.begin(recovered);await release();
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
});

test('profile migration publishes connections and preferences together despite delayed memento updates',async()=>{
 const {ProfileStore}=require('../dist/profileStore');const disk={providers:[{id:'preserved'}],modelPreferences:{schemaVersion:4}};let cache={...disk},fail=false;
 const source={get:(key,fallback)=>cache[key]??fallback,update:async(key,value)=>{if(fail)throw new Error('Disk unavailable');disk[key]=structuredClone(value);cache={modelPreferences:{schemaVersion:4}};}};
 const store=new ProfileStore(source);await store.update('modelPreferences',{schemaVersion:4,selected:{providerId:'preserved',modelId:'m'}});
 await store.update('providers',[{id:'preserved'},{id:'second'}]);assert.equal(disk.vortexProfile.providers.length,2);assert.equal(disk.vortexProfile.modelPreferences.selected.providerId,'preserved');
 cache={...disk};const restored=new ProfileStore(source);assert.deepEqual(restored.get('providers',[]),[{id:'preserved'},{id:'second'}]);
 fail=true;await assert.rejects(restored.update('providers',[]));assert.equal(restored.get('providers',[]).length,2);
});

test('discovery tolerates one watcher update, but never publishes repeatedly invalidated results',async()=>{
 const cache=new QueryCache();let calls=0;const data={files:['fresh'],capped:false,excluded:''};
 const found=await cache.get('workspace',undefined,async()=>{if(++calls===1)cache.invalidate();return data;});assert.equal(calls,2);assert.deepEqual(found.query.files,['fresh']);
 cache.invalidate();calls=0;await assert.rejects(cache.get('workspace',undefined,async()=>{calls++;cache.invalidate();return data;}),/Workspace changed/);assert.equal(calls,2);
});
