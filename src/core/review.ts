import type {GetDialogs} from "../ui/dialogs";
import {ExecutionError} from "./execution";
import {performMutation} from "./operation";
import * as vscode from 'vscode';
import {randomUUID} from 'node:crypto';
import {reviewPatch,selectHunks} from "../tools/hunks";
import {ChangeStore,Change} from "../tools/changes";
import {snapshotFile,verifySnapshot} from "../tools/files";
export class ReviewService implements vscode.Disposable {
 private documents=new Map<string,string>();
 private registration:vscode.Disposable;
 constructor(private store:ChangeStore,private getDialogs?:GetDialogs){this.registration=vscode.workspace.registerTextDocumentContentProvider('vortex-diff',{provideTextDocumentContent:uri=>this.documents.get(uri.toString())||''});}
 dispose(){this.registration.dispose();this.documents.clear();}
 async preview(change:Change){
  const id=randomUUID();const before=vscode.Uri.from({scheme:'vortex-diff',path:`/${id}/before/${change.path}`});const after=vscode.Uri.from({scheme:'vortex-diff',path:`/${id}/after/${change.path}`});
  this.documents.set(before.toString(),change.before||'');this.documents.set(after.toString(),change.after||'');
  await vscode.commands.executeCommand('vscode.diff',before,after,`Vortex · ${change.path}`,{preview:true});
 }
 async propose(session:string,file:string,before:string|null,after:string|null){try{return await this.store.propose(session,file,before,after);}catch{throw new ExecutionError('persistence','The proposed change could not be saved. No new changes were started.');}}
 approvalHunks(change:Change){
  const patch=reviewPatch(change.before||'',change.after||'');
  if(patch.hunks.length>100)return undefined;
  return patch.hunks.map(h=>{const start=h.oldLines?h.oldStart:h.newStart,lines=h.oldLines||h.newLines,diff=h.lines.join('\n');return {label:`${start}–${start+Math.max(0,lines-1)}`,diff:diff.length>2000?diff.slice(0,1998)+'\n…':diff};});
 }
 async applyHunks(session:string,change:Change,indices:number[]){
  const patch=reviewPatch(change.before||'',change.after||'');
  if(!indices.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=patch.hunks.length))throw new Error('Invalid change selection.');
  const after=selectHunks(change.before||'',patch,indices);await this.store.replaceProposal(session,change.id,after);change.after=after;return after;
 }
 async mutate(session:string,change:Change,apply:()=>Promise<void>,save:()=>Promise<void>,undo=false){
  return performMutation({id:change.id+(undo?'-undo':''),path:change.path,phase:'prepared',outcome:'not_applied',undo},s=>this.store.operation(session,s),apply,save,()=>this.mark(session,change.id,undo?'reverted':'applied'));
 }
 async inspect(session:string,root:string){
  const changes=await this.store.list(session),operations=await this.store.operations(session);const rows=[];
  const latest=new Map<string,typeof operations[number]>();for(const operation of operations)latest.set(operation.path,operation);
  for(const operation of latest.values()){
   const change=changes.find(c=>c.id===(operation.undo?operation.id.replace(/-undo$/,''):operation.id));if(!change)continue;
   const snapshot=await snapshotFile(root,change.path);const dirty=vscode.workspace.textDocuments.some(d=>d.uri.fsPath===snapshot.path&&d.isDirty);
   rows.push({id:operation.id,path:change.path,phase:operation.phase,state:dirty?'unsaved_buffer':snapshot.content===(operation.undo?change.after:change.before)?'original':snapshot.content===(operation.undo?change.before:change.after)?'expected':'divergent'});
  }
  return rows;
 }
 mark(session:string,id:string,status:Change['status']){return this.store.mark(session,id,status);}
 async availability(session:string){const changes=await this.store.list(session);return {reviewChanges:changes.length>0,undoChanges:changes.some(c=>c.status==='applied'||c.status==='proposed')};}
 async review(session:string){const changes=await this.store.list(session),ui=await this.getDialogs?.();if(!ui)return;const selected=await ui.pick('Review changes',changes.map(c=>({label:c.path,description:c.status,value:c})));if(selected)await this.preview(selected);}
 async undo(session:string,root:string,signal?:AbortSignal){
  const changes=(await this.store.list(session)).filter(c=>c.status==='applied'||c.status==='proposed').reverse();
  const ui=await this.getDialogs?.();if(!ui)return false;
  if(!changes.length){await ui.notice('No changes to undo.');return false;}
  if(!await ui.confirm('Undo this task’s changes?','Files modified afterwards will be preserved and reported as conflicts.','Undo',signal))return false;
  const conflicts=new Set<string>();
  for(const change of changes){
   signal?.throwIfAborted();
   if(conflicts.has(change.path))continue;
   const current=await snapshotFile(root,change.path);
   if(change.status==='proposed'&&current.content===change.before){await this.mark(session,change.id,'rejected');continue;}
   if(current.content!==change.after){conflicts.add(change.path);continue;}
   const uri=vscode.Uri.file(current.path);const doc=current.content===null?undefined:await vscode.workspace.openTextDocument(uri);
   if(doc?.isDirty){conflicts.add(change.path);continue;}
   await verifySnapshot(root,change.path,current);
   const edit=new vscode.WorkspaceEdit();
   if(change.before===null)edit.deleteFile(uri);
   else if(!doc){edit.createFile(uri);edit.insert(uri,new vscode.Position(0,0),change.before);}
   else edit.replace(uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),change.before);
   await this.mutate(session,change,async()=>{if(!await vscode.workspace.applyEdit(edit))throw new Error('Unable to undo '+change.path);},async()=>{if(change.before!==null&&!await (await vscode.workspace.openTextDocument(uri)).save())throw new Error('Undo applied but not saved: '+change.path);},true);
  }
  if(conflicts.size)await ui.notice('Conflicting files were preserved.',[...conflicts].join('\n'));
  return true;
 }
}
