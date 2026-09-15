import * as vscode from 'vscode';
import {randomUUID} from 'node:crypto';
import {reviewPatch,selectHunks} from './hunks';
import {ChangeStore,Change} from './changes';
import {snapshotFile,verifySnapshot} from './files';
export class ReviewService implements vscode.Disposable {
 private documents=new Map<string,string>();
 private registration:vscode.Disposable;
 constructor(private store:ChangeStore){this.registration=vscode.workspace.registerTextDocumentContentProvider('vortex-diff',{provideTextDocumentContent:uri=>this.documents.get(uri.toString())||''});}
 dispose(){this.registration.dispose();this.documents.clear();}
 async preview(change:Change){
  const id=randomUUID();const before=vscode.Uri.from({scheme:'vortex-diff',path:`/${id}/before/${change.path}`});const after=vscode.Uri.from({scheme:'vortex-diff',path:`/${id}/after/${change.path}`});
  this.documents.set(before.toString(),change.before||'');this.documents.set(after.toString(),change.after||'');
  await vscode.commands.executeCommand('vscode.diff',before,after,`Vortex · ${change.path}`,{preview:true});
 }
 async propose(session:string,file:string,before:string|null,after:string|null){return this.store.propose(session,file,before,after);}
 async chooseHunks(session:string,change:Change,signal?:AbortSignal):Promise<string|undefined>{
  const patch=reviewPatch(change.before||'',change.after||'');
  const selected=await vscode.window.showQuickPick(patch.hunks.map((h,index)=>({label:`Lines ${h.oldStart}–${h.oldStart+h.oldLines}`,description:h.lines.filter(l=>l.startsWith('+')||l.startsWith('-')).join(' ').slice(0,180),index,picked:true})),{canPickMany:true,title:'Select changes to apply; unselected changes are rejected'});
  signal?.throwIfAborted();if(!selected)return undefined;const after=selectHunks(change.before||'',patch,selected.map(s=>s.index));await this.store.replaceProposal(session,change.id,after);change.after=after;await this.preview(change);return after;
 }
 mark(session:string,id:string,status:Change['status']){return this.store.mark(session,id,status);}
 async availability(session:string){const changes=await this.store.list(session);return {reviewChanges:changes.length>0,undoChanges:changes.some(c=>c.status==='applied'||c.status==='proposed')};}
 async review(session:string){const changes=await this.store.list(session);const selected=await vscode.window.showQuickPick(changes.map(c=>({label:c.path,description:c.status,change:c})),{title:'Vortex — Review changes'});if(selected)await this.preview(selected.change);}
 async undo(session:string,root:string){
  const changes=(await this.store.list(session)).filter(c=>c.status==='applied'||c.status==='proposed').reverse();
  if(!changes.length){void vscode.window.showInformationMessage('No changes to undo.');return;}
  if(await vscode.window.showWarningMessage('Undo this task’s changes?',{modal:true,detail:'Files modified afterwards will be preserved and reported as conflicts.'},'Undo')!=='Undo')return;
  const conflicts=new Set<string>();
  for(const change of changes){
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
   if(!await vscode.workspace.applyEdit(edit))throw new Error('Unable to undo '+change.path);
   if(change.before!==null&&!await (await vscode.workspace.openTextDocument(uri)).save())throw new Error('Undo applied but not saved: '+change.path);
   await this.mark(session,change.id,'reverted');
  }
  if(conflicts.size)void vscode.window.showWarningMessage('Preserved conflicting files: '+[...conflicts].join(', '));
 }
}
