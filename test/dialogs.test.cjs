const test=require('node:test');const assert=require('node:assert/strict');
const {Dialogs}=require('../dist/dialogs');const {parseRequest}=require('../dist/protocol');
const harness=()=>{const messages=[];const ui=new Dialogs(m=>messages.push(m));return {ui,messages,id:()=>messages.at(-1).dialog.id};};
test('dialog choices validate IDs, cancel safely and reject stale or cross-surface replies',async()=>{
 const a=harness(),b=harness();const waiting=a.ui.pick('Files',[{label:'a',value:{path:'a'}},{label:'b',value:{path:'b'}}]);const id=a.id();
 assert.throws(()=>b.ui.respond({id,value:'0'}),/no longer active/);
 assert.throws(()=>a.ui.respond({id,value:'../../file'}),/Invalid selection/);
 a.ui.snapshot();assert.equal(a.messages.at(-1).dialog.id,id);
 a.ui.respond({id,value:'1'});assert.deepEqual(await waiting,{path:'b'});
 assert.throws(()=>a.ui.respond({id,value:'0'}),/no longer active/);
 const next=a.ui.confirm('Delete?','Preserve files');const nextId=a.id();assert.notEqual(id,nextId);a.ui.respond({id:nextId,value:null});assert.equal(await next,false);
});
test('input validation keeps dialog open; disposal and abort never approve',async()=>{
 const h=harness();const waiting=h.ui.input('Image','value','help',v=>v==='ok'?undefined:'Invalid');const id=h.id();
 assert.throws(()=>h.ui.respond({id,value:'bad'}),/Invalid/);assert.equal(h.id(),id);
 h.ui.respond({id,value:'ok'});assert.equal(await waiting,'ok');
 const abort=new AbortController(),confirmation=h.ui.confirm('Undo?','','Undo',abort.signal);abort.abort();assert.equal(await confirmation,false);
 const disposed=h.ui.confirm('Delete?','');h.ui.dispose();assert.equal(await disposed,false);assert.equal(await h.ui.confirm('Again?',''),false);
});
test('progress cancels work and closes on success or failure',async()=>{
 const h=harness();let aborted=false;
 const work=h.ui.progress('Pull',signal=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true})));
 assert.throws(()=>h.ui.respond({id:h.id(),value:'accept'}),/still running/);h.ui.respond({id:h.id(),value:null});assert.equal(await work,false);assert.equal(aborted,true);
 assert.equal(await h.ui.progress('Done',async()=>{}),true);assert.equal(h.messages.at(-1).dialog,null);
 await assert.rejects(h.ui.progress('Failed',async()=>{throw new Error('offline');}),/offline/);assert.equal(h.messages.at(-1).dialog,null);
});
test('dialog replies are validated at the extension boundary',()=>{
 const reply={type:'respondDialog',requestId:'r',id:'d',value:null};assert.deepEqual(parseRequest(reply),reply);
 for(const value of [false,123,{},'x'.repeat(4097)])assert.throws(()=>parseRequest({...reply,value}));
});
test('Vortex flows do not invoke native dialog or notification APIs',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const name of fs.readdirSync(path.join(__dirname,'../src')).filter(n=>n.endsWith('.ts'))){const source=fs.readFileSync(path.join(__dirname,'../src',name),'utf8');assert.doesNotMatch(source,/vscode\.window\.(?:showQuickPick|showInputBox|showWarningMessage|showInformationMessage|showErrorMessage|showSaveDialog|showOpenDialog|showWorkspaceFolderPick|withProgress)\s*\(/,name);}
});
