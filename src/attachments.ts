import * as vscode from 'vscode';
import {randomUUID} from 'node:crypto';
import * as path from 'node:path';
import {safePath} from './policy';
export interface Attachment {id:string;label:string;path?:string;text:string}
export class Attachments {
 private rows:Attachment[]=[];
 list(){return this.rows.map(({text,...row})=>row);}
 peek(){return this.rows.map(row=>({...row}));}
 consume(){const rows=this.rows;this.rows=[];return rows;}
 remove(id:string){this.rows=this.rows.filter(r=>r.id!==id);}
 async choose(uri?:vscode.Uri){
  const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;if(!root)throw new Error('Open a workspace first.');
  if(uri){const info=await vscode.workspace.fs.stat(uri);if(info.type===vscode.FileType.Directory){const files=await vscode.workspace.findFiles(new vscode.RelativePattern(uri,'**/*'),'**/{node_modules,.git,dist,.env,.env.*}/**',50);for(const file of files)await this.file(root,file);return;}return this.file(root,uri);}
  const choice=await vscode.window.showQuickPick(['File','Selection','Folder','Diagnostics'],{title:'Vortex — Add context'});
  if(!choice)return;
  if(choice==='Selection'){
   const editor=vscode.window.activeTextEditor;if(!editor||editor.selection.isEmpty)throw new Error('Select text in the editor first.');
   const relative=path.relative(root,editor.document.uri.fsPath);await safePath(root,relative);
   this.add({label:`${relative}:${editor.selection.start.line+1}`,path:relative,text:editor.document.getText(editor.selection)});return;
  }
  if(choice==='Diagnostics'){
   const rows=[];for(const [uri,items]of vscode.languages.getDiagnostics()){const relative=path.relative(root,uri.fsPath);try{await safePath(root,relative);}catch{continue;}rows.push({path:relative,items:items.map(d=>({line:d.range.start.line+1,message:d.message}))});}this.add({label:'Diagnostics',text:JSON.stringify(rows)});return;
  }
  if(choice==='Folder'){
   const selected=await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,defaultUri:vscode.Uri.file(root)});if(!selected)return;
   const relative=path.relative(root,selected[0].fsPath);if(relative)await safePath(root,relative);
   const files=await vscode.workspace.findFiles(new vscode.RelativePattern(selected[0],'**/*'),'**/{node_modules,.git,dist,.env,.env.*}/**',51);
   let included=0;for(const file of files.slice(0,50)){try{await this.file(root,file);included++;}catch{/* Report omissions without expanding the context budget. */}}
   if(included<files.length)void vscode.window.showInformationMessage('Some folder files were omitted: protected, oversized, binary, or attachment limit.');return;
  }
  const files=await vscode.workspace.findFiles(new vscode.RelativePattern(root,'**/*'),'**/{node_modules,.git,dist,.env,.env.*}/**',1000);
  const selected=await vscode.window.showQuickPick(files.map(uri=>({label:path.relative(root,uri.fsPath),uri})),{title:'Vortex — Select file'});if(selected)await this.file(root,selected.uri);
 }
 private add(row:Omit<Attachment,'id'>){if(this.rows.length>=50||this.rows.reduce((n,r)=>n+Buffer.byteLength(r.text),0)+Buffer.byteLength(row.text)>65536)throw new Error('Attachment limit: 50 items / 64 KB.');this.rows.push({...row,id:randomUUID()});}
 private async file(root:string,uri:vscode.Uri){
  const relative=path.relative(root,uri.fsPath);await safePath(root,relative);const info=await vscode.workspace.fs.stat(uri);if(info.size>65536)throw new Error('File context exceeds 64 KB. Select a smaller range.');
  const doc=await vscode.workspace.openTextDocument(uri);const text=doc.getText();if(text.includes('\0'))throw new Error('Binary context is not supported.');this.add({label:relative,path:relative,text});
 }
}
