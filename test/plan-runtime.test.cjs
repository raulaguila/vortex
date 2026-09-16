const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {AgentRuntime}=require('../dist/core/agentRuntime'),{SessionStore}=require('../dist/session/sessions');
const proposal=(count=3,human=false)=>({action:'propose_plan',objective:'Check the project',steps:Array.from({length:count},(_,i)=>({title:'Check '+i,objective:'Verify project',depends_on:i?[i]:[],criteria:[{description:'Check passed',verification:human?'human':'command',...(human?{}:{command:'node --version',cwd:'.'})}]}))});
async function fixture(t,respond,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-plan-runtime-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const events=[],calls=[],effects=[],model={providerId:'p',modelId:'m'};
 const store=new SessionStore(path.join(root,'sessions'));let runtime;
 const respondTo=async(system,messages)=>{calls.push({system,messages:structuredClone(messages)});return respond({system,messages,runtime});};
 const client={chat:async(_m,system,messages)=>JSON.stringify(await respondTo(system,messages)),turn:async(_m,system,messages)=>{const {action,...args}=await respondTo(system,messages);return action==='finish'?{kind:'final',stopReason:'stop',text:args.text,calls:[]}:{kind:'tool_use',stopReason:'tool_use',text:'',calls:[{id:'call-'+calls.length,name:action,arguments:args}]};}};
 const manager={preferences:()=>({selected:model,conversation:{language:'en'},execution:{maxRounds:50,maxToolCalls:50,...options}}),providers:()=>[{id:'p',kind:options.kind||'compatible'}],toolProtocol:()=>options.native?'native':'compatibility',applyMode:async()=>{},client:async()=>client,ensureLimits:async()=>{},contextBudget:()=>({tokens:32000,output:4000})};
 runtime=new AgentRuntime(manager,m=>events.push(structuredClone(m)),store,undefined,undefined,undefined,path.join(root,'flow.json'),{trusted:()=>true,roots:()=>[],pickRoot:async()=>undefined,choosePermission:async()=>undefined,confirmUncertain:async()=>true,execute:async a=>{effects.push(a);return JSON.stringify({command:a.command,cwd:a.cwd||'.',exit_code:0,cancelled:false,execution_location:'host',fingerprint:'hash',output:'OK'});}});runtime.workspaceFingerprint=async()=> 'hash';
 const start=(override={})=>runtime.start({type:'start',requestId:'propose',prompt:'Build three related improvements',model,mode:'plan',permission:'supervised',...override});
 const approve=()=>runtime.planAction({type:'approvePlan',requestId:'approve',sessionId:runtime.session.id,planId:runtime.session.plan.plan_id,version:runtime.session.plan.version,permission:'supervised'});
 return {runtime,events,calls,effects,start,approve,store};
}
function successful({system}){
 if(!system.includes('<execution_context>'))return proposal();
 return {action:'report_step_result',outcome:'completed',summary:'Work ready for host verification'};
}
test('three controlled steps advance through one runtime loop and persist correlated evidence',async t=>{
 const h=await fixture(t,successful);await h.start();assert.equal(h.runtime.session.plan.status,'proposed');assert.equal(h.effects.length,0);await h.approve();assert.equal(h.runtime.session.plan.status,'completed');assert.equal(h.effects.length,3);
 const saved=await h.store.load(h.runtime.session.id);assert.deepEqual(saved.plan.executions.map(s=>s.status),['completed','completed','completed']);assert.equal(saved.events.filter(e=>e.role==='user').length,1);assert.ok(h.calls.slice(1).every(c=>c.system.includes('<execution_context>')));
 const ids=saved.plan.executions.flatMap(s=>s.attempts.flatMap(a=>a.evidence.map(e=>e.id)));assert.equal(new Set(ids).size,3);assert.ok(saved.messages.filter(m=>m.toolResult).every(m=>m.toolResult.id));
});
test('plain final text cannot complete an active step and is bounded',async t=>{
 const h=await fixture(t,({system})=>system.includes('<execution_context>')?{action:'finish',text:'All done.'}:proposal(1));await h.start();await h.approve();assert.equal(h.runtime.session.plan.executions[0].status,'failed');assert.equal(h.effects.length,0);assert.equal(h.calls.length,4);
});
test('one global tool limit bounds all steps without resetting on advancement',async t=>{
 const h=await fixture(t,successful,{maxToolCalls:3});await h.start();await h.approve();assert.equal(h.runtime.session.plan.executions[0].status,'completed');assert.equal(h.runtime.session.plan.executions[1].status,'interrupted');assert.equal(h.runtime.session.plan.executions[2].status,'pending');assert.equal(h.effects.length,1);
});
test('manual review persists and rejects stale decisions; confirmation completes without invented checks',async t=>{
 const h=await fixture(t,({system,runtime})=>{if(!system.includes('<execution_context>'))return proposal(1,true);const p=runtime.session.plan,a=p.executions[0].attempts.at(-1);if(!a.evidence.length)return {action:'read_file',path:'a.txt'};return {action:'report_step_result',outcome:'completed',summary:'Ready for visual review',evidence:[{criterion_id:'criterion-1',tool_call_ids:[a.evidence[0].id]}],remaining_issues:[]};});await h.start();await h.approve();let p=h.runtime.session.plan;assert.equal(p.executions[0].status,'waiting_user');await h.runtime.load(h.runtime.session.id);p=h.runtime.session.plan;
 const msg={type:'reviewStep',requestId:'review',sessionId:h.runtime.session.id,planId:p.plan_id,version:p.version,stepId:p.active_step,attempt:1,decision:'confirm',comment:'Reviewed'};await assert.rejects(h.runtime.planAction({...msg,attempt:2}),/no longer/);await h.runtime.planAction(msg);assert.equal(p.status,'completed');await assert.rejects(h.runtime.planAction(msg),/not awaiting/);
});
test('unapproved plan prevents direct Agent mutation even if the model asks for it',async t=>{
 const h=await fixture(t,()=>proposal(1));await h.start();await assert.rejects(h.runtime.start({type:'start',requestId:'bypass',prompt:'Do it',mode:'agent',permission:'autonomous',model:{providerId:'p',modelId:'m'}}),/Approve or resume/);assert.equal(h.effects.length,0);
});
test('Stop after a mutation preserves uncertain operation and never replays it on load',async t=>{
 const h=await fixture(t,({system})=>system.includes('<execution_context>')?{action:'write_file',path:'a.txt',content:'changed'}:proposal(1,true));await h.start();
 h.runtime.host.execute=async()=>{h.effects.push('changed');h.runtime.stop();h.runtime.run.signal.throwIfAborted();};
 await h.approve();assert.equal(h.effects.length,1);assert.equal(h.runtime.session.plan.executions[0].status,'interrupted');assert.equal(h.runtime.session.pendingTool.name,'write_file');
 await h.runtime.load(h.runtime.session.id);assert.equal(h.effects.length,1);assert.equal(h.runtime.busy,false);assert.equal(h.runtime.session.plan.status,'paused');
 h.runtime.host.confirmUncertain=async()=>false;const p=h.runtime.session.plan;await assert.rejects(h.runtime.planAction({type:'resumePlan',requestId:'resume',sessionId:h.runtime.session.id,planId:p.plan_id,version:p.version,stepId:p.active_step,attempt:1}),/Review the workspace/);assert.equal(h.effects.length,1);
});
test('persistence failure before next step stops advancement and new actions',async t=>{
 const h=await fixture(t,successful);await h.start();const save=h.store.save.bind(h.store);h.store.save=async session=>{if(session.plan?.executions[0].status==='completed')throw new Error('Disk unavailable');await save(session);};
 await h.approve();assert.equal(h.effects.length,1);assert.equal(h.runtime.session.plan.executions[1].status,'pending');assert.ok(h.events.some(e=>e.type==='runFailure'&&e.code==='persistence'));assert.equal(h.runtime.busy,false);
});
test('reload during a persisted validation requires explicit new attempt',async t=>{
 const {PlanController}=require('../dist/plan/plan');const h=await fixture(t,successful);await h.start();const c=new PlanController(h.runtime.session.plan);c.approve(1,'supervised');c.begin();c.record({id:'e',tool:'read_file',status:'success',timestamp:Date.now()});c.prepareValidation({execution_id:c.state.execution_id,plan_version:1,step_id:'step-1',attempt:1,outcome:'completed',summary:'Checking',evidence:[{criterion_id:'criterion-1',tool_call_ids:['e']}],remaining_issues:[]});h.runtime.session.runState='running';await h.store.save(h.runtime.session);
 const loaded=await h.store.load(h.runtime.session.id);assert.equal(loaded.runState,'paused');assert.equal(loaded.plan.status,'paused');assert.equal(loaded.plan.executions[0].status,'interrupted');assert.equal(h.effects.length,0);
});
test('another window cannot approve or resume a session locked by the first window',async t=>{
 const h=await fixture(t,successful);await h.start();const other=new SessionStore(h.store.directory);const same=await other.load(h.runtime.session.id);const release=await h.store.begin(h.runtime.session);try{await assert.rejects(other.begin(same),/another|running|locked|active/i);}finally{await release();}assert.equal(h.effects.length,0);
});
test('legacy checklists load as unverified records without plan authorization',async t=>{
 const h=await fixture(t,successful);const s=h.store.create('Old plan','plan',{providerId:'p',modelId:'m'});s.checklist=[{id:'old',text:'Change code',status:'completed'}];await h.store.save(s);const loaded=await h.store.load(s.id);assert.equal(loaded.plan,undefined);assert.equal(loaded.checklist[0].status,'completed');
});
test('tool denial pauses the plan; explicit resume opens a new attempt and discards read snapshots',async t=>{
 const {ApprovalDenied}=require('../dist/tools/actions');const h=await fixture(t,successful);await h.start();const execute=h.runtime.host.execute;h.runtime.host.execute=async()=>{throw new ApprovalDenied('Command denied');};await h.approve();const p=h.runtime.session.plan;assert.equal(p.executions[0].status,'interrupted');assert.equal(p.executions[1].status,'pending');assert.equal(p.executions[0].attempts[0].evidence.length,0);
 h.runtime.readVersions.set('a','stale');h.runtime.host.execute=async a=>{assert.equal(h.runtime.readVersions.size,0);return execute(a);};await h.runtime.planAction({type:'resumePlan',requestId:'resume',sessionId:h.runtime.session.id,planId:p.plan_id,version:p.version,stepId:p.active_step,attempt:1});assert.equal(p.status,'completed');assert.equal(p.executions[0].attempts.length,2);
});
test('task deadline is shared across steps instead of restarting after completion',async t=>{
 const h=await fixture(t,async args=>{const result=successful(args);if(result.action==='report_step_result')await new Promise(r=>setTimeout(r,650));return result;},{taskTimeout:1});await h.start();await h.approve();assert.equal(h.runtime.session.plan.executions[0].status,'completed');assert.equal(h.runtime.session.plan.executions[1].status,'interrupted');assert.equal(h.effects.length,1);assert.ok(h.events.some(e=>e.type==='runFailure'&&e.code==='task_timeout'));
});
test('approval persisted before the first attempt can be resumed after a restart',async t=>{
 const {PlanController}=require('../dist/plan/plan');const {parseRequest}=require('../dist/ui/protocol');const h=await fixture(t,successful);await h.start();const p=h.runtime.session.plan;new PlanController(p).approve(1,'supervised');await h.store.save(h.runtime.session);await h.runtime.load(h.runtime.session.id);
 const request={type:'resumePlan',requestId:'resume',sessionId:h.runtime.session.id,planId:p.plan_id,version:1};await h.runtime.planAction(request);assert.equal(h.runtime.session.plan.status,'completed');assert.equal(h.effects.length,3);
});

