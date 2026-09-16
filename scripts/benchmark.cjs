const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');const Module=require('node:module');
const {mapLimited}=require('../dist/tools/queryCache');const {SessionStore}=require('../dist/session/sessions');
let discoveries=0;const mock={workspace:{textDocuments:[],fs:{stat:uri=>fs.stat(uri.fsPath)},findFiles:async pattern=>{discoveries++;return (await fs.readdir(pattern.root)).map(name=>({fsPath:path.join(pattern.root,name)}));}},RelativePattern:class{constructor(root){this.root=root;}},Uri:{file:fsPath=>({fsPath})}};
const load=Module._load;Module._load=function(name,...args){return name==='vscode'?mock:load.call(this,name,...args);};const {executeReadTool}=require('../dist/tools/readTools');Module._load=load;
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-benchmark-')),start=performance.now(),report={version:require('../package.json').version,node:process.version,platform:process.platform};
 try{
  const workspace=path.join(root,'workspace');await fs.mkdir(workspace);
  await mapLimited(Array.from({length:10000},(_,i)=>i),8,i=>fs.writeFile(path.join(workspace,`${String(i).padStart(5,'0')}.txt`),'fixture needle\n'));
  let cursor,count=0;const names=new Set(),listingStart=performance.now();do{const p=JSON.parse(await executeReadTool({action:'list_files',limit:500,cursor},workspace,new AbortController().signal));count+=p.files.length;p.files.forEach(f=>names.add(f));cursor=p.next_cursor;}while(cursor);
  assert.equal(count,10000);assert.equal(names.size,10000);assert.equal(discoveries,1);report.listing={files:count,pages:20,discoveries,milliseconds:performance.now()-listingStart};
  const store=new SessionStore(path.join(root,'sessions')),sessionStart=performance.now();for(let i=0;i<500;i++)await store.save(store.create(`Fixture ${i}`,'ask',{providerId:'fixture',modelId:'fixture'}));
  assert.equal((await store.list('',0,1000)).length,500);report.sessions={count:500,milliseconds:performance.now()-sessionStart};
  const session=store.create('Long conversation','ask',{providerId:'fixture',modelId:'fixture'}),checkpointStart=performance.now();for(let i=0;i<50;i++){session.messages.push({role:'user',content:'fixture '.repeat(500)},{role:'assistant',content:'evidence '.repeat(500)});await store.save(session);}assert.equal((await store.load(session.id)).messages.length,100);report.checkpoints={writes:50,messages:100,milliseconds:performance.now()-checkpointStart};
  report.totalMs=performance.now()-start;report.rssBytes=process.memoryUsage().rss;await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
