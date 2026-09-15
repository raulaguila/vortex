import * as vscode from 'vscode';
import {ApprovalDenied} from './actions';
export function askQuestion(text:string,options:string[]|undefined,signal:AbortSignal):Promise<string>{
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const input=vscode.window.createInputBox();input.title='Vortex';input.prompt=text;input.ignoreFocusOut=true;
  if(options?.length)input.placeholder=options.join(' / ');
  let settled=false;
  const subscriptions:vscode.Disposable[]=[];
  const finish=(answer?:string)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);subscriptions.forEach(s=>s.dispose());input.dispose();answer?resolve(answer):reject(new ApprovalDenied('Question cancelled. Task paused without further actions.'));};
  const abort=()=>finish();
  subscriptions.push(input.onDidAccept(()=>{const value=input.value.trim();if(!value||value.length>4000){input.validationMessage='Enter an answer (up to 4000 characters).';return;}finish(value);}),input.onDidHide(()=>finish()));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}input.show();
 });
}
