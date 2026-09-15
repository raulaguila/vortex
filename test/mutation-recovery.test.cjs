const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const Module=require('node:module');
let buffer='original',saveFails=false,applyFails=false,applied=0;let file;
const doc={isDirty:false,getText:()=>buffer,positionAt:n=>n,save:async()=>{if(saveFails)return false;await fs.writeFile(file,buffer);return true;}};
const mock={Uri:{file:fsPath=>({fsPath})},Range:class{},Position:class{},WorkspaceEdit:class{replace(_uri,_range,text){this.text=text;}},workspace:{textDocuments:[],fs:{stat:uri=>fs.stat(uri.fsPath)},openTextDocument:async()=>doc,registerTextDocumentContentProvider:()=>({dispose(){}}),applyEdit:async edit=>{buffer=edit.text;applied++;if(applyFails)throw new Error('apply failed after changing buffer');return true;}},window:{showWarningMessage:async()=> 'Permitir'}};
const load=Module._load;Module._load=function(name,...args){return name==='vscode'?mock:load.call(this,name,...args);};const {AgentController}=require('../dist/agent');const {ReviewService}=require('../dist/review');Module._load=load;
const {ChangeStore}=require('../dist/changes');
test('executor preserves the proposal and pauses on apply, save or review-record failure after editing',async()=>{
 for(const stage of ['apply','save','record']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-mutation-'));const id='11111111-1111-1111-1111-111111111111';
  try{file=path.join(root,'a.txt');buffer='original';applied=0;saveFails=stage==='save';applyFails=stage==='apply';await fs.writeFile(file,buffer);
   const store=new ChangeStore(path.join(root,'changes'));if(stage==='record')store.mark=async()=>{throw new Error('disk full');};const reviews=new ReviewService(store);
   const agent=new AgentController({},()=>{},{},reviews);agent.session={id};
   await assert.rejects(agent.execute({action:'write_file',path:'a.txt',content:'changed'},'agent',root,new AbortController().signal,'autonomous'),e=>e.code==='uncertain_outcome');
   assert.equal(applied,1);assert.equal(buffer,'changed');assert.equal((await store.list(id))[0].before,'original');assert.notEqual((await store.operations(id))[0].phase,'recorded');reviews.dispose();
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
});

test('sandbox preflight validates all proposals before importing any file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-import-'));try{
  await fs.writeFile(path.join(root,'a.txt'),'original');await fs.writeFile(path.join(root,'b.txt'),'user change');applied=0;
  const store=new ChangeStore(path.join(root,'changes')),reviews=new ReviewService(store),agent=new AgentController({},()=>{},{},reviews);agent.session={id:'11111111-1111-1111-1111-111111111111'};
  agent.sandbox={available:async()=>true,execute:async()=>({output:'ok',artifacts:[],changes:[{path:'a.txt',before:'original',after:'new'},{path:'b.txt',before:'original',after:'new'}]})};
  await assert.rejects(agent.execute({action:'run_command',command:'fixture'},'agent',root,new AbortController().signal,'autonomous'),e=>e.code==='uncertain_outcome');assert.equal(applied,0);assert.equal((await store.list(agent.session.id)).length,2);assert.equal(await fs.readFile(path.join(root,'b.txt'),'utf8'),'user change');reviews.dispose();
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
