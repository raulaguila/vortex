import {randomUUID} from 'node:crypto';
import {FileGrant,PlanAuthorization,validateAuthorization,validGrant} from './planAuthorization';

export type Criterion={id:string;description:string;verification:'command'|'human';command?:string;cwd?:string};
export type PlanStep={files?:FileGrant[];commands?:{command:string;cwd:string;request_network:boolean}[];id:string;title:string;objective:string;depends_on:string[];criteria:Criterion[]};
export type PlanProposal={objective:string;steps:PlanStep[]};
export type StepStatus='pending'|'running'|'validating'|'completed'|'waiting_user'|'blocked'|'failed'|'interrupted';
export type CommandEvidence={command:string;cwd:string;execution_location:'host'|'sandbox';exit_code:number|null;cancelled:boolean;output:string;fingerprint:string|null};
export type StepEvidence={id:string;tool:string;status:string;path?:string;command?:CommandEvidence;outputRef?:string;timestamp:number};
export type CriterionResult={id:string;status:'verified'|'review'|'failed';reason:string;evidence_ids:string[]};
export type StepAttempt={workspace_fingerprint?:string|null;corrections?:number;correcting?:boolean;waiting_from?:'running'|'validating';number:number;started_at:number;ended_at?:number;status:StepStatus;summary?:string;wait_reason?:'question'|'approval'|'review';evidence:StepEvidence[];criteria:CriterionResult[];decision?:{action:'confirm'|'correct';comment:string;at:number}};
export type StepExecution={id:string;status:StepStatus;attempts:StepAttempt[]};
export type PlanState={contract_version?:2;authorization?:PlanAuthorization;plan_id:string;version:number;objective:string;steps:PlanStep[];original_request:string;execution_id?:string;approved?:{version:number;at:number;permission:'supervised'|'autonomous'};active_step?:string;status:'proposed'|'running'|'paused'|'completed';executions:StepExecution[];updated_at:number};
export type StepReport={execution_id:string;plan_version:number;step_id:string;attempt:number;outcome:'completed'|'blocked'|'failed';summary:string;evidence:{criterion_id:string;tool_call_ids:string[]}[];remaining_issues:string[]};
const text=(v:unknown,max=4000):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max;
const relative=(v:string)=>v.length<=2048&&!v.includes('\0')&&!/^(?:[/\\]|[a-z]:)/i.test(v)&&!v.split(/[/\\]/).includes('..');
export function validateProposal(p:PlanProposal){
 if(!p||!text(p.objective)||!Array.isArray(p.steps)||!p.steps.length||p.steps.length>50)throw new Error('A plan needs an objective and 1–50 steps.');
 const seen=new Set<string>();
 for(const s of p.steps){
  if(!s||!text(s.id,80)||seen.has(s.id)||!text(s.title,300)||!text(s.objective)||!Array.isArray(s.depends_on)||new Set(s.depends_on).size!==s.depends_on.length||s.depends_on.some(id=>!seen.has(id)))throw new Error('Use unique step IDs and dependencies on earlier steps only.');
  if(s.files?.some(f=>!validGrant(f))||s.commands?.some(c=>!validGrant({...c,execution_location:'host'})))throw new Error('Invalid planned files or commands.');
  if(s.commands&&new Set(s.commands.map(c=>JSON.stringify([c.command,c.cwd]))).size!==s.commands.length)throw new Error('List each command and directory only once, with its network requirement.');
  seen.add(s.id);const criteria=new Set<string>();
  if(!Array.isArray(s.criteria)||!s.criteria.length||s.criteria.length>20)throw new Error('Each step needs 1–20 acceptance criteria.');
  for(const c of s.criteria){if(!c||!text(c.id,80)||criteria.has(c.id)||!text(c.description,1000)||!['human','command'].includes(c.verification))throw new Error('Invalid acceptance criterion.');criteria.add(c.id);
   if(c.verification==='command'&&(!text(c.command,20000)||!text(c.cwd,2048)||!relative(c.cwd)))throw new Error('Command criteria need an exact command and relative cwd (use . for root).');
   if(c.verification==='human'&&(c.command!==undefined||c.cwd!==undefined))throw new Error('Human criteria do not accept commands.');
  }
 }
}
export class PlanController {
 constructor(readonly state:PlanState){}
 static propose(proposal:PlanProposal,original:string,previous?:PlanState,contract?:2,fingerprint?:string|null){
  validateProposal(proposal);const executions:StepExecution[]=[];const retained=new Set<string>();
  for(const step of proposal.steps){const old=previous?.steps.find(s=>s.id===step.id),run=previous?.executions.find(s=>s.id===step.id);const keep=previous?.contract_version===contract&&(contract!==2||!!fingerprint&&run?.attempts.at(-1)?.workspace_fingerprint===fingerprint)&&old&&run?.status==='completed'&&JSON.stringify(old)===JSON.stringify(step)&&step.depends_on.every(id=>retained.has(id));if(keep)retained.add(step.id);executions.push(keep?structuredClone(run):{id:step.id,status:'pending',attempts:[]});}
  return new PlanController({...(contract?{contract_version:contract}:{}),plan_id:previous?.plan_id||randomUUID(),version:(previous?.version||0)+1,objective:proposal.objective,steps:structuredClone(proposal.steps),original_request:original,status:'proposed',executions,updated_at:Date.now()});
 }
 get active(){return this.state.executions.find(s=>s.id===this.state.active_step);}
 get attempt(){return this.active?.attempts.at(-1);}
 get definition(){return this.state.steps.find(s=>s.id===this.state.active_step);}
 touch(){this.state.updated_at=Date.now();}
 approve(version:number,permission:'supervised'|'autonomous'){
  if(version!==this.state.version||this.state.status!=='proposed'||this.state.approved)throw new Error('The plan changed or was already approved.');
  this.state.approved={version,at:Date.now(),permission};this.state.execution_id=randomUUID();this.state.status='paused';this.touch();
 }
 begin(){
  if(this.state.approved?.version!==this.state.version)throw new Error('Approve this plan version before execution.');
  if(this.attempt?.wait_reason==='review'&&this.active?.status==='waiting_user')throw new Error('Review the step result before continuing.');
  const next=this.state.executions.find(s=>s.status!=='completed');
  if(!next){this.state.active_step=undefined;this.state.status='completed';this.touch();return false;}
  const def=this.state.steps.find(s=>s.id===next.id)!;
  if(def.depends_on.some(id=>this.state.executions.find(s=>s.id===id)?.status!=='completed'))throw new Error('Complete dependencies first.');
  if(next.status==='running'||next.status==='validating')throw new Error('This step is already running.');
  next.status='running';next.attempts.push({number:(next.attempts.at(-1)?.number||0)+1,started_at:Date.now(),status:'running',evidence:[],criteria:[]});this.state.active_step=next.id;this.state.status='running';this.touch();return true;
 }
 reportIdentity(){return {execution_id:this.state.execution_id!,plan_version:this.state.version,step_id:this.state.active_step!,attempt:this.attempt!.number};}
 reportGuidance(){if(this.state.contract_version===2)return 'This step is already approved. Perform the work, then call report_step_result with outcome and summary. The host supplies execution identity and runs the approved checks. Do not ask for plan approval or invent progress.';return 'This plan is already approved. Execute the active step; do not request plan approval again. report_step_result must use exactly '+JSON.stringify(this.reportIdentity())+'. Criteria: '+JSON.stringify(this.definition!.criteria)+'. Available evidence from this attempt: '+JSON.stringify(this.attempt!.evidence.map(e=>({evidence_id:e.id,tool:e.tool,status:e.status,path:e.path})))+'. First perform the work and checks. Then report observed results with criterion_id and tool_call_ids (evidence_id values). Do not report completion merely because a plan exists.';}
 checkReport(r:StepReport){if(!this.state.approved||this.state.status!=='running'||this.active?.status!=='running'||r.execution_id!==this.state.execution_id||r.plan_version!==this.state.version||r.step_id!==this.state.active_step||r.attempt!==this.attempt?.number)throw new Error('Report must match the active execution, plan version, step and attempt.');
  const ids=new Set<string>();for(const e of r.evidence){if(ids.has(e.criterion_id)||!this.definition!.criteria.some(c=>c.id===e.criterion_id))throw new Error('Unknown or duplicate criterion.');ids.add(e.criterion_id);for(const id of e.tool_call_ids)if(!this.attempt!.evidence.some(e=>e.id===id))throw new Error('Evidence must reference a tool result from the current attempt.');}
  if(this.state.contract_version!==2&&r.outcome==='completed'&&this.definition!.criteria.some(c=>!r.evidence.find(e=>e.criterion_id===c.id)?.tool_call_ids.length))throw new Error('Completion requires observed tool evidence for every criterion, including human review. Perform the work or inspect its actual result before reporting; a plan or approval is not implementation evidence.');
 }
 record(evidence:StepEvidence){if(this.attempt&&this.state.status==='running'){if(this.attempt.evidence.some(e=>e.id===evidence.id))throw new Error('Duplicate evidence ID.');this.attempt.evidence.push(evidence);this.touch();}}
 wait(reason:'question'|'approval'){if(this.active&&this.attempt){this.attempt.waiting_from=this.active.status==='validating'?'validating':'running';this.active.status=this.attempt.status='waiting_user';this.attempt.wait_reason=reason;this.touch();}}
 unwait(){if(this.active?.status==='waiting_user'&&this.attempt&&this.attempt.wait_reason!=='review'){this.active.status=this.attempt.status=this.attempt.waiting_from||'running';delete this.attempt.waiting_from;delete this.attempt.wait_reason;this.touch();}}
 prepareValidation(r:StepReport){this.checkReport(r);this.active!.status=this.attempt!.status='validating';this.touch();}
 validate(r:StepReport,fingerprint:string|null,prepared=false){
  if(!prepared)this.prepareValidation(r);else if(this.active?.status!=='validating'||r.execution_id!==this.state.execution_id||r.plan_version!==this.state.version||r.step_id!==this.state.active_step||r.attempt!==this.attempt?.number)throw new Error('Validation no longer belongs to the active attempt.');
  const a=this.attempt!;a.correcting=false;a.workspace_fingerprint=fingerprint;a.summary=r.summary+(r.remaining_issues.length?'\n'+r.remaining_issues.join('\n'):'');
  if(r.outcome!=='completed'){this.pause(r.outcome);return;}
  a.criteria=this.definition!.criteria.map(c=>{
   const ids=r.evidence.find(e=>e.criterion_id===c.id)?.tool_call_ids||[],rows=ids.map(id=>a.evidence.find(e=>e.id===id)!);
   if(rows.some(e=>['error','uncertain','cancelled','denied'].includes(e.status)||e.command&&(e.command.cancelled||e.command.exit_code!==0)))return {id:c.id,status:'failed',reason:'Referenced evidence includes a failed or uncertain operation.',evidence_ids:ids};
   if(c.verification==='human'&&!rows.length)return {id:c.id,status:'failed',reason:'No observed work is available for review.',evidence_ids:ids};
   if(c.verification==='human')return {id:c.id,status:'review',reason:'Human review required.',evidence_ids:ids};
   const commands=rows.filter(e=>e.tool==='run_command'&&e.command?.command===c.command&&e.command?.cwd===c.cwd);
   const last=commands.at(-1);
   if(!last)return {id:c.id,status:'failed',reason:'No matching command evidence from this attempt.',evidence_ids:ids};
   const result=last.command!;
   if(result.cancelled||last.status!=='success'||result.exit_code!==0)return {id:c.id,status:'failed',reason:'The verification failed or was interrupted.',evidence_ids:ids};
   // A later failed repeat cannot be hidden by citing an older passing command.
   const newer=a.evidence.slice(a.evidence.indexOf(last)+1).some(e=>e.command?.command===c.command&&e.command?.cwd===c.cwd&&e.command?.exit_code!==0);
   if(newer)return {id:c.id,status:'failed',reason:'A later verification failed.',evidence_ids:ids};
   if(!fingerprint||!result.fingerprint)return {id:c.id,status:'review',reason:'Workspace correspondence could not be verified automatically.',evidence_ids:ids};
   if(result.fingerprint!==fingerprint)return {id:c.id,status:'failed',reason:'Workspace changed after verification. Run the check again.',evidence_ids:ids};
   return {id:c.id,status:newer?'failed':'verified',reason:newer?'A later verification failed.':'Approved command exited successfully on the current workspace snapshot.',evidence_ids:ids};
  });
  if(r.remaining_issues.length||a.criteria.some(c=>c.status==='failed'))this.pause('failed');
  else if(a.criteria.some(c=>c.status==='review')){this.pause('waiting_user');a.wait_reason='review';}
  else this.complete();
 }
 correct(){const a=this.attempt!;if(this.active?.status!=='failed'||(a.corrections||0)>=2)return false;a.corrections=(a.corrections||0)+1;a.correcting=true;delete a.ended_at;this.active.status=a.status='running';this.state.status='running';this.touch();return true;}
 private complete(){this.active!.status=this.attempt!.status='completed';this.attempt!.ended_at=Date.now();delete this.attempt!.wait_reason;this.state.status=this.state.executions.every(s=>s.status==='completed')?'completed':'paused';this.touch();}
 pause(status:'failed'|'blocked'|'interrupted'|'waiting_user',reason?:string){if(this.active&&this.attempt&&this.active.status!=='completed'){this.active.status=this.attempt.status=status;if(reason)this.attempt.summary=reason;this.attempt.ended_at=Date.now();if(status!=='waiting_user')delete this.attempt.wait_reason;}this.state.status='paused';this.touch();}
 review(action:'confirm'|'correct',comment:string,fingerprint:string|null){
  const a=this.attempt;if(this.active?.status!=='waiting_user'||a?.wait_reason!=='review')throw new Error('This step is not awaiting result review.');
  if(a.criteria.some(c=>c.status==='failed'))throw new Error('A failed verification cannot be accepted.');
  if(action==='confirm'&&a.criteria.some(c=>c.status==='verified'&&c.evidence_ids.some(id=>{const e=a.evidence.find(e=>e.id===id);return e?.command?.fingerprint&&e.command.fingerprint!==fingerprint;})))throw new Error('Workspace changed. Request a correction and run verification again.');
  a.decision={action,comment,at:Date.now()};if(action==='confirm'){a.workspace_fingerprint=fingerprint;this.complete();}else this.pause('blocked','User requested correction: '+comment);
 }
 envelope(permission:string,limits:unknown){return {type:'execute_step',origin:'vortex_orchestrator',execution_id:this.state.execution_id,plan_id:this.state.plan_id,plan_version:this.state.version,step_id:this.state.active_step,attempt:this.attempt?.number,original_request:this.state.original_request,objective:this.state.objective,step:this.definition,plan:this.state.steps.map(s=>({id:s.id,title:s.title,depends_on:s.depends_on})),previous_results:this.state.executions.filter(s=>s.status==='completed').map(s=>({step_id:s.id,summary:s.attempts.at(-1)?.summary})),previous_attempt:this.active?.attempts.at(-2)?{status:this.active.attempts.at(-2)!.status,summary:this.active.attempts.at(-2)!.summary,criteria:this.active.attempts.at(-2)!.criteria}:undefined,correction:this.active?.attempts.at(-2)?.decision?.comment,mode:'agent',permission,limits};}
}
/** Validate disk data before it can ever authorize an operation. */
export function validatePlanState(value:PlanState){
 validateProposal(value);validateAuthorization(value);if(value.contract_version===2&&!value.authorization)throw new Error('Missing plan authorization.');if(value.contract_version!==undefined&&value.contract_version!==2)throw new Error('Unsupported plan contract.');if(!text(value.plan_id,100)||!Number.isSafeInteger(value.version)||value.version<1||!text(value.original_request,100000)||!['proposed','running','paused','completed'].includes(value.status)||!Array.isArray(value.executions)||value.executions.length!==value.steps.length)throw new Error('Invalid persisted plan.');
 if(value.approved&&(value.approved.version!==value.version||!Number.isFinite(value.approved.at)||!['supervised','autonomous'].includes(value.approved.permission)||!text(value.execution_id,100)))throw new Error('Invalid persisted plan approval.');
 if(value.status!=='proposed'&&!value.approved)throw new Error('Missing plan approval.');
 for(const [i,e]of value.executions.entries()){if(e.id!==value.steps[i].id||!['pending','running','validating','completed','waiting_user','blocked','failed','interrupted'].includes(e.status)||!Array.isArray(e.attempts))throw new Error('Invalid persisted step.');for(const a of e.attempts){if(a.corrections!==undefined&&(!Number.isInteger(a.corrections)||a.corrections<0||a.corrections>2))throw new Error('Invalid correction counter.');if(!Number.isSafeInteger(a.number)||a.number<1||!Array.isArray(a.evidence)||!Array.isArray(a.criteria)||!Number.isFinite(a.started_at))throw new Error('Invalid persisted attempt.');for(const r of a.evidence){if(!text(r.id,100)||!text(r.tool,100)||!text(r.status,30)||!Number.isFinite(r.timestamp))throw new Error('Invalid persisted evidence.');if(r.command&&(!text(r.command.command,20000)||!text(r.command.cwd,2048)||!['host','sandbox'].includes(r.command.execution_location)||r.command.exit_code!==null&&!Number.isInteger(r.command.exit_code)||typeof r.command.cancelled!=='boolean'||typeof r.command.output!=='string'||r.command.fingerprint!==null&&!text(r.command.fingerprint,100)))throw new Error('Invalid command evidence.');}for(const c of a.criteria)if(!text(c.id,80)||!['verified','review','failed'].includes(c.status)||!Array.isArray(c.evidence_ids)||!c.evidence_ids.every(id=>a.evidence.some(e=>e.id===id)))throw new Error('Invalid criterion result.');}}
 for(const [i,e] of value.executions.entries()){
  const last=e.attempts.at(-1);if(last&&last.status!==e.status)throw new Error('Inconsistent step status.');
  if(e.status!=='pending'&&!last)throw new Error('Missing attempt.');
  if(last?.decision&&(!['confirm','correct'].includes(last.decision.action)||typeof last.decision.comment!=='string'||!Number.isFinite(last.decision.at)))throw new Error('Invalid review decision.');
  if(e.status==='completed'&&(!last||last.criteria.length!==value.steps[i].criteria.length||last.criteria.some(c=>c.status==='failed'||c.status==='review'&&last.decision?.action!=='confirm')))throw new Error('Completion lacks verified criteria or human review.');
  if(last&&(new Set(last.criteria.map(c=>c.id)).size!==last.criteria.length||last.criteria.some(c=>!value.steps[i].criteria.some(def=>def.id===c.id))))throw new Error('Duplicate persisted criteria.');
 }
 if(value.status==='completed'&&value.executions.some(e=>e.status!=='completed'))throw new Error('Incomplete plan marked completed.');
 if(value.executions.filter(e=>['running','validating','waiting_user'].includes(e.status)).length>1)throw new Error('Multiple active steps.');
 if(value.active_step&&!value.steps.some(s=>s.id===value.active_step))throw new Error('Unknown active step.');
}
