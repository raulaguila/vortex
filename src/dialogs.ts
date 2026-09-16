import {randomUUID} from 'node:crypto';
import type {DialogSpec,DialogReply,Response} from './protocol';

/** One broker per webview: replies from another surface cannot settle a request. */
export class Dialogs {
 private pending?:{spec:DialogSpec;finish:(value?:string)=>void;validate?:(value:string)=>string|undefined};
 private disposed=false;
 constructor(private post:(message:Response)=>void){}
 request(spec:Omit<DialogSpec,'id'>,signal?:AbortSignal,validate?:(value:string)=>string|undefined):Promise<string|undefined>{
  if(this.disposed||signal?.aborted)return Promise.resolve(undefined);
  if(this.pending)throw new Error('Finish the open Vortex dialog first.');
  return new Promise(resolve=>{
   const full={...spec,id:randomUUID()};
   const abort=()=>finish();
   const finish=(value?:string)=>{if(this.pending?.spec.id!==full.id)return;this.pending=undefined;signal?.removeEventListener('abort',abort);this.post({type:'dialog',dialog:null});resolve(value);};
   this.pending={spec:full,finish,validate};signal?.addEventListener('abort',abort,{once:true});this.snapshot();
  });
 }
 respond(reply:DialogReply){
  const p=this.pending;if(!p||p.spec.id!==reply.id)throw new Error('This dialog is no longer active.');
  if(reply.value===null){p.finish();return;}
  if(p.spec.kind==='progress')throw new Error('This operation is still running.');
  if(p.spec.kind==='pick'&&!p.spec.choices?.some(c=>c.id===reply.value))throw new Error('Invalid selection.');
  if(['confirm','notice'].includes(p.spec.kind)&&reply.value!=='accept')throw new Error('Invalid confirmation.');
  const error=p.validate?.(reply.value);if(error)throw new Error(error);
  p.finish(reply.value);
 }
 snapshot(){if(this.pending)this.post({type:'dialog',dialog:this.pending.spec});}
 dispose(){this.disposed=true;this.pending?.finish();}
 confirm(title:string,detail:string,accept='Confirm',signal?:AbortSignal){return this.request({kind:'confirm',title,detail,accept},signal).then(value=>value==='accept');}
 async pick<T>(title:string,items:{label:string;description?:string;value:T}[],detail?:string):Promise<T|undefined>{
  const id=await this.request({kind:'pick',title,detail,choices:items.map((item,i)=>({id:String(i),label:item.label,description:item.description}))});
  return id===undefined?undefined:items[Number(id)]?.value;
 }
 input(title:string,value:string,detail:string,validate:(value:string)=>string|undefined){return this.request({kind:'input',title,value,detail,accept:'Continue'},undefined,validate);}
 async notice(title:string,detail?:string){await this.request({kind:'notice',title,detail,accept:'OK'});}
 async progress(title:string,work:(signal:AbortSignal)=>Promise<void>){
  const controller=new AbortController();
  const waiting=this.request({kind:'progress',title});const id=this.pending?.spec.id;if(!id)return false;
  let finished=false;void waiting.then(()=>{if(!finished)controller.abort();});
  try{await work(controller.signal);return !controller.signal.aborted;}
  catch(error){if(!controller.signal.aborted)throw error;return false;}
  finally{finished=true;if(this.pending?.spec.id===id)this.pending?.finish();await waiting;}
 }
}
export type GetDialogs=()=>Promise<Dialogs>;
