import {ExecutionError} from "../core/execution";
import {spawn,execFile} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

export interface CommandResult {exit_code:number|null;cancelled:boolean;output:string}
export class CommandFailure extends Error {constructor(readonly commandResult:CommandResult){super(commandResult.output);}}
export async function runCommand(...args:Parameters<typeof runCommandDetailed>):Promise<string>{return (await runCommandDetailed(...args)).output;}
// A process group lets Stop/timeout terminate the shell and its ordinary descendants.
export function runCommandDetailed(command:string,cwd:string,signal:AbortSignal,timeout=60000,maxBytes=1024*1024,onOutput?:(stream: 'stdout'|'stderr',text:string)=>void):Promise<CommandResult>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(command,{cwd,shell:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',bytes=0,reason:Error|undefined,finished=false;
    const decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
    const terminate=()=>{
      if(!child.pid)return;
      if(process.platform==='win32')execFile('taskkill',['/PID',String(child.pid),'/T','/F'],()=>{});
      else try{process.kill(-child.pid,'SIGKILL');}catch{/* Already exited. */}
    };
    const stop=(error:Error)=>{if(finished||reason)return;reason=error;terminate();};
    const aborted=()=>stop(signal.reason instanceof ExecutionError?signal.reason:new ExecutionError('cancelled','Command cancelled.'));
    const timer=setTimeout(()=>stop(new ExecutionError('command_timeout','Command timed out.')),timeout);
    signal.addEventListener('abort',aborted,{once:true});
    const cleanup=()=>{finished=true;clearTimeout(timer);signal.removeEventListener('abort',aborted);};
    const collect=(stream:'stdout'|'stderr',chunk:Buffer)=>{
      bytes+=chunk.length;if(bytes>maxBytes){stop(new ExecutionError('uncertain_outcome','Command output exceeded its limit. Review the workspace before continuing.'));return;}
      const text=decoders[stream].write(chunk);if(stream==='stdout')stdout+=text;else stderr+=text;onOutput?.(stream,text);
    };
    child.stdout?.on('data',chunk=>collect('stdout',chunk));child.stderr?.on('data',chunk=>collect('stderr',chunk));
    child.once('error',error=>{cleanup();reject(reason||error);});
    child.once('close',(code)=>{
      if(finished)return;cleanup();
      const output=`Exit: ${code??'interrupted'}\n${stdout+decoders.stdout.end()}\n${stderr+decoders.stderr.end()}`;
      const result={exit_code:code,cancelled:!!reason,output};if(reason){reason.message+='\n'+output;Object.assign(reason,{commandResult:result});reject(reason);}else if(code!==0)reject(new CommandFailure(result));else resolve(result);
    });
    if(signal.aborted)aborted();
  });
}
