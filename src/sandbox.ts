import {planFingerprint} from './planFingerprint';
import {ExecutionError} from './execution';
import {mkdtemp,readdir,readFile,mkdir,writeFile,rm,lstat} from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {safePath} from './policy';
import {runCommand} from './command';
const excluded=new Set(['.git','.vortex','node_modules','dist','build','.next','.ssh','.aws','.codex','.agents']);
const protectedName=(name:string)=>excluded.has(name)||name==='.env'||name.startsWith('.env.')||/\.(pem|key|p12|pfx)$/i.test(name);
export async function snapshotTree(root:string):Promise<Map<string,string>>{
 const files=new Map<string,string>();let bytes=0;
 async function walk(relative:string){for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){
  if(protectedName(entry.name))continue;const name=path.join(relative,entry.name),file=path.join(root,name);const info=await lstat(file);
  if(info.isSymbolicLink())continue;
  if(info.isDirectory()){await walk(name);continue;}if(!info.isFile())continue;
  if(info.size>1000000)continue;const buffer=await readFile(file);if(buffer.includes(0))continue;
  bytes+=buffer.length;if(bytes>50*1024*1024||files.size>=10000)throw new Error('Sandbox snapshot exceeds 50 MB or 10,000 text files. Narrow the workspace.');files.set(name,buffer.toString('utf8'));
 }}await walk('');return files;
}
export const shellQuote=(value:string)=>"'"+value.replace(/'/g,"'\"'\"'")+"'";
async function removeContainer(name:string):Promise<boolean>{return new Promise(resolve=>execFile('docker',['rm','-f',name],{timeout:10000},error=>{if(!error){resolve(true);return;}execFile('docker',['ps','-aq','--filter','name='+name],{timeout:5000},(error,stdout)=>resolve(!error&&!stdout.trim()));}));}
export class Sandbox {
 constructor(private artifactsDirectory?:string){}
 private directory?:string;
 private leaseFile?:string;
 private cleanupFailed=false;
 private previous=new Map<string,string>();
 static async recover(artifactsRoot:string){
  let entries:string[];try{entries=await readdir(artifactsRoot);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  for(const entry of entries.filter(e=>/^[a-f0-9-]{36}$/.test(e))){
   const leaseFiles=(await readdir(path.join(artifactsRoot,entry))).filter(name=>/^lease(?:-vortex-[a-f0-9-]{36})?\.json$/.test(name));
   for(const leaseName of leaseFiles){const file=path.join(artifactsRoot,entry,leaseName);let lease;try{lease=JSON.parse(await readFile(file,'utf8'));}catch{continue;}
   if(!Number.isSafeInteger(lease.pid)||lease.pid<=0||typeof lease.name!=='string'||!/^vortex-[a-f0-9-]{36}$/.test(lease.name)||typeof lease.directory!=='string'||path.dirname(lease.directory)!==os.tmpdir()||!/^vortex-sandbox-[a-zA-Z0-9]+$/.test(path.basename(lease.directory)))continue;
   try{process.kill(lease.pid,0);continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')continue;}
   const removed=await removeContainer(lease.name);if(!removed)continue;
   await rm(lease.directory,{recursive:true,force:true});await rm(file,{force:true});
   }
  }
 }
 async available(image?:string){if(process.platform==='win32')return false;const running=await new Promise<boolean>(resolve=>execFile('docker',['info','--format','{{.ServerVersion}}'],{timeout:5000},error=>resolve(!error)));if(!running||!image)return running;return new Promise<boolean>(resolve=>execFile('docker',['image','inspect','--format','{{.Id}}',image],{timeout:5000},(error,stdout)=>resolve(!error&&/^sha256:[a-f0-9]{64}$/.test(stdout.trim()))));}
 async dispose(){if(this.cleanupFailed)return;if(this.leaseFile)await rm(this.leaseFile,{force:true});if(this.directory)await rm(this.directory,{recursive:true,force:true});this.directory=undefined;}
 async execute(root:string,command:string,signal:AbortSignal,timeout:number,network=false,image='node:22-bookworm-slim',onOutput?:(stream:'stdout'|'stderr',text:string)=>void){
  image=await new Promise<string>((resolve,reject)=>execFile('docker',['image','inspect','--format','{{.Id}}',image],{timeout:10000},(error,stdout)=>!error&&/^sha256:[a-f0-9]{64}$/.test(stdout.trim())?resolve(stdout.trim()):reject(new Error('Sandbox image is not available locally. Use Download sandbox image in settings.'))));
  if(this.cleanupFailed)throw new Error('Sandbox cleanup failed. Stop this task and check Docker.');
  if(!this.directory)this.directory=await mkdtemp(path.join(os.tmpdir(),'vortex-sandbox-'));
  const before=await snapshotTree(root);
  for(const file of this.previous.keys())if(!before.has(file))await rm(path.join(this.directory,file),{force:true});
  for(const [file,content]of before){const dest=await safePath(this.directory,file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,content);}
  this.previous=before;const testedBefore=await planFingerprint(this.directory);
  const name='vortex-'+randomUUID();const args=['run','--rm','--name',name,'--pull','never','--network',network?'bridge':'none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','2g','--cpus','2','--user',`${process.getuid?.()||1000}:${process.getgid?.()||1000}`,'--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--env','HOME=/tmp','--mount',`type=bind,src=${this.directory},dst=/workspace`,'--workdir','/workspace',image,'sh','-lc',command];
  if(this.artifactsDirectory){await mkdir(this.artifactsDirectory,{recursive:true});this.leaseFile=path.join(this.artifactsDirectory,'lease-'+name+'.json');await writeFile(this.leaseFile,JSON.stringify({name,directory:this.directory,pid:process.pid}),{mode:0o600});}
  let output='',error:string|undefined,failure:Error|undefined;
  try{output=await runCommand(['docker',...args.map(shellQuote)].join(' '),root,signal,timeout,1024*1024,onOutput);}catch(e){failure=e instanceof Error?e:new Error(String(e));error=failure.message;}
  finally{this.cleanupFailed=!await removeContainer(name);if(!this.cleanupFailed&&this.leaseFile){await rm(this.leaseFile,{force:true});this.leaseFile=undefined;}}

  if(this.cleanupFailed)throw new ExecutionError('uncertain_outcome','Could not confirm container cleanup. Recovery information was retained.');
  const after=await snapshotTree(this.directory);
  const changes:{path:string;before:string|null;after:string|null}[]=[];
  for(const file of new Set([...before.keys(),...after.keys()])){
    if(before.get(file)===after.get(file))continue;
    if(!after.has(file)){try{const target=await safePath(this.directory,file);await lstat(target);continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')continue;}}
    changes.push({path:file,before:before.get(file)??null,after:after.get(file)??null});
  }
  const artifacts:string[]=[];
  if(this.artifactsDirectory){
    const destination=path.join(this.artifactsDirectory,randomUUID());let total=0;
    const walk=async(relative:string)=>{for(const entry of await readdir(path.join(this.directory!,relative),{withFileTypes:true})){
      if(protectedName(entry.name))continue;const file=path.join(relative,entry.name),source=path.join(this.directory!,file);const info=await lstat(source);
      if(info.isSymbolicLink())continue;if(info.isDirectory()){await walk(file);continue;}if(!info.isFile()||info.size>10*1024*1024||total+info.size>50*1024*1024)continue;
      const bytes=await readFile(source);if(!bytes.includes(0)&&info.size<=1000000)continue;
      total+=bytes.length;const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{mode:0o600});artifacts.push(target);
    }};await walk('');
  }
  const testedAfter=await planFingerprint(this.directory);
  return {output,error,failure,changes,artifacts,testedFingerprint:testedBefore&&testedBefore===testedAfter?testedAfter:null};
 }
}
