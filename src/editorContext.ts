import * as vscode from 'vscode';
import * as path from 'node:path';
import {safePath} from './policy';

export class EditorContext implements vscode.Disposable {
  private last?:vscode.TextEditor;
  private subscription:vscode.Disposable;
  constructor(){
    this.remember(vscode.window.activeTextEditor);
    this.subscription=vscode.window.onDidChangeActiveTextEditor(editor=>this.remember(editor));
  }
  private remember(editor:vscode.TextEditor|undefined){if(editor?.document.uri.scheme==='file')this.last=editor;}
  dispose(){this.subscription.dispose();}
  async snapshot(root:string,selection=false){
    const files=[];
    for(const doc of vscode.workspace.textDocuments){
      if(doc.uri.scheme!=='file'||doc.isClosed)continue;
      const relative=path.relative(root,doc.uri.fsPath);try{await safePath(root,relative);}catch{continue;}
      files.push({path:relative,language:doc.languageId,dirty:doc.isDirty,version:doc.version,active:doc===this.last?.document});
    }
    const active=files.find(f=>f.active);const editor=this.last;
    return {files,active:active?.path||null,...(selection&&active&&editor?{selection:{startLine:editor.selection.start.line+1,endLine:editor.selection.end.line+1,character:editor.selection.active.character+1,text:editor.document.getText(editor.selection).slice(0,32000),truncated:editor.document.getText(editor.selection).length>32000}}:{})};
  }
}
