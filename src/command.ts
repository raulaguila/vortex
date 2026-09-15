import {ExecutionError} from './execution';
import {spawn,execFile} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

// A process group lets Stop/timeout terminate the shell and its ordinary descendants.
export function runCommand(command:string,cwd:string,signal:AbortSignal,timeout=60000,maxBytes=1024*1024):Promise<string>{
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
    const stop=(error:Error)=>{if(finished)return;reason=error;terminate();};
    const aborted=()=>stop(new Error('Command cancelled.'));
    const timer=setTimeout(()=>stop(new ExecutionError('command_timeout','Command timed out.')),timeout);
    signal.addEventListener('abort',aborted,{once:true});
    const cleanup=()=>{finished=true;clearTimeout(timer);signal.removeEventListener('abort',aborted);};
    const collect=(stream:'stdout'|'stderr',chunk:Buffer)=>{
      bytes+=chunk.length;if(bytes>maxBytes){stop(new Error('Command output exceeded 1 MB. Narrow the command.'));return;}
      if(stream==='stdout')stdout+=decoders.stdout.write(chunk);else stderr+=decoders.stderr.write(chunk);
    };
    child.stdout?.on('data',chunk=>collect('stdout',chunk));child.stderr?.on('data',chunk=>collect('stderr',chunk));
    child.once('error',error=>{cleanup();reject(reason||error);});
    child.once('close',(code)=>{
      if(finished)return;cleanup();
      const output=`Exit: ${code??'interrupted'}\n${stdout+decoders.stdout.end()}\n${stderr+decoders.stderr.end()}`;
      if(reason)reject(new Error(reason.message+'\n'+output));else if(code!==0)reject(new Error(output));else resolve(output);
    });
    if(signal.aborted)aborted();
  });
}
