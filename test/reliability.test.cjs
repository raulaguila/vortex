const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {decodeReply}=require('../dist/reply');const {fitContext}=require('../dist/context');
const {snapshotFile,verifySnapshot}=require('../dist/files');const {Client}=require('../dist/providers');
const {safePath}=require('../dist/policy');
test('symlink aliases cannot bypass protected files or change a pending edit target',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-links-'));
 try{
  await fs.writeFile(path.join(root,'.env'),'secret');await fs.symlink('.env',path.join(root,'alias'));
  await assert.rejects(safePath(root,'alias'),/protegido/);
  await fs.writeFile(path.join(root,'a'),'same');await fs.writeFile(path.join(root,'b'),'same');
  await fs.symlink('a',path.join(root,'target'));const before=await snapshotFile(root,'target');
  await fs.unlink(path.join(root,'target'));await fs.symlink('b',path.join(root,'target'));
  await assert.rejects(verifySnapshot(root,'target',before),/file changed/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('plain Markdown is a final answer; only validated complete JSON executes tools',()=>{
 assert.equal(decodeReply('## Hello\nA useful answer.','ask').action,'finish');
 assert.equal(decodeReply('```js\nconsole.log(1)\n```','agent').action,'finish');
 assert.equal(decodeReply('```json\n{"action":"read","path":"README.md"}\n```','ask').action,'read');
 assert.equal(decodeReply('<think>private</think>{"action":"finish","text":"hello"}','ask').text,'hello');
 for(const value of ['null','{"action":"write"','[{"action":"read"}]','<think>unfinished'])assert.throws(()=>decodeReply(value,'agent'));
 assert.throws(()=>decodeReply('{"action":"write","path":"a","content":"bad"}','ask'));
 assert.throws(()=>decodeReply('{"action":"read","path":"a"}','agent',true));
});
test('context eviction preserves the latest user request rather than the first task',()=>{
 const old=[{role:'user',content:'old task '+ 'x'.repeat(1000)},{role:'assistant',content:'old answer '+ 'x'.repeat(1000)}];
 const current=[{role:'user',content:'CURRENT REQUEST'},...Array.from({length:10},(_,i)=>({role:i%2?'user':'assistant',content:'tool data '+i+' '+ 'x'.repeat(200)}))];
 const out=fitContext('system',[...old,...current],2048,512,old.length);
 assert.equal(out.messages[0].content,'CURRENT REQUEST');assert.equal(out.messages.at(-1).content,current.at(-1).content);
 assert.ok(!out.messages.some(m=>m.content.startsWith('old task')));assert.equal(current.length,11);
});
test('edit snapshots reject changed, removed and newly created files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-files-'));
 try{
  const file=path.join(root,'a');await fs.writeFile(file,'original');const before=await snapshotFile(root,'a');
  await verifySnapshot(root,'a',before);await fs.writeFile(file,'user changed');await assert.rejects(verifySnapshot(root,'a',before),/file changed/);
  await fs.unlink(file);await assert.rejects(verifySnapshot(root,'a',before),/file changed/);
  const missing=await snapshotFile(root,'a');await fs.writeFile(file,'new user file');await assert.rejects(verifySnapshot(root,'a',missing),/file changed/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('provider output truncation is reported before a partial action reaches execution',async()=>{
 for(const kind of ['openai','compatible','ollama','anthropic','gemini']){
  const result=kind==='ollama'?{done_reason:'length'}:kind==='anthropic'?{stop_reason:'max_tokens'}:kind==='gemini'?{candidates:[{finishReason:'MAX_TOKENS'}]}:{choices:[{finish_reason:'length'}]};
  const client=new Client({id:'p',kind,name:'test',baseUrl:'https://example.com'},'',async()=>new Response(JSON.stringify(result)));
  await assert.rejects(client.chat('model','system',[],new AbortController().signal),/output limit/);
 }
});
