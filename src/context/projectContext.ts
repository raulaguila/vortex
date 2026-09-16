import {readFile,readdir,stat} from 'node:fs/promises';
import * as path from 'node:path';
import {safePath} from "../policy/policy";
export async function projectRules(root:string,files:string[]=[]):Promise<{path:string;text:string}[]>{
 const directories=new Set(['']);
 for(const file of files){let dir=path.dirname(file);while(dir!=='.'){directories.add(dir);const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}}
 const scoped=[...directories].filter(Boolean).sort((a,b)=>a.split(path.sep).length-b.split(path.sep).length).map(d=>path.join(d,'AGENTS.md'));
 const candidates=['AGENTS.md'];
 try{for(const entry of (await readdir(path.join(root,'.vortex/rules'))).sort())if(entry.endsWith('.md'))candidates.push(path.join('.vortex/rules',entry));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 candidates.push(...scoped);
 const rows=[];let total=0;
 for(const relative of candidates){try{const file=await safePath(root,relative);const info=await stat(file);if(info.size>32768)throw new Error('Project rule exceeds 32 KB: '+relative);const text=await readFile(file,'utf8');total+=Buffer.byteLength(text);if(total>65536)throw new Error('Project rules exceed 64 KB. Narrow the rules.');rows.push({path:relative,text});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 return rows;
}
