import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import * as path from 'node:path';
const maximum=64*1024*1024;
const validId=(id:string)=>/^[a-f0-9-]{36}$/.test(id);
export class ToolOutputs {
 private values=new Map<string,string>();private size=0;private dirty=false;private written=new Set<string>();
 constructor(private directory?:string){}
 async restore(){
  if(!this.directory)return;
  let ids:unknown;try{ids=JSON.parse(await readFile(path.join(this.directory,'index.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw new Error('Saved tool outputs could not be loaded.');}
  if(!Array.isArray(ids)||!ids.every(id=>typeof id==='string'&&validId(id)))throw new Error('Invalid saved tool output index.');
  for(const id of ids){try{const text=await readFile(path.join(this.directory,id+'.txt'),'utf8'),bytes=Buffer.byteLength(text);if(this.size+bytes>maximum)break;this.values.set(id,text);this.written.add(id);this.size+=bytes;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 }
 async flush(){
  if(!this.directory||!this.dirty)return;await mkdir(this.directory,{recursive:true});
  for(const [id,text]of this.values)if(!this.written.has(id)){await writeFile(path.join(this.directory,id+'.txt'),text,{mode:0o600});this.written.add(id);}
  const file=path.join(this.directory,'index.json'),temp=file+'.tmp-'+randomUUID();
  try{await writeFile(temp,JSON.stringify([...this.values.keys()]),{mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}
  for(const id of this.written)if(!this.values.has(id)){await rm(path.join(this.directory,id+'.txt'),{force:true});this.written.delete(id);}
  this.dirty=false;
 }
 preserve(value:string,limit:number){
  if(value.length<=limit)return value;
  if(value.length>8_000_000)return JSON.stringify({preview:value.slice(0,limit),truncated:true,instruction:'Result exceeds retention limit. Narrow the original query.'});
  const bytes=Buffer.byteLength(value);
  while(this.size+bytes>maximum&&this.values.size){const id=this.values.keys().next().value!;this.size-=Buffer.byteLength(this.values.get(id)!);this.values.delete(id);}
  const id=randomUUID();this.values.set(id,value);this.size+=bytes;this.dirty=true;
  return JSON.stringify({preview:value.slice(0,limit),truncated:true,output_id:id,next_offset:limit,total_characters:value.length,instruction:'Use read_tool_output with output_id and next_offset as offset. Retained pages are available across session restarts; older pages may expire when storage reaches its limit.'});
 }
 full(id:string){const value=this.values.get(id);if(value===undefined)throw new Error('Output expired or was not retained. The displayed preview is partial.');return value;}
 read(id:string,offset=0,limit=2000){
  const value=this.values.get(id);if(value===undefined)throw new Error('Output expired or unavailable. The preview was partial. Run a narrower original query.');
  const end=Math.min(value.length,offset+limit);
  return JSON.stringify({text:value.slice(offset,end),next_offset:end<value.length?end:null,total_characters:value.length});
 }
}