for(const kind of ['compatibility','openai','anthropic','gemini','ollama','compatible']){
 test('rejected proposal cannot become a successful Markdown plan: '+kind,async t=>{
  let n=0;const h=await fixture(t,()=>{n++;if(n===1){const p=proposal(1);delete p.steps[0].criteria[0].description;return p;}if(n===2)return {action:'finish',text:'O plano foi proposto. Mude para Agent.'};return proposal(1);},{native:kind!=='compatibility',kind:kind==='compatibility'?'compatible':kind});
  await h.start({prompt:'planeje as mudanças'});
  assert.equal(h.calls.length,3);assert.equal(h.runtime.session.plan.status,'proposed');assert.equal(h.effects.length,0);
  assert.ok(h.calls[1].messages.some(m=>m.content.includes('criteria[0].description is required')));
  assert.ok(h.calls[2].messages.some(m=>m.content.includes('No valid plan has been accepted')));
  assert.equal(h.events.some(e=>e.event?.text==='O plano foi proposto. Mude para Agent.'),false);
  assert.ok(h.events.some(e=>e.type==='planState'&&e.plan?.status==='proposed'));
  assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'stopped');
  assert.equal((await h.store.load(h.runtime.session.id)).plan.steps[0].criteria[0].description,'Check passed');
 });
}
for(const native of [false,true]){
 test('proposal recovery stays bounded despite intervening valid reads: '+native,async t=>{
  let n=0;const h=await fixture(t,()=>{n++;if(n===1){const p=proposal(1);delete p.steps[0].criteria[0].description;return p;}return n%2===0?{action:'list_files'}:{action:'finish',text:'Plan proposed.'};},{native});
  await h.start();assert.equal(h.calls.length,5);assert.equal(h.runtime.session.plan,undefined);
  assert.ok(h.events.some(e=>e.type==='runFailure'&&e.message.includes('No plan is ready for approval')));assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'error');
 });
 test('explicit planning cannot end in text alone: '+native,async t=>{
  const h=await fixture(t,()=>({action:'finish',text:'1. Fix sum. 2. Run tests.'}),{native});await h.start({prompt:'planeje as mudanças'});
  assert.equal(h.calls.length,3);assert.equal(h.runtime.session.plan,undefined);assert.equal(h.effects.length,0);assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'error');
 });
 test('conceptual Plan questions and social messages still finish normally: '+native,async t=>{
  const h=await fixture(t,()=>({action:'finish',text:'A closure captures its lexical environment.'}),{native});await h.start({prompt:'What is a closure?'});assert.equal(h.calls.length,1);assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'complete');
  await h.start({prompt:'oi'});assert.equal(h.calls.length,2);assert.equal(h.runtime.session.plan,undefined);
 });
 test('Agent proposal rejection also cannot masquerade as success: '+native,async t=>{
  let n=0;const h=await fixture(t,()=>{if(!n++){const p=proposal(1);p.steps[0].depends_on=[2];return p;}return {action:'finish',text:'The implementation plan is ready.'};},{native});
  await h.start({mode:'agent'});assert.equal(h.calls.length,3);assert.equal(h.runtime.session.plan,undefined);assert.equal(h.effects.length,0);assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'error');
 });
 test('old proposal is not mistaken for a successful revision: '+native,async t=>{
  let revise=false;const h=await fixture(t,()=>revise?{action:'finish',text:'Updated plan is ready.'}:proposal(1),{native});await h.start();const prior=structuredClone(h.runtime.session.plan);revise=true;
  await h.start({requestId:'revision',prompt:'Revise the plan'});assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'error');assert.deepEqual(h.runtime.session.plan,prior);
 });
}

