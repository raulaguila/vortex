import {open,rename,rm,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function syncDirectory(path:string){
 if(process.platform==='win32')return;
 const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}
}
export async function durableWrite(file:string,text:string){
 await mkdir(dirname(file),{recursive:true});const temporary=file+'.tmp-'+randomUUID();
 try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}await rename(temporary,file);await syncDirectory(dirname(file));}
 finally{await rm(temporary,{force:true});}
}
