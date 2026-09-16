import {randomUUID} from 'node:crypto';
import {ApprovalDenied} from './actions';
import type {Interaction,InteractionReply,Response} from './protocol';

type Input = Interaction extends infer T ? T extends Interaction ? Omit<T,'id'> : never : never;
/** One live request, bound to a unique ID. UI reloads may replay it, never approve it. */
export class Interactions {
 private pending?:{data:Interaction;finish:(reply?:InteractionReply)=>void;preview?:()=>Promise<void>};
 constructor(private post:(message:Response)=>void){}
 snapshot(post=this.post){post({type:'interaction',interaction:this.pending?.data||null});}
 request(input:Input,signal:AbortSignal,preview?:()=>Promise<void>,created?:(data:Interaction)=>void):Promise<InteractionReply>{
  signal.throwIfAborted();if(this.pending)throw new Error('An interaction is already pending.');
  return new Promise((resolve,reject)=>{
   const data={...input,id:randomUUID()} as Interaction;
   const abort=()=>finish();
   const finish=(reply?:InteractionReply)=>{
    if(this.pending?.data.id!==data.id)return;
    this.pending=undefined;signal.removeEventListener('abort',abort);this.snapshot();
    if(reply)resolve(reply);else reject(new ApprovalDenied('Interaction cancelled. No further actions will run.'));
   };
   this.pending={data,finish,preview};signal.addEventListener('abort',abort,{once:true});created?.(data);this.snapshot();
  });
 }
 async respond(reply:InteractionReply){
  const pending=this.pending;if(!pending||reply.id!==pending.data.id)throw new Error('This request is no longer pending.');
  const data=pending.data;
  if(reply.decision==='preview'){
   if(data.kind!=='approval'||!data.preview||!pending.preview)throw new Error('No diff available.');
   await pending.preview();return;
  }
  if(reply.decision==='reject'){pending.finish(reply);return;}
  if(data.kind==='question'){
   if(reply.decision!=='answer'||!reply.answer?.trim()||reply.answer.length>4000||reply.hunks!==undefined)throw new Error('Enter an answer of up to 4000 characters.');
   pending.finish({...reply,answer:reply.answer.trim()});return;
  }
  if(reply.decision!=='approve'||reply.answer!==undefined)throw new Error('Invalid approval response.');
  if(reply.hunks!==undefined&&(!data.hunks||!reply.hunks.length||new Set(reply.hunks).size!==reply.hunks.length||reply.hunks.some(i=>!Number.isInteger(i)||i<0||i>=data.hunks!.length)))throw new Error('Select at least one valid change.');
  pending.finish(reply);
 }
 dispose(){this.pending?.finish();}
}
