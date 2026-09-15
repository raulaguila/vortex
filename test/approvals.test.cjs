const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
let prompts=0,mutations=0;
const originalLoad=Module._load;
Module._load=function(name,...args){return name==='vscode'?{
  window:{showWarningMessage:async()=>{prompts++;return undefined;}},
  workspace:{applyEdit:async()=>{mutations++;throw new Error('Must not reach mutation without approval');}}
}:originalLoad.call(this,name,...args);};
const {AgentController}=require('../dist/agent');
Module._load=originalLoad;

test('real executor requires approval for supervised writes and edits; invalid edits fail before the dialog',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-approval-'));
  try{
    const file=path.join(root,'settings.json');await fs.writeFile(file,'original');
    const agent=new AgentController({},()=>{},{});agent.sandbox={available:async image=>{assert.equal(image,'node:22-bookworm-slim');return false;}};const signal=new AbortController().signal;
    const actions=[{action:'write',path:'settings.json',content:'changed'},{action:'edit',path:'settings.json',oldText:'original',newText:'changed'}];
    for(const action of actions){const before=prompts;await assert.rejects(agent.execute(action,'agent',root,signal,'supervised'),/Approval denied/);assert.equal(prompts,before+1);assert.equal(await fs.readFile(file,'utf8'),'original');}
    const before=prompts;
    await assert.rejects(agent.execute({action:'edit',path:'**/settings.json',oldText:'original',newText:'changed'},'agent',root,signal,'supervised'));
    assert.equal(prompts,before);assert.equal(mutations,0);
    for(const mode of ['ask','plan'])for(const action of actions)await assert.rejects(agent.execute(action,mode,root,signal));
    for(const permission of ['supervised','autonomous']){const before=prompts;await assert.rejects(agent.execute({action:'command',command:'unused'},'agent',root,signal,permission),/Approval denied/);assert.equal(prompts,before+1);}
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('executor rejects forged permission values and aborts before any dialog',async()=>{
 const agent=new AgentController({},()=>{},{});const before=prompts;
 await assert.rejects(agent.execute({action:'write',path:'file',content:'bad'},'agent','/tmp',new AbortController().signal,'unknown'),/Invalid execution policy/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(agent.execute({action:'command',command:'unused'},'agent','/tmp',controller.signal,'supervised'));
 assert.equal(prompts,before);assert.equal(mutations,0);
});

test('normalized network flags preserve sandbox network approval',async()=>{
 const {decodeAction}=require('../dist/actions');const agent=new AgentController({},()=>{},{});let executions=0,network;
 agent.sandbox={available:async()=>true,execute:async(...args)=>{executions++;network=args[4];return {output:'ok',changes:[],artifacts:[]};}};
 const before=prompts;
 await assert.rejects(agent.execute(decodeAction({action:'command',command:'unused',network:'on'},'agent'),'agent',os.tmpdir(),new AbortController().signal,'autonomous'),/Approval denied/);assert.equal(prompts,before+1);assert.equal(executions,0);
 await agent.execute(decodeAction({action:'command',command:'unused',network:'off'},'agent'),'agent',os.tmpdir(),new AbortController().signal,'autonomous');assert.equal(executions,1);assert.equal(network,false);assert.equal(prompts,before+1);
});
