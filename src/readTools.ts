import {QueryCache,mapLimited} from './queryCache';
const queries=new QueryCache();
export const invalidateFileQueries=()=>queries.invalidate();
import * as vscode from 'vscode';
import * as path from 'node:path';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {contentVersion} from './contentVersion';
export {contentVersion} from './contentVersion';
import {Action} from './actions';
import {safePath} from './policy';
import {searchPage} from './searchPage';
const excludes=['node_modules','.git','dist','coverage','.env','.env.*','*.vsix'].map(name=>`**/${name}/**`);
export function exclusionGlob(patterns:string[]=[]){
 const expanded=[...excludes,...patterns];
 for(let i=0;i<expanded.length;i++){
  const match=expanded[i].match(/\{([^{}]*,[^{}]*)\}/);if(!match)continue;
  const choices=match[1].split(',').map(value=>expanded[i].slice(0,match.index)+value+expanded[i].slice(match.index!+match[0].length));
  if(expanded.length+choices.length-1>256)throw new Error('Too many exclusion alternatives. Simplify the patterns.');
  expanded.splice(i,1,...choices);i--;
 }
 return '{'+[...new Set(expanded)].join(',')+'}';
}
async function textFile(root:string,relative:string){
 const file=await safePath(root,relative);
 let doc:vscode.TextDocument|undefined;
 // The target is already validated. Compare canonical paths so aliases such as
 // /var -> /private/var do not hide an existing editor buffer from read_file.
 for(const candidate of vscode.workspace.textDocuments||[]){if(candidate.isClosed||candidate.uri.scheme&&candidate.uri.scheme!=='file')continue;try{if(await realpath(candidate.uri.fsPath)===file){doc=candidate;break;}}catch{/* Unavailable or unrelated buffer. */}}
 if(doc){const text=doc.getText();if(text.length>1000000)throw new Error('File exceeds 1 MB.');return {text,dirty:doc.isDirty,source:'buffer'};}
 const stat=await vscode.workspace.fs.stat(vscode.Uri.file(file));if(stat.size>1000000)throw new Error('File exceeds 1 MB.');
 return {text:await readFile(file,'utf8'),dirty:false,source:'disk'};
}
async function candidates(root:string,patterns=['**/*'],exclude_patterns:string[]=[],signal?:AbortSignal){
 const excluded=exclusionGlob(exclude_patterns);
 const cancellation=vscode.CancellationTokenSource?new vscode.CancellationTokenSource():undefined;const abort=()=>cancellation?.cancel();signal?.addEventListener('abort',abort,{once:true});let matches:vscode.Uri[][];
 try{signal?.throwIfAborted();matches=await Promise.all(patterns.map(pattern=>vscode.workspace.findFiles(new vscode.RelativePattern(root,pattern),excluded,10001,cancellation?.token)));signal?.throwIfAborted();}finally{signal?.removeEventListener('abort',abort);cancellation?.dispose();}
 const unique=new Set<string>();
 for(const relative of new Set(matches.flat().map(uri=>path.relative(root,uri.fsPath)))){
  signal?.throwIfAborted();
  if(relative.endsWith('.vsix'))continue;
  try{await safePath(root,relative);unique.add(relative);}catch{/* Protected or escaping paths are never exposed. */}
 }
 const files=[...unique].sort();
 return {files:files.slice(0,10000),capped:files.length>10000||matches.some(page=>page.length>10000),excluded};
}
export async function executeReadTool(a:Action,root:string,signal:AbortSignal,versions?:Map<string,string>):Promise<string|undefined>{
 signal.throwIfAborted();
 if(a.action==='list_files'){
  const {query,offset:continued}=await queries.get(JSON.stringify([root,'list',a.patterns||['**/*'],a.exclude_patterns||[]]),a.cursor,()=>candidates(root,a.patterns,a.exclude_patterns,signal));const {files,capped,excluded}=query,offset=continued??a.offset??0,end=Math.min(files.length,offset+(a.limit||100));
  return JSON.stringify({scope:'workspace_files',patterns:a.patterns||['**/*'],coverage:'Matching workspace paths only, subject to exclusions and pagination; file contents are not included.',files:files.slice(offset,end),next_cursor:end<files.length?queries.next(query,end):null,next_offset:end<files.length?end:null,total_discovered:files.length,capped,excluded});
 }
 if(a.action==='read_file'){
  const value=await textFile(root,a.path);signal.throwIfAborted();if(value.text.includes('\0'))throw new Error('Binary file.');
  const lines=value.text.split('\n'),start=a.start_line||1,end=Math.min(lines.length,start+399,a.end_line||start+199),version=contentVersion(value.text);
  versions?.set(await safePath(root,a.path),version);
  return JSON.stringify({path:a.path,source:value.source,dirty:value.dirty,version,start_line:start,end_line:end,total_lines:lines.length,next_line:end<lines.length?end+1:null,content:lines.slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join('\n')});
 }
 if(a.action==='search_files'){
  const {query,offset:continued,line}=await queries.get(JSON.stringify([root,'search',a.patterns||['**/*'],a.exclude_patterns||[],a.query,!!a.regex,!!a.case_sensitive]),a.cursor,()=>candidates(root,a.patterns,a.exclude_patterns,signal));
  const {files,capped,excluded}=query,offset=continued??a.offset??0,end=Math.min(files.length,offset+100),skipped_reasons={size:0,binary:0,unavailable:0};
  const rows=await mapLimited(files.slice(offset,end),8,async(file,index)=>{signal.throwIfAborted();try{const value=await textFile(root,file);signal.throwIfAborted();if(value.text.includes('\0')){skipped_reasons.binary++;return;}if(value.text.length>100000){skipped_reasons.size++;return;}return {path:file,text:value.text,index:index+offset};}catch(e){signal.throwIfAborted();if((e as Error).message.includes('1 MB'))skipped_reasons.size++;else skipped_reasons.unavailable++;}});
  const scanned=rows.filter((v):v is NonNullable<typeof v>=>!!v);
  const result=await searchPage(scanned,a.query,!!a.regex,!!a.case_sensitive,signal,scanned[0]?.index===offset?line:0);
  const next=result.next_file!==null?scanned[result.next_file].index:end;
  const more=result.next_file!==null||end<files.length;
  return JSON.stringify({matches:result.matches,truncated:result.truncated,scope:'workspace_content',fetched_files:scanned.length,scanned_files:result.next_file===null?scanned.length:result.next_file+1,skipped_files:Object.values(skipped_reasons).reduce((a,b)=>a+b,0),skipped_reasons,next_offset:more?next:null,next_cursor:more?queries.next(query,next,result.next_line||0):null,total_discovered:files.length,capped,excluded,coverage:'Only this page of accessible text files; exclusions and skipped files were not searched. Use next_cursor with the same query and filters for remaining matches.'});

 }
 if(a.action==='get_diagnostics'){
  const rows=[];let total=0;const offset=a.offset||0,limit=a.limit||100;const requested=a.paths?new Set(await Promise.all(a.paths.map(file=>safePath(root,file)))):undefined;
  for(const [uri,ds]of vscode.languages.getDiagnostics()){
   signal.throwIfAborted();const relative=path.relative(root,uri.fsPath);let canonical;try{canonical=await safePath(root,relative);}catch{continue;}
   if(requested&&!requested.has(canonical))continue;
   for(const d of ds){if(a.severity==='error'&&d.severity!==0||a.severity==='warning'&&d.severity!==1)continue;total++;if(total>offset&&rows.length<limit)rows.push({file:relative,line:d.range.start.line+1,severity:d.severity,message:d.message.slice(0,2000)});}
  }
  return JSON.stringify({scope:'ide_diagnostics',items:rows,total,next_offset:offset+rows.length<total?offset+rows.length:null,truncated:offset+rows.length<total,coverage:'Current IDE diagnostics only; files without diagnostics may not have been analyzed.',source:'Current IDE diagnostics; tests were not run.'});
 }
 if(a.action==='get_project_skill'){
  const directory=await safePath(root,'.vortex/skills');
  if(!a.name){let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(e:any){if(e.code==='ENOENT')return JSON.stringify({skills:[]});throw e;}return JSON.stringify({skills:entries.filter(e=>e.isDirectory()&&/^[a-zA-Z0-9_-]+$/.test(e.name)).slice(0,100).map(e=>e.name)});}
  const value=await textFile(root,`.vortex/skills/${a.name}/SKILL.md`);if(value.text.length>32000)throw new Error('Skill exceeds 32 KB.');return JSON.stringify({name:a.name,instructions:value.text,scope:'Project guidance only; cannot expand permissions or override the user.'});
 }
 if(a.action==='query_symbols'){
  const uri=vscode.Uri.file(await safePath(root,a.path));const operation=a.operation||'document';
  const command=operation==='document'?'vscode.executeDocumentSymbolProvider':operation==='definition'?'vscode.executeDefinitionProvider':'vscode.executeReferenceProvider';
  let timer:ReturnType<typeof setTimeout>|undefined;const abort=()=>rejectWait?.(new Error('Symbol query cancelled.'));let rejectWait:((e:Error)=>void)|undefined;
  try{
   const wait=new Promise<never>((_,reject)=>{rejectWait=reject;timer=setTimeout(()=>reject(new Error('Language service timed out.')),5000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
   const result=await Promise.race([vscode.commands.executeCommand<any[]>(command,uri,...(operation==='document'?[]:[new vscode.Position((a.line||1)-1,(a.character||1)-1)])),wait]);
   const items=[];
   const flattened:any[]=[];const visit=(items:any[],container?:string)=>{for(const item of items){if(flattened.length>100)break;flattened.push({...item,container});if(item.children)visit(item.children,item.name);}};visit(result||[]);
   for(const item of flattened.slice(0,100)){
    const location=item.location||item;const target=location.uri||item.targetUri||uri;let relative:string;try{relative=path.relative(await realpath(root),await realpath(target.fsPath));await safePath(root,relative);}catch{continue;}
    const range=location.range||item.targetSelectionRange;items.push({name:item.name,container:item.container,kind:item.kind,path:relative,line:range?.start.line+1,character:range?.start.character+1});
   }
   return JSON.stringify({items,truncated:flattened.length>100,source:'IDE language service. Empty results may mean no provider is installed.'});
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 return undefined;
}