test('empty native response during proposal recovery keeps usage and shares the rejection limit',async t=>{
 const {EmptyModelResponse}=require('../dist/core/native');let n=0;
 const h=await fixture(t,()=>{n++;if(n===1){const p=proposal(1);delete p.steps[0].criteria[0].description;return p;}throw new EmptyModelResponse({kind:'final',stopReason:'stop',text:'',calls:[],usage:{input:123,output:5}});},{native:true});
 await h.start();assert.equal(h.calls.length,3);assert.equal(h.runtime.session.plan,undefined);assert.equal(h.events.filter(e=>e.type==='usage'&&e.input===123).length,2);assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'error');
 assert.ok(h.calls[2].messages.some(m=>m.origin==='vortex_orchestrator'&&m.content.includes('Example arguments')));
});
test('proposal recovery can succeed after an empty native response',async t=>{
 const {EmptyModelResponse}=require('../dist/core/native');let n=0;
 const h=await fixture(t,()=>{n++;if(n===1){const p=proposal(1);delete p.steps[0].criteria[0].description;return p;}if(n===2)throw new EmptyModelResponse({kind:'final',stopReason:'stop',text:'',calls:[]});return proposal(1);},{native:true});
 await h.start();assert.equal(h.calls.length,3);assert.equal(h.runtime.session.plan.status,'proposed');assert.equal(h.effects.length,0);
});

