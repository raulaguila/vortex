import * as vscode from 'vscode';
import * as path from 'node:path';
import {readFile} from 'node:fs/promises';
import {Action} from './actions';
import {safePath} from './policy';
export async function executeReadTool(a:Action,root:string,signal:AbortSignal):Promise<string|undefined>{
    if(a.action==='list'){const files=await vscode.workspace.findFiles(new vscode.RelativePattern(root,typeof a.pattern==='string'?a.pattern:'**/*'),'**/{node_modules,.git,dist,.env,.env.*}/**',500);return files.map(f=>path.relative(root,f.fsPath)).filter(f=>!f.split('/').some(s=>s==='.env'||s.startsWith('.env.'))).join('\n');}
    if(a.action==='diagnostics'){
      const rows=[];
      for(const [uri,ds]of vscode.languages.getDiagnostics()){
        signal.throwIfAborted();const relative=path.relative(root,uri.fsPath);
        try{await safePath(root,relative);}catch{continue;}
        rows.push({file:relative,items:ds.map(d=>({line:d.range.start.line+1,message:d.message}))});
      }
      return JSON.stringify(rows).slice(0,24000);
    }
    if(a.action==='read'){
      const file=await safePath(root,a.path);const stat=await vscode.workspace.fs.stat(vscode.Uri.file(file));if(stat.size>1000000)throw new Error('File exceeds 1 MB.');
      const text=await readFile(file,'utf8');const start=Math.max(1,Number(a.startLine)||1),end=Math.min(start+399,Number(a.endLine)||start+199);
      return text.split('\n').slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join('\n');
    }
    if(a.action==='search'){
      if(typeof a.query!=='string'||!a.query||a.query.length>300)throw new Error('Invalid search query.');
      const files=await vscode.workspace.findFiles(new vscode.RelativePattern(root,typeof a.pattern==='string'?a.pattern:'**/*'),'**/{node_modules,.git,dist}/**',300);const hits:string[]=[];
      for(const uri of files){signal.throwIfAborted();try{const relative=path.relative(root,uri.fsPath);const file=await safePath(root,relative);const stat=await vscode.workspace.fs.stat(uri);if(stat.size>100000)continue;const text=await readFile(file,'utf8');if(text.includes('\0'))continue;for(const [i,line] of text.split('\n').entries())if(line.includes(a.query)){hits.push(`${relative}:${i+1}: ${line.slice(0,300)}`);if(hits.length>=80)return hits.join('\n');}}catch{}}
      return hits.join('\n')||'No matches.';
    }
  return undefined;
}
