const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateAction,allowedActions}=require('../dist/actions');
const {systemPrompt}=require('../dist/prompt');
test('mode prompts have distinct objectives and expose only executable tools',()=>{
  const modes=['ask','plan','agent'];
  for(const mode of modes)for(const permission of ['supervised','autonomous']){const prompt=systemPrompt(mode,'auto',[],false,permission);
    assert.ok(prompt.length<25000,'Keep prompt bounded');
    for(const action of ['finish','list','read','search','diagnostics','plan','write','edit','command'])assert.equal(prompt.includes(`{"action":"${action}"`),allowedActions(mode).includes(action),mode+':'+action);
  }
  assert.match(systemPrompt('ask','en',[]),/ASK MODE/);
  assert.match(systemPrompt('plan','en',[]),/PLAN MODE/);
  assert.match(systemPrompt('agent','en',[],false,'supervised'),/SUPERVISED PERMISSIONS/);
  assert.match(systemPrompt('agent','en',[],false,'autonomous'),/AUTONOMOUS PERMISSIONS/);
});
test('invalid tools, arguments and paths are rejected before execution',()=>{
  for(const a of [null,[],{action:'unknown'},{action:'read_file',path:'**/*'},{action:'edit_file',path:'a',old_text:'',new_text:'x'},{action:'read_file',path:'a',start_line:0},{action:'read_file',path:'a',start_line:5,end_line:2},{action:'read_file',path:'../a'},{action:'read_file',path:42},{action:'run_command',command:''},{action:'write_file',path:'a',content:'x'.repeat(200001)}])assert.throws(()=>validateAction(a,'agent'));
  assert.deepEqual(validateAction({action:'write_file',path:'a',content:''},'agent'),{action:'write_file',path:'a',content:''});
  for(const mode of ['ask','plan'])for(const action of ['write','edit','command'])assert.throws(()=>validateAction({action},mode));
  assert.throws(()=>validateAction({action:'update_plan',items:[{id:'a',text:'x',status:'pending'}]},'ask'));
});

test('tool argument failures identify the exact field without exposing values',()=>{
 assert.throws(()=>validateAction({action:'read_file'},'ask'),/arguments.path is required/);
 assert.throws(()=>validateAction({action:'read_file',path:'a',start_line:'1'},'ask'),/arguments.start_line must be an integer/);
 assert.throws(()=>validateAction({action:'update_plan',items:[{id:'a',text:'Inspect',status:'complete'}]},'plan'),/arguments.items\[0\].status must be one of: pending, in_progress, completed/);
 assert.throws(()=>validateAction({action:'list_files',secret:'do-not-include-me'},'ask'),e=>e.message.includes('unknown field')&&!e.message.includes('do-not-include-me'));
});

test('new tool contracts validate filters, coordinates and checklist progress',()=>{
 for(const action of [{action:'list_files',patterns:[]},{action:'get_diagnostics',paths:['../outside']},{action:'query_symbols',path:'a',operation:'definition'},{action:'query_symbols',path:'a',line:1},{action:'update_plan',items:[{id:'a',text:'A',status:'in_progress'},{id:'b',text:'B',status:'in_progress'}]},{action:'read_tool_output',output_id:'bad'},{action:'read_file',path:'a',start_line:3,end_line:2}])assert.throws(()=>validateAction(action,'agent'));
 assert.deepEqual(validateAction({action:'list_files',patterns:['*.ts','README.md'],exclude_patterns:['**/*.test.ts']},'ask').patterns,['*.ts','README.md']);
 assert.equal(validateAction({action:'ask_user',question:'Which option?'},'ask').question,'Which option?');
 assert.throws(()=>validateAction({action:'editor',selection:false},'ask'));
});