test('Agent cannot replace its rejected proposal with mutations or commands',async t=>{
 let n=0;const h=await fixture(t,()=>{n++;if(n===1){const p=proposal(1);delete p.steps[0].criteria[0].description;return p;}return n===2?{action:'write_file',path:'sum.js',content:'changed'}:{action:'run_command',command:'npm test'};},{native:true});
 await h.start({mode:'agent'});assert.equal(h.calls.length,3);assert.equal(h.effects.length,0);assert.equal(h.runtime.session.plan,undefined);assert.equal(h.events.findLast(e=>e.type==='runEnd').status,'error');
});

for(const native of [false,true]){
 test('each approved step gets fresh orchestration, never the earlier approval wait: '+native,async t=>{
  const h=await fixture(t,successful,{native});await h.start();await h.approve();assert.equal(h.runtime.session.plan.status,'completed');
  for(const call of h.calls.slice(1)){
   const envelope=JSON.parse(call.system.match(/<execution_context>(.*?)<\/execution_context>/s)[1]);
   assert.equal(call.messages[0].origin,'vortex_orchestrator');assert.match(call.messages[0].content,/user approved/);
   assert.ok(call.messages[0].content.includes('"step_id":"'+envelope.step_id+'"'));
   assert.equal(call.messages.some(m=>m.toolResult?.name==='propose_plan'),false);
   assert.equal(call.messages.some(m=>m.toolCalls?.some(c=>c.name==='report_step_result')),false);
  }
  assert.ok(h.runtime.session.messages.some(m=>m.toolResult?.name==='propose_plan'),'history is retained');
 });
 test('stale IDs, empty output and final prose share a bounded step recovery without false recovered badges: '+native,async t=>{
  const {EmptyModelResponse}=require('../dist/core/native');let n=0;
  const h=await fixture(t,({system})=>{if(!system.includes('<execution_context>'))return proposal(1);n++;
   if(n===1)return {action:'report_step_result',execution_id:'old',plan_version:1,step_id:'wrong',attempt:99,outcome:'completed',summary:'Waiting for approval',evidence:[],remaining_issues:[]};
   if(n===2&&native)throw new EmptyModelResponse({kind:'final',stopReason:'stop',text:'',calls:[]});
   return {action:'finish',text:'Waiting for plan approval.'};
  },{native});await h.start();await h.approve();assert.equal(n,3);assert.equal(h.runtime.session.plan.executions[0].status,'failed');assert.equal(h.effects.length,0);
  assert.equal(h.events.filter(e=>e.type==='activityUpdate'&&e.activity.status==='recovered').length,0);
  const correction=h.calls.at(-1).messages.findLast(m=>m.content.includes('host supplies execution identity'));
  assert.ok(correction);assert.match(correction.content,/already approved/);
 });
 test('step recovery uses current evidence then advances without a second plan approval: '+native,async t=>{
  let invalid=true;const h=await fixture(t,args=>{if(args.system.includes('<execution_context>')&&invalid){invalid=false;return {action:'finish',text:'Please approve the plan.'};}return successful(args);},{native});
  await h.start();await h.approve();assert.equal(h.runtime.session.plan.status,'completed');assert.equal(h.runtime.session.plan.version,1);assert.equal(h.effects.length,3);
  assert.ok(h.events.some(e=>e.type==='activityUpdate'&&e.activity.status==='recovered'));
  assert.ok(h.runtime.session.plan.executions.every(e=>e.attempts.length===1));
 });
 test('human criterion cannot ask for confirmation with no implementation evidence: '+native,async t=>{
  const h=await fixture(t,({system,runtime})=>{if(!system.includes('<execution_context>'))return proposal(1,true);const p=runtime.session.plan;return {action:'report_step_result',outcome:'completed',summary:'Plan proposed and waiting for approval.',evidence:[],remaining_issues:[]};},{native});
  await h.start();await h.approve();const p=h.runtime.session.plan;assert.equal(p.executions[0].status,'failed');assert.equal(p.executions[0].attempts[0].wait_reason,undefined);assert.equal(h.events.some(e=>e.type==='planState'&&e.plan?.executions[0].status==='waiting_user'),false);assert.equal(h.effects.length,0);
 });
}

