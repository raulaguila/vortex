import type {PlanProposal,StepReport} from "./plan";
import type {FileGrant} from "./planAuthorization";

export type ModelProposal={objective:string;steps:{title:string;objective:string;depends_on?:number[];files?:FileGrant[];commands?:{command:string;cwd?:string;request_network?:boolean}[];criteria:{description:string;verification:'command'|'human';command?:string;cwd?:string}[]}[]};
export type ModelStepReport={outcome:'completed'|'blocked'|'failed';summary:string;remaining_issues?:string[];evidence?:{criterion_id:string;tool_call_ids:string[]}[]};

/** Only structural defaults are supplied. Objectives and checks must come from the proposal. */
export function normalizeProposal(input:ModelProposal):PlanProposal {
 return {objective:input.objective,steps:input.steps.map((s,i)=>({id:'step-'+(i+1),title:s.title,objective:s.objective,depends_on:(s.depends_on||[]).map(n=>{if(!Number.isInteger(n)||n<1||n>i)throw new Error('Dependencies must refer to earlier step numbers.');return 'step-'+n;}),files:s.files||[],commands:(s.commands||[]).map(c=>({...c,cwd:c.cwd??'.',request_network:c.request_network??false})),criteria:s.criteria.map((c,j)=>({...c,id:'criterion-'+(j+1),...(c.verification==='command'?{cwd:c.cwd??'.'}:{})}))}))};
}
export function bindStepReport(input:ModelStepReport,identity:Pick<StepReport,'execution_id'|'plan_version'|'step_id'|'attempt'>):StepReport {
 return {...input,...identity,evidence:input.evidence||[],remaining_issues:input.remaining_issues||[]};
}
