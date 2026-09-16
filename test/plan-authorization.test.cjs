const {test}=require('node:test'),assert=require('node:assert/strict');
const {validGrant,currentScope,includesGrant,addGrant}=require('../dist/planAuthorization');
const {requestBinding,assertRequestBinding}=require('../dist/modelRequest');
const {decodeAction,toolDefinitions}=require('../dist/actions');
const {normalizeProposal}=require('../dist/planContract');
test('plan grants match exact operation, command, cwd, network and location',()=>{
 const scope={step_id:'s',files:[{path:'src/a.ts',operation:'edit'}],commands:[{command:'npm test',cwd:'.',request_network:false,execution_location:'sandbox'}]};
 assert.ok(includesGrant(scope,{path:'src/a.ts',operation:'edit'}));assert.equal(includesGrant(scope,{path:'src/a.ts',operation:'delete'}),false);
 for(const patch of [{command:'npm test; echo changed'},{cwd:'src'},{request_network:true},{execution_location:'host'}])assert.equal(includesGrant(scope,{...scope.commands[0],...patch}),false);
 addGrant(scope,{path:'src/b.ts',operation:'create'});addGrant(scope,{path:'src/b.ts',operation:'create'});assert.equal(scope.files.length,2);
 for(const path of ['../a','src/**','.git/config','.env','/tmp/a','a/../../b'])assert.equal(validGrant({path,operation:'edit'}),false);
});
test('grants are bound to session workspace version and active step',()=>{
 const scope={step_id:'s',files:[],commands:[]};const p={contract_version:2,status:'running',version:3,active_step:'s',approved:{version:3},authorization:{session_id:'one',workspace:'/work',plan_version:3,revision:1,steps:[scope]}};
 assert.equal(currentScope(p,'one','/work'),scope);assert.equal(currentScope(p,'two','/work'),undefined);assert.equal(currentScope(p,'one','/other'),undefined);p.version++;assert.equal(currentScope(p,'one','/work'),undefined);
});
test('request binding rejects stale response before any execution',()=>{
 const p={plan_id:'p',version:1,execution_id:'run',active_step:'s',executions:[{id:'s',attempts:[{number:1}]}]},signal=new AbortController();const b=requestBinding('session','request',p);
 assertRequestBinding(b,'session','request',signal.signal,p);
 for(const changed of [{...p,version:2},{...p,execution_id:'other'},{...p,active_step:'next'},{...p,executions:[{id:'s',attempts:[{number:2}]}]}])assert.throws(()=>assertRequestBinding(b,'session','request',signal.signal,changed),/obsolete/);
 assert.throws(()=>assertRequestBinding(b,'other','request',signal.signal,p),/obsolete/);signal.abort();assert.throws(()=>assertRequestBinding(b,'session','request',signal.signal,p));
});
test('proposal normalization generates IDs without inventing semantic fields',()=>{
 const input={action:'propose_plan',objective:'Fix',steps:[{title:'First',objective:'Fix function',files:[{path:'sum.js',operation:'edit'}],criteria:[{description:'Tests pass',verification:'command',command:'npm test'}]},{title:'Second',objective:'Document',depends_on:[1],criteria:[{description:'Readable examples',verification:'human'}]}]};
 const p=normalizeProposal(decodeAction(input,'plan'));assert.equal(p.steps[0].criteria[0].cwd,'.');assert.equal(p.steps[0].id,'step-1');assert.deepEqual(p.steps[1].depends_on,['step-1']);assert.deepEqual(p.steps[1].files,[]);
 const invalid=structuredClone(input);delete invalid.steps[0].criteria[0].description;assert.throws(()=>decodeAction(invalid,'plan'),/description/);
 assert.throws(()=>decodeAction({...input,steps:[{...input.steps[0],depends_on:[1]}]},'plan'),/earlier/);
 for(const k of ['execution_id','step_id','attempt','plan_version'])assert.throws(()=>decodeAction({action:'report_step_result',outcome:'completed',summary:'Ready',[k]:1},'agent'),/unknown field/);
 assert.equal(toolDefinitions('plan').some(t=>t.name==='report_step_result'),false);
});
