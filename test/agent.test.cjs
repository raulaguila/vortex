const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(name,...args){return name==='vscode'?{workspace:{isTrusted:true,workspaceFolders:[]}}:originalLoad.call(this,name,...args);};
const {AgentController}=require('../dist/agent');
Module._load=originalLoad;
const {isSocialMessage}=require('../dist/intent');

function harness(replies){
  const events=[],calls=[],tools=[];
  const manager={client:async()=>({chat:async(...args)=>{calls.push(args);return JSON.stringify(replies[Math.min(calls.length-1,replies.length-1)]);}}),preferences:()=>({conversation:{language:'auto'}}),ensureLimits:async()=>{},contextBudget:()=>({tokens:16384,output:4096,source:'fallback'})};
  const sessions={create:()=>({}),save:async()=>{}};
  const agent=new AgentController(manager,event=>events.push(event),sessions);
  agent.execute=async(action)=>{tools.push(action);return 'ok';};
  const run=(prompt,mode='agent',permission='supervised')=>agent.start({type:'start',requestId:'test',prompt,mode,permission,model:{providerId:'p',modelId:'m'}});
  return {agent,events,calls,tools,run};
}
test('execution token budget stops before an unaffordable provider request',async()=>{
 const h=harness([{action:'read',path:'a'}]);h.agent.providers.preferences=()=>({conversation:{language:'auto'},execution:{maxSteps:20,commandTimeout:60,taskTimeout:1800,tokenBudget:100}});
 await h.run('Read the project');assert.equal(h.calls.length,0);assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'stopped');
});
test('tool limit bounds a native batch without replaying unexecuted calls',async()=>{
 const h=harness([]);h.agent.providers.preferences=()=>({conversation:{language:'auto'},execution:{maxSteps:1,commandTimeout:60,taskTimeout:1800,tokenBudget:null}});
 h.agent.providers.toolProtocol=()=> 'native';h.agent.providers.providers=()=>[{id:'p',kind:'openai'}];h.agent.providers.client=async()=>({turn:async()=>({text:'',calls:[{id:'a',name:'read',arguments:{path:'a'}},{id:'b',name:'read',arguments:{path:'b'}}]})});
 await h.run('Read the project');assert.equal(h.tools.length,1);assert.equal(h.events.at(-1).status,'stopped');assert.equal(h.agent.messages.filter(m=>m.toolResult).length,2);
});
test('social guard matches full messages and preserves actual tasks and continuations',()=>{
  for(const text of ['oi','Oi!','Olá, Vortex! Tudo bem?','hello','thanks','boa noite','hola'])assert.equal(isSocialMessage(text),true,text);
  for(const text of ['Oi, corrija o login','hello, read README.md','continue','sim','implemente o plano','obrigado, agora rode os testes'])assert.equal(isSocialMessage(text),false,text);
});
test('greetings cannot invoke tools in any mode, even when the model requests writes',async()=>{
  for(const mode of ['ask','plan','agent'])for(const permission of ['supervised','autonomous']){
    const h=harness([{action:'write',path:'settings.json',content:'bad'},{action:'plan',items:[{id:'1',text:'invented',status:'done'}]},{action:'command',command:'bad'}]);
    await h.run('oi',mode,permission);
    assert.equal(h.tools.length,0);assert.equal(h.calls.length,3);
    assert.equal(h.events.filter(e=>e.type==='event'&&e.event.role==='activity').length,0);
    assert.equal(h.events.filter(e=>e.type==='checklist').length,0);
    assert.equal(h.events.at(-1).status,'error');
  }
});
test('social turn can recover with a direct reply and does not resume old tasks',async()=>{
  const h=harness([{action:'read',path:'README.md'},{action:'finish',text:'Oi! Como posso ajudar?'}]);
  h.agent.messages=[{role:'user',content:'old implementation request'}];
  h.agent.checklist=[{id:'old',text:'unfinished task',status:'pending'}];
  await h.run('oi');
  assert.equal(h.tools.length,0);assert.equal(h.calls.length,2);
  assert.ok(!h.calls[0][1].includes('unfinished task'));
  assert.deepEqual(h.calls[0][2],[{role:'user',content:'oi'}]);
  assert.equal(h.agent.checklist[0].status,'pending');
  assert.equal(h.events.at(-1).status,'complete');
});
test('plan mode accepts a direct answer without forcing a checklist',async()=>{
  const h=harness([{action:'finish',text:'A closure captures its lexical scope.'}]);
  await h.run('What is a closure?','plan');
  assert.equal(h.calls.length,1);assert.equal(h.tools.length,0);
  assert.equal(h.events.at(-1).status,'complete');
});
test('greeting plus concrete request still allows task tools',async()=>{
  const h=harness([{action:'read',path:'README.md'},{action:'finish',text:'Summary'}]);
  await h.run('Oi, leia README.md e resuma');
  assert.equal(h.tools.length,1);assert.equal(h.events.at(-1).status,'complete');
});
test('repeated malformed responses terminate after three attempts',async()=>{
  const h=harness([null]);await h.run('Implement a button');
  assert.equal(h.calls.length,3);assert.equal(h.tools.length,0);
  assert.equal(h.events.at(-1).status,'error');
});
test('repeated failing tools stop instead of cycling through twenty attempts',async()=>{
  const h=harness([{action:'read',path:'missing.txt'}]);let count=0;
  h.agent.execute=async()=>{count++;throw new Error('Not a file');};
  await h.run('Read the project');assert.equal(count,3);assert.equal(h.events.at(-1).status,'error');
});

