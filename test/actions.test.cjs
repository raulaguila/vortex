const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateAction,allowedActions}=require('../dist/actions');
const {systemPrompt}=require('../dist/prompt');
test('mode prompts have distinct objectives and expose only executable tools',()=>{
  const modes=['ask','plan','agent'];
  for(const mode of modes)for(const permission of ['supervised','autonomous']){const prompt=systemPrompt(mode,'auto',[],false,permission);
    assert.ok(prompt.length<10000,'Keep prompt bounded');
    for(const action of ['finish','list','read','search','diagnostics','plan','write','edit','command'])assert.equal(prompt.includes(`{"action":"${action}"`),allowedActions(mode).includes(action),mode+':'+action);
  }
  assert.match(systemPrompt('ask','en',[]),/ASK MODE/);
  assert.match(systemPrompt('plan','en',[]),/PLAN MODE/);
  assert.match(systemPrompt('agent','en',[],false,'supervised'),/SUPERVISED PERMISSIONS/);
  assert.match(systemPrompt('agent','en',[],false,'autonomous'),/AUTONOMOUS PERMISSIONS/);
});
test('invalid tools, arguments and paths are rejected before execution',()=>{
  for(const a of [null,[],{action:'unknown'},{action:'read',path:'**/*'},{action:'edit',path:'a',oldText:'',newText:'x'},{action:'read',path:'a',startLine:0},{action:'read',path:'a',startLine:5,endLine:2},{action:'read',path:'../a'},{action:'read',path:42},{action:'command',command:''},{action:'write',path:'a',content:'x'.repeat(200001)}])assert.throws(()=>validateAction(a,'agent'));
  assert.deepEqual(validateAction({action:'write',path:'a',content:''},'agent'),{action:'write',path:'a',content:''});
  for(const mode of ['ask','plan'])for(const action of ['write','edit','command'])assert.throws(()=>validateAction({action},mode));
  assert.throws(()=>validateAction({action:'plan',items:[{id:'a',text:'x',status:'pending'}]},'ask'));
});
