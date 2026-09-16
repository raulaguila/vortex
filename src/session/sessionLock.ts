import {durableWrite,syncDirectory} from "./durable";
import { randomUUID } from 'node:crypto';
import { mkdir,readdir,readFile,rmdir,unlink,rename,rm,stat } from 'node:fs/promises';
import { dirname,join } from 'node:path';
async function owner(directory:string){
 const entries=(await readdir(directory)).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name));
 if(entries.length!==1)throw new Error('Session lock is being initialized or requires manual recovery.');
 const file=join(directory,entries[0]),value=JSON.parse(await readFile(file,'utf8'));
 if(!Number.isSafeInteger(value.pid)||value.pid<=0)throw new Error('Invalid session lock.');
 return {file,pid:value.pid};
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
export async function sessionLockActive(directory:string){try{return alive((await owner(directory)).pid);}catch(e){return (e as NodeJS.ErrnoException).code!=='ENOENT';}}
export async function acquireSessionLock(directory:string):Promise<()=>Promise<void>>{
 await mkdir(dirname(directory),{recursive:true});const token=randomUUID(),file=join(directory,token+'.json');
 for(let attempt=0;attempt<2;attempt++){
  try{await stat(directory);const error=new Error('Lock exists') as NodeJS.ErrnoException;error.code='EEXIST';throw error;}
  catch(e){
   if((e as NodeJS.ErrnoException).code==='ENOENT'){
    const prepared=directory+'.prepared-'+token;await mkdir(prepared,{mode:0o700});
    try{await durableWrite(join(prepared,token+'.json'),JSON.stringify({pid:process.pid}));await rename(prepared,directory);await syncDirectory(dirname(directory));}
    catch(error){await rm(prepared,{recursive:true,force:true});throw new Error('Session lock changed while opening. Retry after the other operation finishes.');}
    return async()=>{await unlink(file);await rmdir(directory);};
   }
   if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   const previous=await owner(directory);
   if(alive(previous.pid))throw new Error('This session is active in another window. Reload it after that execution finishes.');
   // Unlinking this unique owner's file elects one reclaimer. A loser must never remove the directory.
   await unlink(previous.file);await rmdir(directory);continue;
  }

 }
 throw new Error('Could not acquire session lock. Reload and try again.');
}
