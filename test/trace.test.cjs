const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {RunTrace}=require('../dist/trace');
const {Client}=require('../dist/providers');
test('last flow uses reference envelope, records rounds and redacts credential',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-trace-'));try{
 const file=path.join(dir,'last-flow.json');const trace=new RunTrace(file,{sessionId:'s',model:{modelId:'m'},prompt:'hello'});
 const client=new Client({id:'p',name:'P',kind:'compatible',baseUrl:'http://localhost'},'private-key',async()=>new Response(JSON.stringify({choices:[{message:{content:'private-key'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}}));
 client.attachTrace(trace);await client.turn('m','system',[{role:'user',content:'hello'}],new AbortController().signal,{tokens:5000,output:500},[]);
 await trace.finish('complete',[{role:'assistant',content:'private-key'}]);
 const raw=await fs.readFile(file,'utf8'),j=JSON.parse(raw);assert.ok(!raw.includes('private-key'));assert.deepEqual(Object.keys(j),['conversation_id','model','temperature','max_tokens','system_prompt','user_question','turns','final_answer','sources']);assert.equal(j.turns[0].request.Messages[0].content,'system');assert.equal(j.turns[0].response.stop_reason,'stop');assert.equal(j.final_answer,'[REDACTED]');assert.equal(j.temperature,null);
 const next=new RunTrace(file,{sessionId:'next',model:{modelId:'m'},prompt:'next'});await next.save();await next.flush();assert.equal(JSON.parse(await fs.readFile(file,'utf8')).turns.length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('trace preserves tool IDs, result sources and failed requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-trace-'));try{
 const trace=new RunTrace(path.join(dir,'last-flow.json'),{sessionId:'s',model:{modelId:'m'}});
 const i=await trace.request('/chat/completions',{model:'m',messages:[{role:'assistant',content:'',tool_calls:[{id:'a',function:{name:'read',arguments:'{"path":"x"}'}}]},{role:'tool',tool_call_id:'a',content:'result'}],tools:[{type:'function',function:{name:'read',description:'Read',parameters:{type:'object'}}}]});
 await trace.response(i,undefined,'timeout');await trace.finish('error',[{role:'assistant',content:'',toolCalls:[{id:'a',name:'read',arguments:{path:'x'}}]},{role:'user',content:'result',toolResult:{id:'a',name:'read',status:'success',output:'result'}}]);
 const j=JSON.parse(await fs.readFile(trace.path,'utf8'));assert.equal(j.turns[0].request.Messages[1].tool_call_id,'a');assert.equal(j.turns[0].response.error,'timeout');assert.deepEqual(j.sources,[{tool:'read',input:'{"path":"x"}',result:'result'}]);assert.equal(j.final_answer,'');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
