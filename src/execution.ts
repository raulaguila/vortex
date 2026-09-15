export interface ModelTimeouts {firstResponseTimeout:number;idleTimeout:number}
export interface ExecutionPreferences extends ModelTimeouts {maxRounds:number;maxToolCalls:number;commandTimeout:number;taskTimeout:number;tokenBudget:number|null}
export const defaultExecution=():ExecutionPreferences=>({maxRounds:20,maxToolCalls:20,firstResponseTimeout:120,idleTimeout:120,commandTimeout:60,taskTimeout:1800,tokenBudget:null});
const integer=(n:unknown,min:number,max:number):n is number=>Number.isSafeInteger(n)&&Number(n)>=min&&Number(n)<=max;
export function validTimeouts(v:any):v is ModelTimeouts{return !!v&&integer(v.firstResponseTimeout,1,3600)&&integer(v.idleTimeout,1,3600);}
export function validExecution(v:any):v is ExecutionPreferences{return !!v&&typeof v==='object'&&integer(v.maxRounds,1,200)&&integer(v.maxToolCalls,1,200)&&integer(v.commandTimeout,1,3600)&&integer(v.taskTimeout,1,86400)&&(v.tokenBudget===null||integer(v.tokenBudget,1024,100000000))&&validTimeouts(v);}
export function migrateExecution(v:any):ExecutionPreferences{
 const d=defaultExecution();if(!v||typeof v!=='object')return d;
 const merged={...d,...v,maxRounds:v.maxRounds??v.maxSteps??d.maxRounds,maxToolCalls:v.maxToolCalls??v.maxSteps??d.maxToolCalls,firstResponseTimeout:v.firstResponseTimeout??v.modelTimeout??d.firstResponseTimeout,idleTimeout:v.idleTimeout??v.modelTimeout??d.idleTimeout};
 return Object.fromEntries(Object.keys(d).map(k=>[k,validExecution({...d,[k]:merged[k]})?merged[k]:d[k as keyof ExecutionPreferences]])) as unknown as ExecutionPreferences;
}
export type FailureCode='cancelled'|'first_response_timeout'|'idle_timeout'|'task_timeout'|'command_timeout'|'transport'|'authentication'|'provider'|'invalid_response'|'tool_validation';
export class ExecutionError extends Error{constructor(readonly code:FailureCode,message:string,readonly retryable=false){super(message);}}
export async function awaitApproval<T>(request:()=>PromiseLike<T>,signal?:AbortSignal):Promise<T>{
 signal?.throwIfAborted();let cancel:()=>void=()=>{};
 try{return await Promise.race([Promise.resolve(request()),new Promise<never>((_,reject)=>{cancel=()=>reject(signal?.reason||new ExecutionError('cancelled','Cancelled.'));signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();})]);}
 finally{signal?.removeEventListener('abort',cancel);signal?.throwIfAborted();}
}
/** The initial deadline includes connection/headers. Valid stream content starts the idle deadline. */
export class ResponseDeadline{
 readonly controller=new AbortController();private timer?:ReturnType<typeof setTimeout>;private progressed=false;
 constructor(private limits:ModelTimeouts){this.arm(limits.firstResponseTimeout,'first_response_timeout');}
 private arm(seconds:number,code:FailureCode){clearTimeout(this.timer);this.timer=setTimeout(()=>this.controller.abort(new ExecutionError(code,code==='idle_timeout'?'No response progress within the configured timeout.':'The model did not respond within the configured timeout.',true)),seconds*1000);}
 progress(){this.progressed=true;this.arm(this.limits.idleTimeout,'idle_timeout');}
 get hasProgress(){return this.progressed;}
 dispose(){clearTimeout(this.timer);}
}
