import {readFile,stat} from 'node:fs/promises';
import {safePath} from './policy';

export interface FileSnapshot {path:string; content:string|null}
export async function snapshotFile(root:string,relative:string):Promise<FileSnapshot>{
  const path=await safePath(root,relative);
  try{const info=await stat(path);if(!info.isFile()||info.size>1000000)throw new Error('The target must be a regular file of at most 1 MB.');return {path,content:await readFile(path,'utf8')};}
  catch(error:any){if(error.code==='ENOENT')return {path,content:null};throw error;}
}
export async function verifySnapshot(root:string,relative:string,expected:FileSnapshot):Promise<void>{
  const current=await snapshotFile(root,relative);
  if(current.path!==expected.path||current.content!==expected.content)throw new Error('The file changed while the edit was being prepared or approved. Read it again before editing.');
}
