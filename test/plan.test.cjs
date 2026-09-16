const {test}=require('node:test');const assert=require('node:assert/strict');const {PlanController,validateProposal,validatePlanState}=require('../dist/plan/plan');const {turnActions}=require('../dist/core/turnProtocol');const {toolDefinitions}=require('../dist/tools/actions');
const proposal=(n=1,verification='command')=>({objective:'Fix and verify',steps:Array.from({length:n},(_,i)=>({id:'s'+i,title:'Step '+i,objective:'Implement '+i,depends_on:i?['s'+(i-1)]:[],criteria:[{id:'c',description:'Checks pass',verification,...(verification==='command'?{command:'npm test',cwd:'.'}:{})}]}))});
const active=(p=proposal())=>{const c=PlanController.propose(p,'Fix this project');c.approve(1,'supervised');c.begin();return c;};
const evidence=(id='e',overrides={})=>({id,tool:'run_command',status:'success',timestamp:Date.now(),command:{command:'npm test',cwd:'.',exit_code:0,cancelled:false,execution_location:'host',output:'passed',fingerprint:'hash',...overrides}});
const report=c=>({execution_id:c.state.execution_id,plan_version:c.state.version,step_id:c.state.active_step,attempt:c.attempt.number,outcome:'completed',summary:'Tested',evidence:c.definition.criteria.map(criterion=>({criterion_id:criterion.id,tool_call_ids:c.attempt.evidence.map(e=>e.id)})),remaining_issues:[]});
test('plan contracts reject duplicate IDs, missing/forward/cyclic dependencies and invalid criteria',()=>{
 validateProposal(proposal(3));for(const change of [p=>p.steps[1].id='s0',p=>p.steps[0].depends_on=['s1'],p=>p.steps[1].depends_on=['missing'],p=>p.steps[0].criteria=[],p=>p.steps[0].criteria[0].cwd='../outside',p=>p.steps[0].criteria.push(p.steps[0].criteria[0])]){const p=proposal(2);change(p);assert.throws(()=>validateProposal(p));}
});
test('only current approval and current attempt can advance; completion is sequential',()=>{
 const c=PlanController.propose(proposal(3),'Fix');assert.throws(()=>c.begin(),/Approve/);assert.throws(()=>c.approve(2,'supervised'),/changed/);c.approve(1,'supervised');assert.throws(()=>c.approve(1,'supervised'),/already/);
 for(let i=0;i<3;i++){c.begin();assert.equal(c.state.active_step,'s'+i);c.record(evidence());const r=report(c);assert.throws(()=>c.checkReport({...r,step_id:'other'}));assert.throws(()=>c.checkReport({...r,attempt:9}));c.validate(r,'hash');assert.equal(c.active.status,'completed');assert.throws(()=>c.checkReport(r));}assert.equal(c.state.status,'completed');validatePlanState(c.state);
});
test('evidence is attempt-specific, cannot be invented, and must match approved command',()=>{
 const c=active();assert.throws(()=>c.checkReport({...report(c),evidence:[{criterion_id:'c',tool_call_ids:['made-up']}]}));c.record(evidence('e',{command:'echo OK'}));c.validate(report(c),'hash');assert.equal(c.active.status,'failed');c.begin();assert.equal(c.attempt.number,2);assert.equal(c.attempt.evidence.length,0);assert.throws(()=>c.checkReport({...report(c),evidence:[{criterion_id:'c',tool_call_ids:['e']}]}));
});
test('nonzero, cancelled, stale and later contradictory command results cannot pass',()=>{
 for(const overrides of [{exit_code:1},{cancelled:true},{fingerprint:'old'}]){const c=active();c.record(evidence('e',overrides));c.validate(report(c),'hash');assert.equal(c.active.status,'failed');assert.throws(()=>c.review('confirm','', 'hash'));}
 const c=active();c.record(evidence('pass'));c.record(evidence('fail',{exit_code:1}));c.validate({...report(c),evidence:[{criterion_id:'c',tool_call_ids:['pass']}]},'hash');assert.equal(c.active.status,'failed');
});
test('unknown workspace/sandbox correspondence requires human review; decisions are recorded',()=>{
 const c=active();c.record(evidence('e',{execution_location:'sandbox',fingerprint:null}));c.validate(report(c),'hash');assert.equal(c.active.status,'waiting_user');assert.throws(()=>c.begin(),/Review/);c.review('confirm','Reviewed imported diff','hash');assert.equal(c.state.status,'completed');assert.equal(c.attempt.decision.comment,'Reviewed imported diff');
});
test('review correction starts a new attempt; a known failure cannot be accepted',()=>{
 const c=active(proposal(1,'human'));c.record(evidence());c.validate(report(c),'hash');c.review('correct','Adjust the layout','hash');assert.equal(c.active.status,'blocked');c.begin();assert.equal(c.attempt.number,2);assert.equal(c.envelope('supervised',{}).correction,'Adjust the layout');c.pause('interrupted');assert.equal(c.active.status,'interrupted');
});
test('revisions preserve only unchanged completed steps with unchanged completed dependencies',()=>{
 const c=active(proposal(2));c.record(evidence());c.validate(report(c),'hash');const next=PlanController.propose(proposal(2),'Fix',c.state);assert.equal(next.state.version,2);assert.equal(next.state.executions[0].status,'completed');assert.equal(next.state.approved,undefined);assert.throws(()=>next.begin());const changed=proposal(2);changed.steps[0].objective='New scope';const revised=PlanController.propose(changed,'Fix',c.state);assert.equal(revised.state.executions[0].status,'pending');
});
test('plan transitions must be isolated before any tool in a batch can run',()=>{
 assert.throws(()=>turnActions({kind:'tool_use',text:'',calls:[{id:'a',name:'write_file',arguments:{path:'a',content:'x'}},{id:'b',name:'propose_plan',arguments:proposal()}]},'agent'),/only tool call/);
 assert.equal(toolDefinitions('agent').some(t=>t.name==='report_step_result'),false);assert.equal(toolDefinitions('agent',false,true).some(t=>t.name==='report_step_result'),true);for(const mode of ['ask','plan'])assert.equal(toolDefinitions(mode,false,true).some(t=>t.name==='report_step_result'),false);
});
module.exports={proposal,evidence,report};
test('human review cannot accept explicitly failed evidence, including unknown snapshots',()=>{
 const c=active(proposal(1,'human'));c.record(evidence('failed',{exit_code:1,fingerprint:null}));c.validate(report(c),null);assert.equal(c.active.status,'failed');assert.throws(()=>c.review('confirm','Ignore error',null));
 const x=active();x.record(evidence('pass',{fingerprint:null}));x.record(evidence('fail',{exit_code:1,fingerprint:null}));x.validate({...report(x),evidence:[{criterion_id:'c',tool_call_ids:['pass']}]},null);assert.equal(x.active.status,'failed');
});
test('workspace changes during pending human review invalidate earlier automatic verification',()=>{
 const p=proposal();p.steps[0].criteria.push({id:'visual',description:'Review appearance',verification:'human'});const c=active(p);c.record(evidence());c.validate(report(c),'hash');assert.equal(c.active.status,'waiting_user');assert.throws(()=>c.review('confirm','Looks good','changed'),/Workspace changed/);assert.equal(c.active.status,'waiting_user');
});
test('workspace fingerprint changes with source edits and declines unsupported coverage',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{planFingerprint}=require('../dist/plan/planFingerprint');const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-plan-hash-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'a.txt'),'before');const a=await planFingerprint(root);assert.ok(a);await fs.writeFile(path.join(root,'a.txt'),'after');assert.notEqual(await planFingerprint(root),a);await fs.writeFile(path.join(root,'large.bin'),Buffer.alloc(2*1024*1024+1));assert.equal(await planFingerprint(root),null);
});

test('native report schema contains no host identity fields',()=>{
 const schema=toolDefinitions('agent',false,true).find(t=>t.name==='report_step_result').inputSchema;
 for(const name of ['execution_id','plan_version','step_id','attempt'])assert.equal(schema.properties[name],undefined);
 assert.deepEqual(schema.required,['outcome','summary']);
});
test('manual result review requires current evidence and cannot be requested for a mere plan declaration',()=>{
 const c=active(proposal(1,'human'));assert.throws(()=>c.checkReport({...report(c),summary:'Plan proposed and waiting for approval.'}),/observed tool evidence/);assert.equal(c.active.status,'running');
 c.record({id:'read',tool:'read_file',path:'sum.js',status:'success',timestamp:Date.now()});c.validate(report(c),'hash');assert.equal(c.active.status,'waiting_user');assert.equal(c.attempt.wait_reason,'review');
});
