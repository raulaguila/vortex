import {mkdir,readFile,readdir,writeFile,rename,unlink,stat} from 'node:fs/promises';
import * as path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AgentEvent,ChecklistItem,ModelRef,SessionSummary,isModelRef} from './protocol';
import {Mode,Permission,migratePolicy} from './policy';
import {Message} from './providers';
export interface Session extends SessionSummary {summary?:{text:string;through:number};root?:string;version?:number;runState?:'running'|'paused'|'complete'|'error';pendingTool?:{name:string;path?:string}; events:AgentEvent[]; messages:Message[]; checklist:ChecklistItem[]; mode:Mode; permission:Permission; model:ModelRef }
export class SessionStore {
  private index?:Map<string,{summary:SessionSummary;text:string}>;
  private queue:Promise<unknown>=Promise.resolve();
  private stamp='';
  private migration:Promise<void>;
  constructor(private directory:string,legacyDirectory?:string,legacyRoot?:string){this.migration=legacyDirectory&&legacyDirectory!==directory?this.migrate(legacyDirectory,legacyRoot):Promise.resolve();}
  private async migrate(legacy:string,root?:string){
    const marker=path.join(this.directory,'.migrated-'+createHash('sha256').update(legacy).digest('hex').slice(0,16));
    try{await stat(marker);return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    let files:string[];try{files=await readdir(legacy);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
    await mkdir(this.directory,{recursive:true});
    for(const file of files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){
      let data;try{data=JSON.parse(await readFile(path.join(legacy,file),'utf8'));}catch{continue;}
      try{await writeFile(path.join(this.directory,file),JSON.stringify({...data,root:data.root||root,version:2}),{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    }
    await writeFile(marker,'2',{mode:0o600});
  }
  create(prompt:string,mode:Mode,model:ModelRef,permission:Permission='supervised'):Session {return {id:randomUUID(),title:prompt.replace(/\s+/g,' ').slice(0,90),updatedAt:Date.now(),events:[],messages:[],checklist:[],mode,permission,model};}
  private file(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid session ID.');return path.join(this.directory,id+'.json');}
  async save(session:Session):Promise<void>{
    const snapshot=JSON.stringify({...session,version:3,updatedAt:Date.now()});const file=this.file(session.id);
    const work=this.queue.then(async()=>{await this.migration;await mkdir(this.directory,{recursive:true});await writeFile(file+'.tmp',snapshot,{mode:0o600});await rename(file+'.tmp',file);this.index?.set(session.id,{summary:{id:session.id,title:session.title,updatedAt:JSON.parse(snapshot).updatedAt},text:[session.title,session.root||'',new Date(JSON.parse(snapshot).updatedAt).toISOString().slice(0,10),...session.events.filter(e=>e.role!=='activity').map(e=>e.text)].join(' ').toLocaleLowerCase()});});this.queue=work.catch(()=>undefined);return work;
  }
  async load(id:string):Promise<Session>{
    await this.migration;await this.queue;const session=JSON.parse(await readFile(this.file(id),'utf8'));
    const strings=(row:any)=>row&&typeof row.content==='string'&&['user','assistant'].includes(row.role);
    if(!session||session.id!==id||typeof session.title!=='string'||!Number.isFinite(session.updatedAt)||!isModelRef(session.model)
      ||!Array.isArray(session.messages)||!session.messages.every(strings)
      ||!Array.isArray(session.events)||!session.events.every((e:any)=>e&&['user','assistant','activity'].includes(e.role)&&typeof e.text==='string')
      ||!Array.isArray(session.checklist)||!session.checklist.every((i:any)=>i&&typeof i.id==='string'&&typeof i.text==='string'&&['pending','running','done'].includes(i.status)))throw new Error('This session is damaged and cannot be opened. Other sessions are unchanged.');
    if(session.events.some((e:any)=>e.activity!==undefined&&(!e.activity||typeof e.activity.id!=='string'||typeof e.activity.runId!=='string'||typeof e.activity.name!=='string'||typeof e.activity.output!=='string'||!['success','error','denied'].includes(e.activity.status)||!Number.isFinite(e.activity.startedAt)||!Number.isFinite(e.activity.endedAt)||e.activity.path!==undefined&&typeof e.activity.path!=='string')))throw new Error('This session contains invalid activity data.');
    if(session.root!==undefined&&typeof session.root!=='string'||session.summary!==undefined&&(!session.summary||typeof session.summary.text!=='string'||!Number.isSafeInteger(session.summary.through)||session.summary.through<0||session.summary.through>session.messages.length))throw new Error('This session contains invalid continuation metadata.');
    return {...session,...migratePolicy(session.mode,session.permission)};
  }
  async list(query='',offset=0,limit=50):Promise<SessionSummary[]>{
    await this.migration;await this.queue;
    let names:string[];try{names=(await readdir(this.directory)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).sort();}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;names=[];}
    const stamp=(await Promise.all(names.map(async f=>{try{const info=await stat(path.join(this.directory,f));return f+':'+info.mtimeMs+':'+info.size;}catch{return f+':missing';}}))).join('|');if(stamp!==this.stamp){this.index=undefined;this.stamp=stamp;}
    if(!this.index){
      const index=new Map<string,{summary:SessionSummary;text:string}>();let files:string[];
      try{files=await readdir(this.directory);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;files=[];}
      for(const file of files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){try{
        const s=await this.load(file.slice(0,-5));index.set(s.id,{summary:{id:s.id,title:s.title,updatedAt:s.updatedAt},text:[s.title,s.root||'',new Date(s.updatedAt).toISOString().slice(0,10),...s.events.filter(e=>e.role!=='activity').map(e=>e.text)].join(' ').toLocaleLowerCase()});
      }catch{/* Corrupt sessions do not prevent searching valid sessions. */}}
      this.index=index;
    }
    return [...this.index.values()].filter(row=>row.text.includes(query.toLocaleLowerCase())).map(row=>row.summary).sort((a,b)=>b.updatedAt-a.updatedAt).slice(offset,offset+limit);
  }
  async remove(id:string):Promise<void>{await this.migration;await this.queue;await unlink(this.file(id));this.index?.delete(id);}
}
