import {durableWrite,syncDirectory} from "../session/durable";
import {OperationState} from "../core/operation";
import {mkdir,readFile,open} from 'node:fs/promises';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
export interface Change {id:string;path:string;before:string|null;after:string|null;status:'proposed'|'applied'|'rejected'|'reverted';createdAt:number}
export class ChangeStore {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private directory:string){}
 private file(session:string){if(!/^[a-f0-9-]{36}$/.test(session))throw new Error('Invalid session ID.');return path.join(this.directory,session+'.changes.json');}
 async list(session:string):Promise<Change[]>{await this.queue;try{const rows=JSON.parse(await readFile(this.file(session),'utf8'));if(!Array.isArray(rows)||rows.some(c=>typeof c.id!=='string'||typeof c.path!=='string'||![null,'string'].includes(c.before===null?null:typeof c.before)||![null,'string'].includes(c.after===null?null:typeof c.after)||!['proposed','applied','rejected','reverted'].includes(c.status)))throw new Error('Invalid changes file.');return rows;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}}
 private update(session:string,fn:(rows:Change[])=>void){
  const prior=this.queue;
  const work=(async()=>{await prior;let rows:Change[];try{rows=JSON.parse(await readFile(this.file(session),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;rows=[];}fn(rows);await mkdir(this.directory,{recursive:true});const file=this.file(session);await durableWrite(file,JSON.stringify(rows));})();
  this.queue=work.catch(()=>undefined);return work;
 }
 async operation(session:string,state:OperationState){
  const file=this.file(session)+'.journal';await mkdir(this.directory,{recursive:true});
  let existing='';try{existing=await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(existing&&!existing.endsWith('\n'))await durableWrite(file,existing.slice(0,existing.lastIndexOf('\n')+1));
  const handle=await open(file,'a',0o600);
  try{await handle.writeFile(JSON.stringify({...state,time:Date.now()})+'\n');await handle.sync();}finally{await handle.close();}
  await syncDirectory(this.directory);
 }
 async operations(session:string):Promise<OperationState[]>{
  let text;try{text=await readFile(this.file(session)+'.journal','utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  const states=new Map<string,OperationState>();const lines=text.split('\n');
  for(let i=0;i<lines.length;i++){if(!lines[i])continue;try{const s=JSON.parse(lines[i]);if(typeof s.id!=='string'||typeof s.path!=='string'||!['prepared','applying','applied','saved','recorded'].includes(s.phase)||!['not_applied','applied','partial','uncertain'].includes(s.outcome))throw new Error();states.delete(s.id);states.set(s.id,s);}catch{if(i!==lines.length-1)throw new Error('Operation journal needs recovery.');}}
  return [...states.values()];
 }
 async propose(session:string,file:string,before:string|null,after:string|null){const row:Change={id:randomUUID(),path:file,before,after,status:'proposed',createdAt:Date.now()};await this.update(session,rows=>rows.push(row));return row;}
 async replaceProposal(session:string,id:string,after:string|null){await this.update(session,rows=>{const row=rows.find(c=>c.id===id);if(!row||row.status!=='proposed')throw new Error('Proposal changed.');row.after=after;});}
 async mark(session:string,id:string,status:Change['status']){await this.update(session,rows=>{const row=rows.find(c=>c.id===id);if(!row)throw new Error('Change not found.');row.status=status;});}
}
