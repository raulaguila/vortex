import {acquireSessionLock,sessionLockActive} from './sessionLock';
import {mkdir,readFile,readdir,writeFile,rename,unlink,stat,rm} from 'node:fs/promises';
import * as path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AgentEvent,ChecklistItem,ModelRef,SessionSummary,isModelRef} from './protocol';
import {Mode,Permission,migratePolicy} from './policy';
import {Message} from './providers';
export interface Session extends SessionSummary {revision?:number;summary?:{text:string;through:number};root?:string;version?:number;runState?:'running'|'paused'|'complete'|'error';pendingTool?:{name:string;path?:string}; events:AgentEvent[]; messages:Message[]; checklist:ChecklistItem[]; mode:Mode; permission:Permission; model:ModelRef }
export class SessionStore {
  private index?:Map<string,{summary:SessionSummary;text:string}>;
  private queue:Promise<unknown>=Promise.resolve();
  private stamp='';
  private held=new Map<string,()=>Promise<void>>();
  async begin(session:Session){await this.migration;if(this.held.has(session.id))throw new Error('Session is already running.');const release=await acquireSessionLock(this.file(session.id)+'.lock');try{const saved=await this.currentRevision(session.id);if(saved!==(session.revision||0))throw new Error('Session changed in another window. Reload it before continuing.');this.held.set(session.id,release);return async()=>{this.held.delete(session.id);await release();};}catch(e){await release();throw e;}}
  async isActive(id:string){return sessionLockActive(this.file(id)+'.lock');}
  private async currentRevision(id:string){try{return JSON.parse(await readFile(this.file(id),'utf8')).revision||0;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e;}}
  private migration:Promise<void>;
  constructor(private directory:string,legacyDirectory?:string,legacyRoot?:string,private dataRoot?:string,private tracePath?:string){this.migration=legacyDirectory&&legacyDirectory!==directory?this.migrate(legacyDirectory,legacyRoot):Promise.resolve();}
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
    const copy=structuredClone(session),file=this.file(session.id);
    const work=this.queue.then(async()=>{
     await this.migration;const release=this.held.has(session.id)?undefined:await acquireSessionLock(file+'.lock');
     try{const revision=await this.currentRevision(session.id);if(revision!==(session.revision||0))throw new Error('Session changed in another window. Reload it before saving.');
      const snapshot={...copy,version:4,revision:revision+1,updatedAt:Date.now()};await mkdir(this.directory,{recursive:true});const temp=file+'.tmp-'+randomUUID();
      try{await writeFile(temp,JSON.stringify(snapshot),{mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}
      session.revision=snapshot.revision;session.updatedAt=snapshot.updatedAt;this.index=undefined;
     }finally{await release?.();}
    });this.queue=work.catch(()=>undefined);return work;
  }
  async load(id:string):Promise<Session>{
    await this.migration;await this.queue;const session=JSON.parse(await readFile(this.file(id),'utf8'));
    const strings=(row:any)=>row&&typeof row.content==='string'&&['user','assistant'].includes(row.role);
    if(!session||session.id!==id||typeof session.title!=='string'||!Number.isFinite(session.updatedAt)||!isModelRef(session.model)
      ||!Array.isArray(session.messages)||!session.messages.every(strings)
      ||!Array.isArray(session.events)||!session.events.every((e:any)=>e&&['user','assistant','activity'].includes(e.role)&&typeof e.text==='string')
      ||!Array.isArray(session.checklist)||!session.checklist.every((i:any)=>i&&typeof i.id==='string'&&typeof i.text==='string'&&['pending','running','done'].includes(i.status)))throw new Error('This session is damaged and cannot be opened. Other sessions are unchanged.');
    if(session.events.some((e:any)=>e.activity!==undefined&&(!e.activity||typeof e.activity.id!=='string'||typeof e.activity.runId!=='string'||typeof e.activity.name!=='string'||typeof e.activity.output!=='string'||!['success','error','denied','recovered','cancelled','uncertain'].includes(e.activity.status)||!Number.isFinite(e.activity.startedAt)||!Number.isFinite(e.activity.endedAt)||e.activity.path!==undefined&&typeof e.activity.path!=='string')))throw new Error('This session contains invalid activity data.');
    if(session.root!==undefined&&typeof session.root!=='string'||session.summary!==undefined&&(!session.summary||typeof session.summary.text!=='string'||!Number.isSafeInteger(session.summary.through)||session.summary.through<0||session.summary.through>session.messages.length))throw new Error('This session contains invalid continuation metadata.');
    if(session.revision!==undefined&&(!Number.isSafeInteger(session.revision)||session.revision<0))throw new Error('Invalid session revision.');
    if(session.runState==='running'&&!await this.isActive(id))session.runState='paused';
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
  async recoverDeletions(){await this.migration;let files:string[];try{files=await readdir(this.directory);}catch{return;}for(const file of files.filter(f=>/^[a-f0-9-]{36}\.deleting$/.test(f)))try{await this.remove(file.slice(0,36));}catch{/* Live leases and recovery failures remain visible for the next attempt. */}}
  async remove(id:string):Promise<void>{
   await this.migration;await this.queue;if(this.held.has(id))throw new Error('Session is running.');
   const file=this.file(id),release=await acquireSessionLock(file+'.lock');
   try{
    let saved:Session|undefined;try{saved=await this.load(id);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(saved?.pendingTool)throw new Error('Review this interrupted task before deleting its recovery data.');
    await writeFile(path.join(this.directory,id+'.deleting'),'1',{mode:0o600});
    if(this.dataRoot){await rm(path.join(this.dataRoot,'changes',id+'.changes.json'),{force:true});await rm(path.join(this.dataRoot,'artifacts',id),{recursive:true,force:true});}
    if(this.tracePath)try{const trace=JSON.parse(await readFile(this.tracePath,'utf8'));if(trace.conversation_id===id)await rm(this.tracePath,{force:true});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    await rm(file,{force:true});await rm(path.join(this.directory,id+'.deleting'),{force:true});this.index?.delete(id);
   }finally{await release();}
  }
  async cleanup(days:number,manual=false){if(!days&&!manual)return 0;const rows=await this.list('',0,Number.MAX_SAFE_INTEGER);let removed=0;for(const row of rows){const session=await this.load(row.id);if(session.runState==='complete'&&!session.pendingTool&&Date.now()-session.updatedAt>days*86400000)try{await this.remove(row.id);removed++;}catch{/* An active session is never removed. */}}return removed;}
  async storageInfo(){await this.migration;let bytes=0;const walk=async(dir:string)=>{let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}for(const entry of entries){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())bytes+=(await stat(file)).size;}};await walk(this.directory);if(this.dataRoot)for(const name of ['changes','artifacts'])await walk(path.join(this.dataRoot,name));return {bytes,sessions:(await this.list('',0,Number.MAX_SAFE_INTEGER)).length};}
}
