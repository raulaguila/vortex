const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
let prompts=0,mutations=0;
const originalLoad=Module._load;
Module._load=function(name,...args){return name==='vscode'?{
  window:{showWarningMessage:async()=>{throw new Error('Tool approvals must stay in the sidebar');}},
  workspace:{applyEdit:async()=>{mutations++;throw new Error('Must not reach mutation without approval');}}
}:originalLoad.call(this,name,...args);};
const {AgentController}=require('../dist/agent');
Module._load=originalLoad;
function deniedAgent(){let agent;agent=new AgentController({},message=>{if(message.type==='interaction'&&message.interaction){prompts++;queueMicrotask(()=>agent.respondInteraction({id:message.interaction.id,decision:'reject'}));}},{});return agent;}


test('real executor requires approval for supervised writes and edits; invalid edits fail before the sidebar request',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-approval-'));
  try{
    const file=path.join(root,'settings.json');await fs.writeFile(file,'original');
    const agent=deniedAgent();agent.sandbox={available:async image=>{assert.equal(image,'node:22-bookworm-slim');return false;}};const signal=new AbortController().signal;
    const actions=[{action:'write_file',path:'settings.json',content:'changed'},{action:'edit_file',path:'settings.json',old_text:'original',new_text:'changed'}];
    for(const action of actions){const before=prompts;await assert.rejects(agent.execute(action,'agent',root,signal,'supervised'),/Approval denied/);assert.equal(prompts,before+1);assert.equal(await fs.readFile(file,'utf8'),'original');}
    const before=prompts;
    await assert.rejects(agent.execute({action:'edit_file',path:'**/settings.json',old_text:'original',new_text:'changed'},'agent',root,signal,'supervised'));
    assert.equal(prompts,before);assert.equal(mutations,0);
    for(const mode of ['ask','plan'])for(const action of actions)await assert.rejects(agent.execute(action,mode,root,signal));
    for(const permission of ['supervised','autonomous']){const before=prompts;await assert.rejects(agent.execute({action:'run_command',command:'unused'},'agent',root,signal,permission),/Approval denied/);assert.equal(prompts,before+1);}
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('executor rejects forged permission values and aborts before any sidebar request',async()=>{
 const agent=deniedAgent();const before=prompts;
 await assert.rejects(agent.execute({action:'write_file',path:'file',content:'bad'},'agent','/tmp',new AbortController().signal,'unknown'),/Invalid execution policy/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(agent.execute({action:'run_command',command:'unused'},'agent','/tmp',controller.signal,'supervised'));
 assert.equal(prompts,before);assert.equal(mutations,0);
});

test('normalized network flags preserve sandbox network approval',async()=>{
 const {decodeAction}=require('../dist/actions');const agent=deniedAgent();let executions=0,network;
 agent.sandbox={available:async()=>true,execute:async(...args)=>{executions++;network=args[4];return {output:'ok',changes:[],artifacts:[]};}};
 const before=prompts;
 await assert.rejects(agent.execute(decodeAction({action:'run_command',command:'unused',request_network:'on'},'agent'),'agent',os.tmpdir(),new AbortController().signal,'autonomous'),/Approval denied/);assert.equal(prompts,before+1);assert.equal(executions,0);
 await agent.execute(decodeAction({action:'run_command',command:'unused',request_network:'off'},'agent'),'agent',os.tmpdir(),new AbortController().signal,'autonomous');assert.equal(executions,1);assert.equal(network,false);assert.equal(prompts,before+1);
});

test('approved plan command runs once without another prompt; scope changes still ask',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-grant-'));
 try{
  const agent=deniedAgent(),signal=new AbortController().signal;agent.checkpoint=async()=>{};
  agent.session={id:'session',root,plan:{contract_version:2,version:1,plan_id:'p',status:'running',active_step:'s',approved:{version:1},executions:[{id:'s',status:'running',attempts:[{number:1,status:'running',evidence:[],criteria:[]}]}],authorization:{session_id:'session',workspace:root,plan_version:1,revision:1,steps:[{step_id:'s',files:[],commands:[{command:'echo approved',cwd:'.',execution_location:'host',request_network:false}]}]}}};
  const before=prompts;const result=JSON.parse(await agent.execute({action:'run_command',command:'echo approved'},'agent',root,signal,'supervised'));assert.equal(result.exit_code,0);assert.equal(prompts,before);
  await assert.rejects(agent.execute({action:'run_command',command:'echo different'},'agent',root,signal,'supervised'),/Approval denied/);assert.equal(prompts,before+1);assert.equal(agent.session.plan.authorization.revision,1);
  const g=agent.session.plan.authorization.steps[0].commands[0];g.execution_location='sandbox';agent.sandbox={available:async()=>false};await assert.rejects(agent.execute({action:'run_command',command:'echo approved'},'agent',root,signal,'supervised'),/approved sandbox is unavailable/);assert.equal(prompts,before+1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
