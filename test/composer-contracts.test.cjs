const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {validateAction,toolDefinitions}=require('../dist/tools/actions');
const {nativePayload,decodeNative}=require('../dist/core/native');
const {turnActions,compatibilityTurn}=require('../dist/core/turnProtocol');
function webModule(file){const build=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../webview',file)],bundle:true,platform:'node',format:'cjs',write:false});const m=new (require('node:module'))(file);m._compile(build.outputFiles[0].text,file+'.cjs');return m.exports;}
const args={question:'Which tests?',options:['Focused','Full suite'],recommended_option:'Focused'};
test('a recommendation must explicitly match an offered answer',()=>{
 assert.deepEqual(validateAction({action:'ask_user',...args},'ask'),{action:'ask_user',...args});
 for(const value of [{...args,recommended_option:'Unknown'},{question:args.question,recommended_option:'Focused'}])assert.throws(()=>validateAction({action:'ask_user',...value},'ask'),/exactly match/);
 assert.equal(validateAction({action:'ask_user',question:'Any constraints?'},'ask').recommended_option,undefined);
});
for(const kind of ['openai','compatible','ollama','anthropic','gemini'])test(kind+' carries question recommendations through native and compatibility contracts',()=>{
 const call={id:'q',name:'ask_user',arguments:args};
 const wire=kind==='anthropic'?{content:[{type:'tool_use',id:call.id,name:call.name,input:args}]}:kind==='gemini'?{candidates:[{content:{parts:[{functionCall:{id:call.id,name:call.name,args}}]}}]}:kind==='ollama'?{message:{tool_calls:[{id:call.id,function:{name:call.name,arguments:args}}]}}:{choices:[{message:{tool_calls:[{id:call.id,function:{name:call.name,arguments:JSON.stringify(args)}}]}}]};
 assert.deepEqual(turnActions(decodeNative(kind,wire),'ask'),[{action:'ask_user',...args}]);
 assert.deepEqual(turnActions(compatibilityTurn(JSON.stringify({action:'ask_user',...args}),'ask'),'ask'),[{action:'ask_user',...args}]);
 assert.match(JSON.stringify(nativePayload(kind,'model','system',[],toolDefinitions('ask'),{tokens:16384,output:2048}).body),/recommended_option/);
});
test('webview validates recommendations and the explicit question history ID',()=>{
 const {isHostResponse}=webModule('messages.ts');
 assert.equal(isHostResponse({type:'interaction',interaction:{id:'q',runId:'r',kind:'question',...args}}),true);
 for(const recommendation of ['Unknown',false])assert.equal(isHostResponse({type:'interaction',interaction:{id:'q',runId:'r',kind:'question',...args,recommended_option:recommendation}}),false);
 assert.equal(isHostResponse({type:'interaction',interaction:{id:'q',runId:'r',kind:'question',question:'?',recommended_option:'no options'}}),false);
 assert.equal(isHostResponse({type:'event',event:{role:'assistant',text:'?',interactionId:'q'}}),true);
 assert.equal(isHostResponse({type:'event',event:{role:'assistant',text:'?',interactionId:42}}),false);
});
test('local state patches preserve normal and question drafts independently',()=>{
 const {createViewState}=webModule('state.ts');let saved={draft:'Original',mode:'ask'};
 const state=createViewState({getState:()=>saved,setState:v=>saved=structuredClone(v)});
 state.patch({questionDraft:{id:'q',answer:'Keep API',selectedOption:null}});state.patch({mode:'agent'});
 const restored=createViewState({getState:()=>saved,setState:v=>saved=v});
 assert.equal(restored.read().draft,'Original');assert.equal(restored.read().questionDraft.answer,'Keep API');
 restored.patch({questionDraft:null});assert.equal(saved.draft,'Original');assert.equal(saved.mode,'agent');
});
