import * as path from 'node:path';
import {realpath} from 'node:fs/promises';
export type Mode='ask'|'plan'|'agent';
export type Permission='supervised'|'autonomous';
export function isMode(value:unknown):value is Mode {return typeof value==='string'&&['ask','plan','agent'].includes(value);}
export function isPermission(value:unknown):value is Permission {return typeof value==='string'&&['supervised','autonomous'].includes(value);}
// Migrate only persisted sessions; live messages must use the explicit protocol.
export function migratePolicy(mode:unknown,permission:unknown):{mode:Mode;permission:Permission} {
  return {mode:isMode(mode)?mode:mode==='supervised'||mode==='autonomous'?'agent':'ask',permission:isPermission(permission)?permission:mode==='autonomous'?'autonomous':'supervised'};
}
export function canWrite(mode:Mode):boolean { return mode==='agent'; }
export async function safePath(root:string, relative:string):Promise<string> {
  const protectedPath=(value:string)=>value.split(/[\\/]/).some(p=>['..','.git','.env'].includes(p)||p.startsWith('.env.'));
  if(!relative || path.isAbsolute(relative) || protectedPath(relative)) throw new Error('Caminho protegido ou fora do workspace.');
  const base=await realpath(root); const target=path.resolve(base,relative);
  let existing=target;
  while(true) { try {
    const resolved=await realpath(existing);
    if(resolved!==base&&!resolved.startsWith(base+path.sep))throw new Error('Links fora do workspace não são permitidos.');
    const canonical=path.resolve(resolved,path.relative(existing,target));
    if(!canonical.startsWith(base+path.sep)||protectedPath(path.relative(base,canonical)))throw new Error('Caminho protegido ou fora do workspace.');
    return canonical;
  } catch(e:any) { if(e.code!=='ENOENT') throw e; const parent=path.dirname(existing); if(parent===existing) throw e; existing=parent; } }
}
