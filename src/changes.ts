import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
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
  const work=(async()=>{await prior;let rows:Change[];try{rows=JSON.parse(await readFile(this.file(session),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;rows=[];}fn(rows);await mkdir(this.directory,{recursive:true});const file=this.file(session);await writeFile(file+'.tmp',JSON.stringify(rows),{mode:0o600});await rename(file+'.tmp',file);})();
  this.queue=work.catch(()=>undefined);return work;
 }
 async propose(session:string,file:string,before:string|null,after:string|null){const row:Change={id:randomUUID(),path:file,before,after,status:'proposed',createdAt:Date.now()};await this.update(session,rows=>rows.push(row));return row;}
 async replaceProposal(session:string,id:string,after:string|null){await this.update(session,rows=>{const row=rows.find(c=>c.id===id);if(!row||row.status!=='proposed')throw new Error('Proposal changed.');row.after=after;});}
 async mark(session:string,id:string,status:Change['status']){await this.update(session,rows=>{const row=rows.find(c=>c.id===id);if(!row)throw new Error('Change not found.');row.status=status;});}
}
