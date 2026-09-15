import * as path from 'node:path';
import * as vscode from 'vscode';
import { ApprovalDenied,validateAction } from './actions';
import { runCommand } from './command';
import { EditorContext } from './editorContext';
import { ExecutionError } from './execution';
import { FileSnapshot,snapshotFile,verifySnapshot } from './files';
import { applyEdits } from './multiEdit';
import { Mode,Permission,canWrite,isMode,isPermission,safePath } from './policy';
import { Response } from './protocol';
import { ProviderManager } from './providerManager';
import { askQuestion } from './question';
import { contentVersion,executeReadTool } from './readTools';
import { ReviewService } from './review';
import { Sandbox } from './sandbox';
import { SessionStore } from './sessions';

import { AgentRuntime } from './agentRuntime';
export class AgentController extends AgentRuntime {
 constructor(providers:ProviderManager,post:(message:Response)=>void,sessions:SessionStore,reviews?:ReviewService,artifactsDirectory?:string,editor?:EditorContext,tracePath?:string){
  super(providers,post,sessions,reviews,artifactsDirectory,editor,tracePath,{
   trusted:()=>vscode.workspace.isTrusted,
   roots:()=>vscode.workspace.workspaceFolders?.map(f=>f.uri.fsPath)||[],
   pickRoot:async()=>(await vscode.window.showWorkspaceFolderPick({placeHolder:'Choose this task’s workspace root'}))?.uri.fsPath,
   choosePermission:async()=>await vscode.window.showQuickPick(['supervised','autonomous'],{title:'Implement plan — permission'}) as Permission|undefined,
   confirmUncertain:async()=>await vscode.window.showWarningMessage('Review the interrupted operation before continuing.',{modal:true,detail:'Inspect the workspace and task changes before continuing. The interrupted operation will not be repeated automatically.'},'I reviewed the result — continue')==='I reviewed the result — continue',
   execute:async()=>{throw new Error('Host tool dispatcher unavailable.');}
  });
 }
  protected verifyRead(snapshot:FileSnapshot){
    const previous=this.readVersions.get(snapshot.path);
    if(this.run&&snapshot.content!==null&&!previous)throw new Error('Read the existing file before changing it.');
    if(previous&&(snapshot.content===null||previous!==contentVersion(snapshot.content)))throw new Error('File changed since your last read. Read it again before editing.');
  }
  protected async execute(input:unknown,mode:Mode,root:string|undefined,signal:AbortSignal,permission:Permission='supervised',expected?:FileSnapshot):Promise<string>{
    signal.throwIfAborted();
    if(!isMode(mode)||!isPermission(permission))throw new Error('Invalid execution policy.');
    const a=validateAction(input,mode);
    if(a.action==='plan'||a.action==='readOutput')return super.execute(a,mode,root,signal,permission);
    if(a.action==='question'){this.event('assistant',a.text);return askQuestion(a.text,a.options,signal);}
    if(!root)throw new Error('Abra uma pasta no VS Code.');
    if(a.action==='editor')return JSON.stringify(this.editor?await this.editor.snapshot(root,a.selection):{files:[],active:null,unavailable:true});
    const readResult=await executeReadTool(a,root,signal,this.readVersions);if(readResult!==undefined)return readResult;
    if(a.action==='edit'||a.action==='multiEdit'){
      if(!canWrite(mode))throw new Error('Read-only mode.');
      const snapshot=await snapshotFile(root,a.path);const original=snapshot.content;if(original===null)throw new Error('File not found.');this.verifyRead(snapshot);
      return this.execute({action:'write',path:a.path,content:applyEdits(original,a.action==='edit'?[{oldText:a.oldText,newText:a.newText}]:a.edits)},mode,root,signal,permission,snapshot);
    }
    if(!canWrite(mode))throw new Error('Este modo permite apenas leitura.');
    if(a.action==='write'){
      if(typeof a.content!=='string'||a.content.length>200000)throw new Error('Conteúdo inválido ou maior que 200 KB.');
      const snapshot=expected||await snapshotFile(root,a.path);const file=snapshot.path;this.verifyRead(snapshot);
      const change=this.session&&this.reviews?await this.reviews.propose(this.session.id,a.path,snapshot.content,a.content):undefined;
      let partial=false;
      if(permission==='supervised'){
        if(change)await this.reviews!.preview(change);
        const approval=await this.approval(()=>vscode.window.showWarningMessage(`Vortex deseja gravar ${a.path}`,{modal:true,detail:change?'Review the diff in the editor. Allow applies this file; Cancel rejects it.':a.content.slice(0,12000)},'Permitir',...(change?['Select hunks']:[])));
        if(approval==='Select hunks'&&change){const selected=await this.approval(()=>this.reviews!.chooseHunks(this.session!.id,change,signal));if(selected===undefined||selected===snapshot.content){await this.reviews!.mark(this.session!.id,change.id,'rejected');throw new ApprovalDenied();}partial=selected!==a.content;a.content=selected;}
        else if(approval!=='Permitir'){
          if(change)await this.reviews!.mark(this.session!.id,change.id,'rejected');throw new ApprovalDenied();
        }
      }
      signal.throwIfAborted();await verifySnapshot(root,a.path,snapshot);
      const uri=vscode.Uri.file(file);const edit=new vscode.WorkspaceEdit();let exists=true;try{await vscode.workspace.fs.stat(uri);}catch{exists=false;}
      if(exists){const doc=await vscode.workspace.openTextDocument(uri);if(doc.isDirty||doc.getText()!==snapshot.content)throw new Error('The file has changed or contains unsaved edits. Read it again before editing.');edit.replace(uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),a.content);}else{edit.createFile(uri,{overwrite:false});edit.insert(uri,new vscode.Position(0,0),a.content);}
      signal.throwIfAborted();
      if(!await vscode.workspace.applyEdit(edit))throw new Error('Não foi possível aplicar a edição.');const doc=await vscode.workspace.openTextDocument(uri);if(!await doc.save())throw new Error('Edição aplicada mas não salva.');this.readVersions.set(file,contentVersion(a.content));if(change)await this.reviews!.mark(this.session!.id,change.id,'applied');if(partial)throw new ApprovalDenied('Selected changes applied to '+a.path+'. Remaining changes were rejected; the turn stopped.');return 'Arquivo salvo: '+a.path;
    }
    if(a.action==='remove'){
      const snapshot=expected||await snapshotFile(root,a.path);if(snapshot.content===null)throw new Error('File not found.');
      this.verifyRead(snapshot);
      const change=this.session&&this.reviews?await this.reviews.propose(this.session.id,a.path,snapshot.content,null):undefined;
      if(permission==='supervised'){
        if(change)await this.reviews!.preview(change);
        if(await this.approval(()=>vscode.window.showWarningMessage('Remove '+a.path+'?',{modal:true},'Remove'))!=='Remove'){if(change)await this.reviews!.mark(this.session!.id,change.id,'rejected');throw new ApprovalDenied();}
      }
      signal.throwIfAborted();await verifySnapshot(root,a.path,snapshot);const uri=vscode.Uri.file(snapshot.path);const doc=await vscode.workspace.openTextDocument(uri);
      if(doc.isDirty)throw new Error('Unsaved changes preserved.');const edit=new vscode.WorkspaceEdit();edit.deleteFile(uri,{recursive:false});if(!await vscode.workspace.applyEdit(edit))throw new Error('Unable to remove file.');
      this.readVersions.delete(snapshot.path);if(change)await this.reviews!.mark(this.session!.id,change.id,'applied');return 'Removed '+a.path;
    }
    if(a.action==='command'){
      if(typeof a.command!=='string'||!a.command.trim())throw new Error('Comando inválido.');
      const cwd=a.cwd&&a.cwd!=='.'?await safePath(root,a.cwd):root;
      if(permission==='autonomous'){
        this.sandbox??=new Sandbox(this.artifactsDirectory&&this.session?path.join(this.artifactsDirectory,this.session.id):undefined);
        if(await this.sandbox.available()){
          if(a.network&&await this.approval(()=>vscode.window.showWarningMessage('Allow network for this sandbox command?',{modal:true,detail:a.command},'Allow network'))!=='Allow network')throw new ApprovalDenied();
          const image=vscode.workspace.getConfiguration?.('vortex').get<string>('sandbox.image')||'node:22-bookworm-slim';
          const result=await this.sandbox.execute(root,a.cwd&&a.cwd!=='.'?`cd '${a.cwd.replace(/'/g,"'\\''")}' && ${a.command}`:a.command,signal,this.commandTimeout,!!a.network,image,(stream,text)=>this.commandOutput(stream,text));
          if(result.failure){try{for(const change of result.changes)if(this.session&&this.reviews)await this.reviews.propose(this.session.id,change.path,change.before,change.after);if(result.changes.length)this.event('activity','Interrupted sandbox changes\nChanges retained for review; no changes imported.');}catch{throw new ExecutionError('uncertain_outcome','The interrupted command could not save all review data. Inspect the workspace and diagnostics before continuing.');}throw result.failure;}
          if(result.artifacts.length)this.event('activity','Sandbox artifacts\n'+result.artifacts.join('\n'));
          for(const change of result.changes){
            const current=await snapshotFile(root,change.path);
            if(current.content!==change.before)throw new Error('Sandbox import conflict: '+change.path+'. User changes preserved.');
            if(current.content!==null)this.readVersions.set(current.path,contentVersion(current.content));
            await this.execute(change.after===null?{action:'remove',path:change.path}:{action:'write',path:change.path,content:change.after},mode,root,signal,permission,current);
          }
          if(result.error)throw new Error(result.error);
          return result.output;
        }
        this.event('activity','Sandbox unavailable\nDocker is not available. This command requires host approval.');
      }
      if(await this.approval(()=>vscode.window.showWarningMessage('Executar comando no workspace?',{modal:true,detail:cwd+'\n\n'+a.command},'Executar'))!=='Executar')throw new ApprovalDenied();
      signal.throwIfAborted();return runCommand(a.command,cwd,signal,this.commandTimeout,1024*1024,(stream,text)=>this.commandOutput(stream,text));
    }
    throw new Error('Ação desconhecida.');
  }
}
