import { randomUUID } from 'node:crypto';
import { mkdir,readdir,readFile,rmdir,unlink,writeFile } from 'node:fs/promises';
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
  try{await mkdir(directory,{mode:0o700});}
  catch(e){
   if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   const previous=await owner(directory);
   if(alive(previous.pid))throw new Error('This session is active in another window. Reload it after that execution finishes.');
   // Unlinking this unique owner's file elects one reclaimer. A loser must never remove the directory.
   await unlink(previous.file);await rmdir(directory);continue;
  }
  try{await writeFile(file,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});}
  catch(e){await rmdir(directory).catch(()=>{});throw e;}
  return async()=>{await unlink(file);await rmdir(directory);};
 }
 throw new Error('Could not acquire session lock. Reload and try again.');
}
