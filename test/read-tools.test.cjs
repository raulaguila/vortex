const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const Module=require('node:module');
const mock={workspace:{textDocuments:[],fs:{stat:uri=>fs.stat(uri.fsPath)},findFiles:async()=>[]},Uri:{file:fsPath=>({fsPath})},RelativePattern:class{constructor(root,pattern){this.root=root;this.pattern=pattern;}},languages:{getDiagnostics:()=>[]}};
const load=Module._load;Module._load=function(name,...args){return name==='vscode'?mock:load.call(this,name,...args);};const {executeReadTool}=require('../dist/readTools');Module._load=load;
test('reads use dirty buffers, record versions and expose line pagination',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-read-'));try{
  const file=path.join(root,'a.txt');await fs.writeFile(file,'disk');mock.workspace.textDocuments=[{uri:{fsPath:file},isDirty:true,getText:()=>Array.from({length:300},(_,i)=>'buffer'+i).join('\n')}];
  const versions=new Map(),result=JSON.parse(await executeReadTool({action:'read',path:'a.txt'},root,new AbortController().signal,versions));
  assert.equal(result.source,'buffer');assert.equal(result.dirty,true);assert.match(result.content,/1: buffer0/);assert.equal(result.nextLine,201);assert.equal(versions.size,1);
  mock.workspace.textDocuments=[];assert.match(await executeReadTool({action:'read',path:'a.txt'},root,new AbortController().signal),/disk/);
 }finally{mock.workspace.textDocuments=[];await fs.rm(root,{recursive:true,force:true});}
});
test('file listing and search report the actual page coverage',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-search-'));try{
  await fs.writeFile(path.join(root,'a.txt'),'needle');mock.workspace.findFiles=async()=>Array.from({length:150},(_,i)=>({fsPath:path.join(root,i===0?'a.txt':`b${i}.txt`)}));
  const signal=new AbortController().signal,list=JSON.parse(await executeReadTool({action:'list',limit:50},root,signal));assert.equal(list.files.length,50);assert.equal(list.nextOffset,50);
  const search=JSON.parse(await executeReadTool({action:'search',query:'needle'},root,signal));assert.equal(search.matches.length,1);assert.equal(search.scannedFiles,1);assert.equal(search.skippedFiles,99);assert.equal(search.nextOffset,100);
  const empty=JSON.parse(await executeReadTool({action:'skill'},root,signal));assert.deepEqual(empty.skills,[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