test('denied actions end the turn without allowing an alternative tool',async()=>{
  const {ApprovalDenied}=require('../dist/actions');
  const h=harness([{action:'write',path:'a',content:'x'},{action:'command',command:'alternative'}]);
  let attempts=0;h.agent.execute=async()=>{attempts++;throw new ApprovalDenied();};
  await h.run('Implement the requested change');
  assert.equal(attempts,1);assert.equal(h.calls.length,1);
  assert.ok(h.events.some(e=>e.type==='event'&&e.event.role==='activity'&&e.event.text.includes('denied')));
});
test('read-only modes reject write attempts before the tool dispatcher',async()=>{
  for(const mode of ['ask','plan'])for(const permission of ['supervised','autonomous']){
    const h=harness([{action:'write',path:'a',content:'x'},{action:'finish',text:'Switch to Agent to implement.'}]);
    await h.run('Implement the change',mode,permission);assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'complete');
  }
});
test('planning executor accepts pending steps and rejects fabricated completion',async()=>{
  const agent=new AgentController({},()=>{},{});const signal=new AbortController().signal;
  const items=[{id:'a',text:'Implement login',status:'pending'}];
  await agent.execute({action:'plan',items},'plan',undefined,signal);
  await assert.rejects(agent.execute({action:'plan',items:[{...items[0],status:'done'}]},'plan',undefined,signal),/cannot mark/);
  await assert.rejects(agent.execute({action:'plan',items},'ask',undefined,signal),/not allowed/);
  assert.equal(agent.checklist[0].status,'pending');
});

test('mode and permission are supplied independently to the executor and prompt',async()=>{
 for(const permission of ['supervised','autonomous']){
  const h=harness([{action:'write',path:'file',content:'ok'},{action:'finish',text:'Done'}]);let received;
  h.agent.execute=async(...args)=>{received=args;return 'written';};
  await h.run('Implement the requested file','agent',permission);
  assert.equal(received[1],'agent');assert.equal(received[4],permission);
  assert.match(h.calls[0][1],new RegExp(permission.toUpperCase()+' PERMISSIONS'));
  assert.equal(h.events.at(-1).status,'complete');
 }
});
test('stop while the provider is running prevents dispatch and reports stopped',async()=>{
 const h=harness([{action:'write',path:'file',content:'bad'}]);
 const original=h.agent.providers.client;h.agent.providers.client=async()=>{const client=await original();return {chat:async(...args)=>{h.agent.stop();return client.chat(...args);}};};
 await h.run('Implement a change');assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'stopped');
});

test('run is locked while credentials resolve and Stop prevents the first provider call',async()=>{
 const h=harness([{action:'finish',text:'unexpected'}]);let unlock;
 h.agent.providers.client=()=>new Promise(resolve=>{unlock=resolve;});
 const first=h.run('Read a file');assert.equal(h.agent.busy,true);
 await assert.rejects(h.run('Another task'),/execução/);h.agent.stop();unlock({chat:async()=>{throw new Error('must not call');}});
 await first;assert.equal(h.events.at(-1).status,'stopped');
});

test('native calls execute sequentially and retain matching result IDs',async()=>{
 const h=harness([]);let count=0;const requests=[];
 h.agent.providers.toolProtocol=()=> 'native';h.agent.providers.providers=()=>[{id:'p',kind:'openai'}];
 h.agent.providers.client=async()=>({turn:async(_model,_system,messages)=>{requests.push(structuredClone(messages));return ++count===1?{text:'',calls:[{id:'a',name:'read',arguments:{path:'a'}},{id:'b',name:'read',arguments:{path:'b'}}]}:{text:'Done',calls:[]};}});
 await h.run('Read a and b','ask');assert.equal(h.tools.length,2);assert.deepEqual(requests[1].filter(m=>m.toolResult).map(m=>m.toolResult.id),['a','b']);assert.equal(h.events.at(-1).status,'complete');
});
test('native batch validation prevents any effects when one call is unauthorized',async()=>{
 const h=harness([]);h.agent.providers.toolProtocol=()=> 'native';h.agent.providers.providers=()=>[{id:'p',kind:'openai'}];
 h.agent.providers.client=async()=>({turn:async()=>({text:'',calls:[{id:'a',name:'read',arguments:{path:'a'}},{id:'b',name:'write',arguments:{path:'a',content:'bad'}}]})});
 await h.run('Review a','ask');assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'error');
});
test('cancel during a native batch stops remaining calls and closes the transcript',async()=>{
 const h=harness([]);let tools=0;h.agent.providers.toolProtocol=()=> 'native';h.agent.providers.providers=()=>[{id:'p',kind:'openai'}];
 h.agent.providers.client=async()=>({turn:async()=>({text:'',calls:[{id:'a',name:'read',arguments:{path:'a'}},{id:'b',name:'read',arguments:{path:'b'}}]})});
 h.agent.execute=async()=>{tools++;h.agent.stop();return 'read';};await h.run('Read a and b');assert.equal(tools,1);assert.equal(h.events.at(-1).status,'stopped');assert.equal(h.agent.messages.filter(m=>m.toolResult).length,2);
});
