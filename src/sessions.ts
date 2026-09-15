import {mkdir,readFile,readdir,writeFile,rename,unlink} from 'node:fs/promises';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentEvent,ChecklistItem,ModelRef,SessionSummary,isModelRef} from './protocol';
import {Mode,Permission,migratePolicy} from './policy';
import {Message} from './providers';
export interface Session extends SessionSummary { events:AgentEvent[]; messages:Message[]; checklist:ChecklistItem[]; mode:Mode; permission:Permission; model:ModelRef }
export class SessionStore {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private directory:string){}
  create(prompt:string,mode:Mode,model:ModelRef,permission:Permission='supervised'):Session {return {id:randomUUID(),title:prompt.replace(/\s+/g,' ').slice(0,90),updatedAt:Date.now(),events:[],messages:[],checklist:[],mode,permission,model};}
  private file(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid session ID.');return path.join(this.directory,id+'.json');}
  async save(session:Session):Promise<void>{
    const snapshot=JSON.stringify({...session,updatedAt:Date.now()});const file=this.file(session.id);
    const work=this.queue.then(async()=>{await mkdir(this.directory,{recursive:true});await writeFile(file+'.tmp',snapshot,{mode:0o600});await rename(file+'.tmp',file);});this.queue=work.catch(()=>undefined);return work;
  }
  async load(id:string):Promise<Session>{
    await this.queue;const session=JSON.parse(await readFile(this.file(id),'utf8'));
    const strings=(row:any)=>row&&typeof row.content==='string'&&['user','assistant'].includes(row.role);
    if(!session||session.id!==id||typeof session.title!=='string'||!Number.isFinite(session.updatedAt)||!isModelRef(session.model)
      ||!Array.isArray(session.messages)||!session.messages.every(strings)
      ||!Array.isArray(session.events)||!session.events.every((e:any)=>e&&['user','assistant','activity'].includes(e.role)&&typeof e.text==='string')
      ||!Array.isArray(session.checklist)||!session.checklist.every((i:any)=>i&&typeof i.id==='string'&&typeof i.text==='string'&&['pending','running','done'].includes(i.status)))throw new Error('This session is damaged and cannot be opened. Other sessions are unchanged.');
    return {...session,...migratePolicy(session.mode,session.permission)};
  }
  async list(query=''):Promise<SessionSummary[]>{
    await this.queue;let files:string[];try{files=await readdir(this.directory);}catch(e:any){if(e.code==='ENOENT')return [];throw e;}
    const matches:SessionSummary[]=[];
    for(const file of files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){try{const s=JSON.parse(await readFile(path.join(this.directory,file),'utf8')) as Session;if(!query||[s.title,...s.events.filter(e=>e.role!=='activity').map(e=>e.text)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))matches.push({id:s.id,title:s.title,updatedAt:s.updatedAt});}catch{/* Leave corrupt files untouched; other sessions remain accessible. */}}
    return matches.sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  async remove(id:string):Promise<void>{await this.queue;await unlink(this.file(id));}
}
