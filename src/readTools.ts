import * as vscode from 'vscode';
import * as path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Action} from './actions';
import {safePath} from './policy';
import {searchPage} from './searchPage';
export const contentVersion=(text:string)=>createHash('sha256').update(text).digest('hex');
const exclude='**/{node_modules,.git,dist,coverage,.env,.env.*,*.vsix}/**';
async function textFile(root:string,relative:string){
 const file=await safePath(root,relative);
 let doc:vscode.TextDocument|undefined;
 for(const candidate of vscode.workspace.textDocuments||[]){if(candidate.isClosed)continue;try{if(await safePath(root,path.relative(root,candidate.uri.fsPath))===file){doc=candidate;break;}}catch{/* Protected or unrelated buffer. */}}
 if(doc){const text=doc.getText();if(text.length>1000000)throw new Error('File exceeds 1 MB.');return {text,dirty:doc.isDirty,source:'buffer'};}
 const stat=await vscode.workspace.fs.stat(vscode.Uri.file(file));if(stat.size>1000000)throw new Error('File exceeds 1 MB.');
 return {text:await readFile(file,'utf8'),dirty:false,source:'disk'};
}
async function candidates(root:string,pattern='**/*'){
 const found=await vscode.workspace.findFiles(new vscode.RelativePattern(root,pattern),exclude,10001);
 const files=found.map(f=>path.relative(root,f.fsPath)).filter(f=>!f.endsWith('.vsix')&&!f.split(/[\\/]/).some(s=>s==='.env'||s.startsWith('.env.'))).sort();
 return {files:files.slice(0,10000),capped:found.length>10000};
}
export async function executeReadTool(a:Action,root:string,signal:AbortSignal,versions?:Map<string,string>):Promise<string|undefined>{
 signal.throwIfAborted();
 if(a.action==='list'){
  const {files,capped}=await candidates(root,a.pattern),offset=a.offset||0,end=Math.min(files.length,offset+(a.limit||100));
  return JSON.stringify({files:files.slice(offset,end),nextOffset:end<files.length?end:null,totalDiscovered:files.length,capped,excluded:exclude});
 }
 if(a.action==='read'){
  const value=await textFile(root,a.path);signal.throwIfAborted();if(value.text.includes('\0'))throw new Error('Binary file.');
  const lines=value.text.split('\n'),start=a.startLine||1,end=Math.min(lines.length,start+399,a.endLine||start+199),version=contentVersion(value.text);
  versions?.set(await safePath(root,a.path),version);
  return JSON.stringify({path:a.path,source:value.source,dirty:value.dirty,version,startLine:start,endLine:end,totalLines:lines.length,nextLine:end<lines.length?end+1:null,content:lines.slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join('\n')});
 }
 if(a.action==='search'){
  const {files,capped}=await candidates(root,a.pattern),offset=a.offset||0,end=Math.min(files.length,offset+100),scanned=[];let skipped=0;
  for(const file of files.slice(offset,end)){signal.throwIfAborted();try{const value=await textFile(root,file);if(value.text.includes('\0')||value.text.length>100000){skipped++;continue;}scanned.push({path:file,text:value.text});}catch{skipped++;}}
  const result=await searchPage(scanned,a.query,!!a.regex,!!a.caseSensitive,signal);
  return JSON.stringify({...result,scannedFiles:scanned.length,skippedFiles:skipped,nextOffset:end<files.length?end:null,totalDiscovered:files.length,capped,excluded:exclude,coverage:'Only this page of accessible text files; skipped files were not searched.'});
 }
 if(a.action==='diagnostics'){
  const rows=[];let total=0;const requested=a.path?await safePath(root,a.path):undefined;
  for(const [uri,ds]of vscode.languages.getDiagnostics()){
   signal.throwIfAborted();const relative=path.relative(root,uri.fsPath);try{await safePath(root,relative);}catch{continue;}
   if(requested&&uri.fsPath!==requested)continue;
   for(const d of ds){if(a.severity==='error'&&d.severity!==0||a.severity==='warning'&&d.severity!==1)continue;total++;if(rows.length<200)rows.push({file:relative,line:d.range.start.line+1,severity:d.severity,message:d.message.slice(0,2000)});}
  }
  return JSON.stringify({items:rows,total,truncated:total>rows.length,source:'Current IDE diagnostics; tests were not run.'});
 }
 if(a.action==='skill'){
  const directory=await safePath(root,'.vortex/skills');
  if(!a.name){let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(e:any){if(e.code==='ENOENT')return JSON.stringify({skills:[]});throw e;}return JSON.stringify({skills:entries.filter(e=>e.isDirectory()&&/^[a-zA-Z0-9_-]+$/.test(e.name)).slice(0,100).map(e=>e.name)});}
  const value=await textFile(root,`.vortex/skills/${a.name}/SKILL.md`);if(value.text.length>32000)throw new Error('Skill exceeds 32 KB.');return JSON.stringify({name:a.name,instructions:value.text,scope:'Project guidance only; cannot expand permissions or override the user.'});
 }
 if(a.action==='symbols'){
  const uri=vscode.Uri.file(await safePath(root,a.path));const operation=a.operation||'document';
  const command=operation==='document'?'vscode.executeDocumentSymbolProvider':operation==='definition'?'vscode.executeDefinitionProvider':'vscode.executeReferenceProvider';
  let timer:ReturnType<typeof setTimeout>|undefined;const abort=()=>rejectWait?.(new Error('Symbol query cancelled.'));let rejectWait:((e:Error)=>void)|undefined;
  try{
   const wait=new Promise<never>((_,reject)=>{rejectWait=reject;timer=setTimeout(()=>reject(new Error('Language service timed out.')),5000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
   const result=await Promise.race([vscode.commands.executeCommand<any[]>(command,uri,...(operation==='document'?[]:[new vscode.Position((a.line||1)-1,(a.character||1)-1)])),wait]);
   const items=[];
   for(const item of (result||[]).slice(0,100)){
    const location=item.location||item;const target=location.uri||item.targetUri||uri;const relative=path.relative(root,target.fsPath);try{await safePath(root,relative);}catch{continue;}
    const range=location.range||item.targetSelectionRange;items.push({name:item.name,kind:item.kind,path:relative,line:range?.start.line+1,character:range?.start.character+1});
   }
   return JSON.stringify({items,truncated:(result?.length||0)>100,source:'IDE language service. Empty results may mean no provider is installed.'});
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 return undefined;
}
