const {test}=require('node:test');const assert=require('node:assert/strict');
const {Interactions}=require('../dist/interaction');const {parseRequest}=require('../dist/protocol');
const input={kind:'approval',runId:'run',operation:'edit',path:'a.ts',preview:true,hunks:[{label:'1',diff:'-old\n+new'}]};
test('sidebar approvals wait for the exact live ID; preview and replay do not approve',async()=>{
 const events=[];let previews=0,settled=false;const broker=new Interactions(m=>events.push(m));
 const result=broker.request(input,new AbortController().signal,async()=>{previews++;});result.then(()=>settled=true);
 const id=events.at(-1).interaction.id;broker.snapshot();assert.equal(events.at(-1).interaction.id,id);
 await assert.rejects(broker.respond({id:'stale',decision:'approve'}),/no longer/);
 await broker.respond({id,decision:'preview'});assert.equal(previews,1);assert.equal(settled,false);
 await assert.rejects(broker.respond({id,decision:'answer',answer:'yes'}),/Invalid approval/);
 for(const hunks of [[],[5],[0,0]])await assert.rejects(broker.respond({id,decision:'approve',hunks}),/valid change/);
 await broker.respond({id,decision:'approve',hunks:[0]});assert.deepEqual((await result).hunks,[0]);assert.equal(events.at(-1).interaction,null);
 await assert.rejects(broker.respond({id,decision:'approve'}),/no longer/);
});
test('abort and disposal clear requests and never allow late approvals',async()=>{
 for(const stop of ['abort','dispose']){
  const events=[],controller=new AbortController(),broker=new Interactions(m=>events.push(m));const promise=broker.request(input,controller.signal),id=events.at(-1).interaction.id;
  const rejected=assert.rejects(promise,/cancelled/);stop==='abort'?controller.abort():broker.dispose();await rejected;
  assert.equal(events.at(-1).interaction,null);await assert.rejects(broker.respond({id,decision:'approve'}),/no longer/);
 }
});
test('questions accept suggested or free text only after submission and can be cancelled',async()=>{
 const events=[],broker=new Interactions(m=>events.push(m));const question={kind:'question',runId:'r',question:'Which?',options:['Fast','Full']};
 for(const answer of ['Full',' Custom response ']){
  const pending=broker.request(question,new AbortController().signal),id=events.at(-1).interaction.id;
  await assert.rejects(broker.respond({id,decision:'approve'}),/Enter an answer/);
  await assert.rejects(broker.respond({id,decision:'answer',answer:' '}),/Enter an answer/);
  await broker.respond({id,decision:'answer',answer});assert.equal((await pending).answer,answer.trim());
 }
 const cancelled=broker.request(question,new AbortController().signal);await broker.respond({id:events.at(-1).interaction.id,decision:'reject'});assert.equal((await cancelled).decision,'reject');
});
test('interaction bridge rejects malformed payloads before dispatch',()=>{
 for(const payload of [{decision:'unknown'},{decision:'answer'},{decision:'answer',answer:''},{decision:'answer',answer:'x'.repeat(4001)},{decision:'approve',answer:'yes'},{decision:'approve',hunks:[-1]},{decision:'approve',hunks:[0,0]},{decision:'preview',hunks:[0]}])assert.throws(()=>parseRequest({type:'respondInteraction',requestId:'r',id:'i',...payload}));
 assert.equal(parseRequest({type:'respondInteraction',requestId:'r',id:'i',decision:'answer',answer:'Free text'}).answer,'Free text');
});
