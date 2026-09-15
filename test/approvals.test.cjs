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
    const agent=new AgentController({},()=>{},{});const signal=new AbortController().signal;
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
