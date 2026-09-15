const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateAction,toolDefinitions,registry}=require('../dist/actions');
const {systemPrompt}=require('../dist/prompt');
const {nativePrompt}=require('../dist/native');
const {applyEdits}=require('../dist/multiEdit');
const {ToolOutputs}=require('../dist/toolOutputs');
const {searchPage}=require('../dist/searchPage');
test('native and compatibility prompts preserve identical behavioral sections',()=>{
 for(const mode of ['ask','plan','agent'])for(const permission of ['supervised','autonomous']){
  const compatibility=systemPrompt(mode,'auto',[],false,permission),native=systemPrompt(mode,'auto',[],false,permission,'native');
  assert.equal(nativePrompt(compatibility),native);
  assert.match(native,/Never claim an edit or test succeeded/);assert.match(native,/edit\/write arguments/);
 }
 for(const mode of ['ask','plan','agent'])for(const tool of toolDefinitions(mode)){
  assert.equal(tool.description,registry[tool.name].description);
  assert.equal(tool.parameters.additionalProperties,false);
  assert.throws(()=>validateAction({action:tool.name,...registry[tool.name].example,unexpected:true},mode));
 }
});
test('atomic replacements preserve original and reject the entire invalid sequence',()=>{
 const original='one two';assert.equal(applyEdits(original,[{oldText:'one',newText:'three'},{oldText:'two',newText:'four'}]),'three four');
 assert.throws(()=>applyEdits(original,[{oldText:'one',newText:'three'},{oldText:'missing',newText:'four'}]));assert.equal(original,'one two');
 assert.throws(()=>applyEdits('aa',[{oldText:'a',newText:'b'}]));
 for(const mode of ['ask','plan'])assert.throws(()=>validateAction({action:'multiEdit',path:'a',edits:[{oldText:'a',newText:'b'}]},mode));
});
test('tool output pages preserve full text and identify expired IDs',()=>{
 const outputs=new ToolOutputs(),text='a'.repeat(20000),first=JSON.parse(outputs.preserve(text,1000));
 let combined=first.preview,offset=first.nextOffset;while(offset!==null){const page=JSON.parse(outputs.read(first.outputId,offset));combined+=page.text;offset=page.nextOffset;}assert.equal(combined,text);
 assert.throws(()=>outputs.read('made-up'));assert.throws(()=>new ToolOutputs().read(first.outputId));
});
test('search supports literal, case-sensitive and regex queries with explicit truncation',async()=>{
 const signal=new AbortController().signal,files=[{path:'a',text:'HELLO\nhello\na.b\nacb'}];
 assert.equal((await searchPage(files,'hello',false,false,signal)).matches.length,2);
 assert.equal((await searchPage(files,'hello',false,true,signal)).matches.length,1);
 assert.equal((await searchPage(files,'a.b',false,false,signal)).matches.length,1);
 assert.equal((await searchPage(files,'a.b',true,false,signal)).matches.length,2);
 await assert.rejects(searchPage(files,'[',true,false,signal),/Invalid regular/);
 const result=await searchPage([{path:'a',text:'x\n'.repeat(1002)}],'x',false,false,signal);assert.equal(result.matches.length,1000);assert.equal(result.truncated,true);
});
test('pathological regex and cancelled searches cannot freeze the extension host',async()=>{
 await assert.rejects(searchPage([{path:'a',text:'a'.repeat(20000)+'!'}],'^(a+)+$',true,false,new AbortController().signal),/time limit/);
 const controller=new AbortController();const pending=searchPage([{path:'a',text:'a'.repeat(20000)+'!'}],'^(a+)+$',true,false,controller.signal);controller.abort();await assert.rejects(pending,/cancelled/);
});
