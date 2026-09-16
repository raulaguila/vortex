import type {PlanState} from "./plan";

export type FileGrant={path:string;operation:'create'|'edit'|'delete'};
export type CommandGrant={command:string;cwd:string;execution_location:'host'|'sandbox';request_network:boolean};
export type StepScope={step_id:string;files:FileGrant[];commands:CommandGrant[]};
export type PlanAuthorization={session_id:string;workspace:string;plan_version:number;revision:number;steps:StepScope[]};
export type Grant=FileGrant|CommandGrant;

export function validGrant(g:Grant):boolean {
 if(!g||typeof g!=='object')return false;
 const relative=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=2048&&!/[\0*?\[\]{}]/.test(s)&&!s.startsWith('/')&&!s.startsWith('\\')&&!/^[a-z]:/i.test(s)&&!s.split(/[\\/]/).some(p=>p==='..'||p==='.git'||p==='.env'||p.startsWith('.env.'));
 if('path' in g)return relative(g.path)&&g.path!=='.'&&['create','edit','delete'].includes(g.operation);
 return typeof g.command==='string'&&!!g.command.trim()&&g.command.length<=20000&&relative(g.cwd)&&['host','sandbox'].includes(g.execution_location)&&typeof g.request_network==='boolean';
}
export function equalGrant(a:Grant,b:Grant):boolean {
 return 'path' in a&&'path' in b?a.path===b.path&&a.operation===b.operation:'command' in a&&'command' in b&&a.command===b.command&&a.cwd===b.cwd&&a.execution_location===b.execution_location&&a.request_network===b.request_network;
}
export function currentScope(plan:PlanState|undefined,session:string,workspace:string):StepScope|undefined {
 const a=plan?.authorization;
 if(plan?.contract_version!==2||!plan.approved||plan.approved.version!==plan.version||a?.session_id!==session||a.workspace!==workspace||a.plan_version!==plan.version||plan.status!=='running')return;
 return a.steps.find(s=>s.step_id===plan.active_step);
}
export function includesGrant(scope:StepScope|undefined,g:Grant){return !!scope&&[...scope.files,...scope.commands].some(row=>equalGrant(row,g));}
export function addGrant(scope:StepScope,g:Grant){if(!validGrant(g))throw new Error('Invalid plan authorization.');if(!includesGrant(scope,g)){if('path' in g)scope.files.push({...g});else scope.commands.push({...g});}}
export function validateAuthorization(plan:PlanState){
 const a=plan.authorization;if(!a)return;
 if(plan.contract_version!==2||typeof a.session_id!=='string'||typeof a.workspace!=='string'||a.plan_version!==plan.version||!Number.isSafeInteger(a.revision)||a.revision<1||!Array.isArray(a.steps)||a.steps.length!==plan.steps.length)throw new Error('Invalid plan authorization.');
 for(let i=0;i<a.steps.length;i++){const s=a.steps[i];if(s.step_id!==plan.steps[i].id||!Array.isArray(s.files)||!Array.isArray(s.commands)||s.files.some(g=>!validGrant(g)||!('path' in g))||s.commands.some(g=>!validGrant(g)||!('command' in g)))throw new Error('Invalid step authorization.');}
}