for(const mode of ['ask','plan','agent'])test('empty native output during investigation is recoverable in '+mode,async t=>{
 const {EmptyModelResponse}=require('../dist/core/native');let n=0;
 const h=await fixture(t,()=>{if(!n++)throw new EmptyModelResponse({kind:'final',stopReason:'stop',text:'',calls:[],usage:{input:12,output:1}});return mode==='plan'?proposal(1):{action:'finish',text:'The project contains an arithmetic helper.'};},{native:true});
 await h.start({mode,prompt:'What does the project contain?'});assert.equal(h.calls.length,2);assert.equal(h.effects.length,0);assert.equal(h.events.some(e=>e.type==='runFailure'),false);
});

test('approved-step context preserves user constraints while excluding stale execution reports',async t=>{
 const h=await fixture(t,successful);await h.start({prompt:'Fix the implementation, preserving the public API and user files.'});await h.approve();
 for(const call of h.calls.slice(1)){
  assert.match(call.messages[0].content,/preserving the public API/);assert.match(call.messages[0].content,/Execute ONLY/);
  assert.match(call.system,/APPROVED STEP/);assert.equal(call.system.includes('For multiple dependent deliverables, call propose_plan before implementing'),false);
 }
});

test('new questions after a completed plan do not reactivate retired orchestration',async t=>{
 let next=false;const h=await fixture(t,args=>next?{action:'finish',text:'The change is complete.'}:successful(args));await h.start();await h.approve();next=true;
 await h.start({mode:'ask',prompt:'Explain what changed',requestId:'follow-up'});const context=h.calls.at(-1).messages;
 assert.equal(context.some(m=>m.origin==='vortex_orchestrator'),false);assert.ok(context.some(m=>m.toolResult),'observed evidence remains available');assert.ok(h.runtime.session.messages.some(m=>m.origin==='vortex_orchestrator'),'audit keeps orchestration');
});

