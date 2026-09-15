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

test('successful read loops stop after three identical results',async()=>{
 const h=harness([{action:'read',path:'a'}]);await h.run('Inspect project');assert.equal(h.tools.length,3);assert.equal(h.events.at(-1).status,'stopped');
});
test('read versions reject later external modifications or deletion',()=>{
 const h=harness([]);const {contentVersion}=require('../dist/readTools');h.agent.readVersions.set('/workspace/a',contentVersion('before'));
 assert.doesNotThrow(()=>h.agent.verifyRead({path:'/workspace/a',content:'before'}));
 assert.throws(()=>h.agent.verifyRead({path:'/workspace/a',content:'after'}),/changed/);
 assert.throws(()=>h.agent.verifyRead({path:'/workspace/a',content:null}),/changed/);
 h.agent.run=new AbortController();assert.throws(()=>h.agent.verifyRead({path:'/workspace/b',content:'existing'}),/Read the existing/);
});

test('task controls reflect saved outcomes and actual change availability',async()=>{
 const h=harness([]);h.agent.session={id:'session',mode:'ask',runState:'complete'};await h.agent.taskState();let state=h.events.at(-1);assert.equal(state.resume,false);assert.equal(state.reviewChanges,false);assert.equal(state.implementPlan,false);
 h.agent.session.runState='paused';await h.agent.taskState();assert.equal(h.events.at(-1).resume,true);
 h.agent.session.pendingTool={name:'command'};await h.agent.taskState();assert.equal(h.events.at(-1).resume,false);
 h.agent.session.mode='plan';h.agent.checklist=[{id:'a',text:'Do work',status:'pending'}];h.agent.reviews={availability:async()=>({reviewChanges:true,undoChanges:true})};await h.agent.taskState();assert.equal(h.events.at(-1).implementPlan,true);assert.equal(h.events.at(-1).undoChanges,true);
 h.agent.run=new AbortController();await h.agent.taskState();assert.equal(h.events.at(-1).implementPlan,false);assert.equal(h.events.at(-1).undoChanges,false);
});

test('standalone action announcements get one recovery, then real tools continue in the same mode',async()=>{
 for(const mode of ['ask','plan','agent'])for(const permission of ['supervised','autonomous']){
  const h=harness([{action:'finish',text:'Vou explorar os arquivos do workspace para entender o projeto.'},{action:'list',pattern:'src/**'},{action:'finish',text:'O projeto contém uma aplicação TypeScript.'}]);
  await h.run('O que pode me dizer sobre o projeto atual?',mode,permission);assert.equal(h.calls.length,3);assert.equal(h.tools.length,1);assert.equal(h.tools[0].action,'list');assert.equal(h.events.at(-1).status,'complete');assert.match(h.calls[1][2].at(-1).content,/not a new user request or authorization/);
 }
});
test('repeated announcements pause instead of reporting completion or looping',async()=>{
 const h=harness([{action:'finish',text:'I will inspect the workspace.'}]);await h.run('Describe this project','ask');assert.equal(h.calls.length,2);assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'stopped');assert.equal(h.agent.session.runState,'paused');
});
test('native announcement recovery retains tool result association',async()=>{
 const h=harness([]);let requests=0;
 h.agent.providers.toolProtocol=()=> 'native';h.agent.providers.providers=()=>[{id:'p',kind:'openai'}];
 h.agent.providers.client=async()=>({turn:async()=>++requests===1?{text:'I will inspect the project.',calls:[]}:requests===2?{text:'',calls:[{id:'read1',name:'read',arguments:{path:'README.md'}}]}:{text:'The project is an extension.',calls:[]}});
 await h.run('Describe the project','ask');assert.equal(requests,3);assert.equal(h.tools.length,1);assert.equal(h.agent.messages.filter(m=>m.toolResult)[0].toolResult.id,'read1');assert.equal(h.events.at(-1).status,'complete');
});
test('recovery never bypasses read-only policies and still stops on refusal',async()=>{
 const h=harness([{action:'finish',text:'Vou editar os arquivos.'},{action:'write',path:'a',content:'bad'},{action:'finish',text:'Use Agent para aplicar alterações.'}]);await h.run('Explain how to implement this','ask');assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'complete');
 const denied=harness([{action:'finish',text:'I will edit the file.'},{action:'write',path:'a',content:'new'}]);denied.agent.execute=async()=>{throw new (require('../dist/actions').ApprovalDenied)();};await denied.run('Edit a','agent');assert.equal(denied.calls.length,2);assert.equal(denied.events.at(-1).status,'stopped');
});
test('useful answers, questions, blockers and quoted examples do not trigger recovery',()=>{
 const {isActionAnnouncement}=require('../dist/intent');
 for(const text of ['Como posso ajudar?','O projeto usa TypeScript.','Vou verificar, mas preciso que você abra uma pasta.','I will inspect if you open the workspace.','"Vou explorar os arquivos."','Example: I will inspect files.','Vou explicar o padrão MVC.','Vou verificar os testes. Os anteriores passaram.'])assert.equal(isActionAnnouncement(text),false,text);
 for(const text of ['Vou explorar os arquivos do workspace para entender o projeto.','I’ll inspect the workspace.','Voy a analizar el proyecto.'])assert.equal(isActionAnnouncement(text),true,text);
});
test('stop and step limits take precedence over announcement recovery',async()=>{
 const h=harness([{action:'finish',text:'I will inspect the project.'}]);h.agent.providers.preferences=()=>({conversation:{language:'auto'},execution:{maxSteps:1,commandTimeout:60,taskTimeout:1800,tokenBudget:null}});await h.run('Inspect project','ask');assert.equal(h.calls.length,1);assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'stopped');
});

test('requested translations can legitimately contain an action announcement',async()=>{
 const h=harness([{action:'finish',text:'Vou explorar os arquivos.'}]);await h.run('Traduza: I will explore the files.','ask');assert.equal(h.calls.length,1);assert.equal(h.tools.length,0);assert.equal(h.events.at(-1).status,'complete');
});
