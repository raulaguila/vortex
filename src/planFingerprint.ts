import {createHash} from 'node:crypto';
import {readdir,readFile,lstat} from 'node:fs/promises';
import * as path from 'node:path';
import {isContextProtected} from './exclusions';
// Deliberately bounded. Unknown coverage requires review instead of a false verification.
export async function planFingerprint(root:string):Promise<string|null>{
 const hash=createHash('sha256');let bytes=0,count=0;
 async function walk(relative:string){for(const entry of (await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(isContextProtected(entry.name)||entry.name==='.env'||entry.name.startsWith('.env.')||/\.(pem|key|p12|pfx)$/i.test(entry.name))continue;
  const name=path.join(relative,entry.name),file=path.join(root,name),info=await lstat(file);
  if(info.isSymbolicLink())throw new Error('Unverifiable link');if(info.isDirectory()){await walk(name);continue;}
  if(!info.isFile()||++count>10000||info.size>2*1024*1024||(bytes+=info.size)>50*1024*1024)throw new Error('Fingerprint budget exceeded');
  const content=await readFile(file);hash.update(JSON.stringify([name,content.length]));hash.update(content);
 }}
 try{await walk('');return hash.digest('hex');}catch{return null;}
}