for(const native of [false,true]){
 test('host runs all approved checks and corrects known failures at most twice: '+native,async t=>{
  const h=await fixture(t,({system})=>system.includes('<execution_context>')?{action:'report_step_result',outcome:'completed',summary:'Ready'}:proposal(1),{native});
  let runs=0;h.runtime.host.execute=async a=>{h.effects.push(a);runs++;if(runs<3){const error=new Error('Assertion failed');error.commandEvidence={command:a.command,cwd:'.',exit_code:1,cancelled:false,execution_location:'host',fingerprint:null,output:'Expected 5; received -1'};throw error;}return JSON.stringify({command:a.command,cwd:'.',exit_code:0,cancelled:false,execution_location:'host',fingerprint:'hash',output:'Passed'});};
  await h.start();await h.approve();assert.equal(runs,3);assert.equal(h.runtime.session.plan.status,'completed');assert.equal(h.runtime.session.plan.executions[0].attempts[0].corrections,2);assert.equal(h.calls.length,4);
  assert.ok(h.calls[2].messages.some(m=>m.content.includes('Expected 5')));assert.equal(h.runtime.session.plan.authorization.revision,1);
 });
 test('persistent check failure pauses after three checks, never reaches another step: '+native,async t=>{
  const h=await fixture(t,successful,{native});let runs=0;h.runtime.host.execute=async a=>{runs++;return JSON.stringify({command:a.command,cwd:'.',exit_code:1,cancelled:false,execution_location:'host',fingerprint:'hash',output:'Fail'});};
  await h.start();await h.approve();assert.equal(runs,3);assert.equal(h.runtime.session.plan.status,'paused');assert.equal(h.runtime.session.plan.executions[0].status,'failed');assert.equal(h.runtime.session.plan.executions[1].status,'pending');
 });
 test('uncertain verification never triggers an automatic correction: '+native,async t=>{
  const {ExecutionError}=require('../dist/core/execution');const h=await fixture(t,successful,{native});let runs=0;h.runtime.host.execute=async()=>{runs++;throw new ExecutionError('uncertain_outcome','Partial effects');};await h.start();await h.approve();assert.equal(runs,1);assert.equal(h.runtime.session.pendingTool.name,'run_command');assert.equal(h.runtime.session.plan.status,'paused');assert.equal(h.runtime.session.plan.executions[0].attempts[0].corrections,undefined);
 });
}
test('old plan approval cannot become an authorization grant',async t=>{
 const h=await fixture(t,successful);await h.start();delete h.runtime.session.plan.contract_version;delete h.runtime.session.plan.authorization;
 await assert.rejects(h.approve(),/older plan/);assert.equal(h.effects.length,0);
});
test('delayed report is discarded when the active attempt changes while awaiting the provider',async t=>{
 let changed=false;const h=await fixture(t,args=>{const answer=successful(args);if(args.system.includes('<execution_context>')&&!changed){changed=true;args.runtime.session.plan.executions[0].attempts[0].number++;}return answer;});
 await h.start();await h.approve();assert.equal(h.effects.length,0);assert.equal(h.runtime.session.plan.status,'paused');assert.ok(h.events.some(e=>e.type==='runFailure'&&e.message.includes('obsolete execution')));
});
test('host verification honors the declared network grant without adding a conflicting default',async t=>{
 const h=await fixture(t,({system})=>{if(system.includes('<execution_context>'))return {action:'report_step_result',outcome:'completed',summary:'Ready'};const p=proposal(1);p.steps[0].commands=[{command:'node --version',cwd:'.',request_network:true}];return p;});
 await h.start();assert.equal(h.runtime.session.plan.authorization.steps[0].commands.length,1);await h.approve();assert.equal(h.effects.length,1);assert.equal(h.effects[0].request_network,true);assert.equal(h.runtime.session.plan.status,'completed');
});
test('missing or transplanted scope can never resume an approved plan',async t=>{
 const h=await fixture(t,successful);await h.start();const p=h.runtime.session.plan;const {PlanController}=require('../dist/plan/plan');new PlanController(p).approve(1,'autonomous');delete p.authorization;
 await assert.rejects(h.runtime.planAction({type:'resumePlan',requestId:'resume',sessionId:h.runtime.session.id,planId:p.plan_id,version:p.version}),/authorization/);assert.equal(h.effects.length,0);
});
