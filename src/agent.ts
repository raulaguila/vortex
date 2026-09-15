import * as vscode from 'vscode';
import {readFile} from 'node:fs/promises';
import * as path from 'node:path';
import {runCommand} from './command';
import {FileSnapshot,snapshotFile,verifySnapshot} from './files';
import {Action,validateAction,ApprovalDenied} from './actions';
import {decodeReply} from './reply';
import {isSocialMessage} from './intent';
import {systemPrompt} from './prompt';
import {fitContext} from './context';
import {Session,SessionStore} from './sessions';
import {Message} from './providers';
import {Mode,Permission,isMode,isPermission,canWrite,safePath} from './policy';
import {AgentEvent,Request,Response,ChecklistItem} from './protocol';
import {ProviderManager} from './providerManager';

export class AgentController {
  private session?: Session;
  private checklist: ChecklistItem[] = [];
  private messages: Message[] = [];
  private run?: AbortController;
  private events: AgentEvent[] = [];
  private statusText = 'Pronto';
  private navigationVersion=0;
  constructor(private providers: ProviderManager, private post: (message: Response) => void, private sessions: SessionStore) {}
  get busy() { return !!this.run; }
  get activeSessionId(){return this.session?.id;}
  stop() { this.run?.abort(); }
  dispose() { this.stop(); }
  clear() { if (this.busy) throw new Error('Aguarde a tarefa terminar.'); this.navigationVersion++;this.events = []; this.messages=[]; this.checklist=[]; this.session=undefined; this.post({type:'checklist',items:[]}); this.statusText = 'Pronto'; this.history(); }
  history(post = this.post) { post({type:'history',events:this.events,busy:this.busy,status:this.statusText}); post({type:'checklist',items:this.checklist}); if(this.session&&this.busy)post({type:'sessionLoaded',mode:this.session.mode,permission:this.session.permission,model:this.session.model}); }
  async load(id:string) { if(this.busy)throw new Error('Stop the current task before opening a session.');const revision=++this.navigationVersion; const session=await this.sessions.load(id);if(this.busy||revision!==this.navigationVersion)throw new Error('Session navigation was superseded.'); this.session=session;this.events=session.events;this.messages=session.messages;this.checklist=session.checklist;this.statusText='Ready';this.history();this.post({type:'sessionLoaded',mode:session.mode,permission:session.permission,model:session.model}); }
  async removeSession(id:string) {if(this.busy)throw new Error('Stop the current task first.');await this.sessions.remove(id);if(this.session?.id===id)this.clear();}
  private async checkpoint() {if(this.session){this.session.events=this.events;this.session.messages=this.messages;this.session.checklist=this.checklist;await this.sessions.save(this.session);}}
  private event(role: AgentEvent['role'], text: string) { const event = {role,text,timestamp:Date.now()}; this.events.push(event); this.post({type:'event',event}); }
  private status(text: string, busy: boolean) { this.statusText = text; this.post({type:'status',busy,text}); }
  async start(msg: Extract<Request, {type: 'start'}>){
    if(this.run)throw new Error('Já existe uma tarefa em execução.');
    if(!vscode.workspace.isTrusted)throw new Error('Confie no workspace antes de iniciar.');
    
    if(!isMode(msg.mode)||!isPermission(msg.permission))throw new Error('Modo inválido.');
    const mode=msg.mode;const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if(!this.session)this.session=this.sessions.create(msg.prompt,msg.mode,msg.model);this.session.mode=msg.mode;this.session.permission=msg.permission;this.session.model=msg.model;
    const controller=new AbortController();this.run=controller;this.post({type:'accepted',requestId:msg.requestId});this.status('Trabalhando',true);this.event('user',msg.prompt);
    let outcome: 'complete' | 'error' | 'stopped' = 'complete';
    const messages=this.messages;const turnStart=messages.length;messages.push({role:'user',content:msg.prompt});
    const language=this.providers.preferences().conversation.language;
    const conversationOnly=isSocialMessage(msg.prompt);
    let failures=0;
    try{
      const client=await this.providers.client(msg.model.providerId);controller.signal.throwIfAborted();
      await this.checkpoint();
      await this.providers.ensureLimits(msg.model,controller.signal);

      for(let step=0;step<20;step++){
        const budget=this.providers.contextBudget(msg.model);
        controller.signal.throwIfAborted();this.status(`Trabalhando · etapa ${step+1}/20`,true);
        const system=systemPrompt(mode,language,this.checklist,conversationOnly,msg.permission)+`\nCurrent user request: ${msg.prompt}${conversationOnly && failures ? '\nYour previous reply was rejected. Respond with finish only; no tools are allowed.' : ''}`;
        const fitted=fitContext(system,conversationOnly ? [{role:'user',content:msg.prompt}] : messages,budget.tokens,budget.output,conversationOnly?0:turnStart);
        this.post({type:'context',model:msg.model,used:fitted.used,budget:fitted.budget,removed:fitted.removed,source:budget.source});
        const reply=await client.chat(msg.model.modelId,system,fitted.messages,controller.signal,budget);controller.signal.throwIfAborted();
        let action:Action;
        try {
          action=decodeReply(reply,mode,conversationOnly);
        } catch(error) {
          if(++failures>=3) throw new Error('The model repeatedly returned invalid or unauthorized actions. No further tools will run.');
          if(!conversationOnly) messages.push({role:'user',content:JSON.stringify({toolResult:{status:'error',output:error instanceof Error?error.message:'Invalid JSON. Return exactly one action object.'}})});
          continue;
        }
        messages.push({role:'assistant',content:reply});
        if(action.action==='finish'){this.event('assistant',action.text);return;}
        let result:string;let status:'success'|'error'|'denied'='success';
        try{result=await this.execute(action,mode,root,controller.signal,msg.permission);failures=0;}
        catch(e){if(controller.signal.aborted)throw e;status=e instanceof ApprovalDenied?'denied':'error';result=(e as Error).message;failures++;}
        this.event('activity',`${action.action}${'path' in action?' · '+action.path:''} · ${status}\n${result.slice(0,1500)}`);
        messages.push({role:'user',content:JSON.stringify({toolResult:{status,output:result.slice(0,Math.max(512,Math.floor(budget.tokens/4)))}})});await this.checkpoint();
        if(status==='denied'){outcome='stopped';this.event('assistant',result);return;}
        if(failures>=3)throw new Error('Stopped after three consecutive tool failures. Review the request or try another model.');
      }
      outcome='error';this.event('assistant','Limite de 20 etapas atingido. Revise as alterações antes de iniciar outra tarefa.');
    }catch(e){outcome=controller.signal.aborted?'stopped':'error';this.event('assistant',controller.signal.aborted?'Tarefa interrompida.':(e as Error).message);}finally{try{await this.checkpoint();}catch{this.event('assistant','Session could not be saved.');}this.run=undefined;this.status(outcome==='error'?'Falha na execução':outcome==='stopped'?'Interrompido':'Concluído',false);this.post({type:'runEnd',requestId:msg.requestId,status:outcome});}
  }
  private async execute(input:unknown,mode:Mode,root:string|undefined,signal:AbortSignal,permission:Permission='supervised',expected?:FileSnapshot):Promise<string>{
    signal.throwIfAborted();
    if(!isMode(mode)||!isPermission(permission))throw new Error('Invalid execution policy.');
    const a=validateAction(input,mode);
    if(a.action==='plan'){
      if(mode==='plan' && a.items.some(item=>item.status!=='pending' && !this.checklist.some(old=>old.id===item.id && old.text===item.text && old.status===item.status)))throw new Error('Plan mode cannot mark implementation progress. Keep new steps pending.');
      this.checklist=a.items;this.post({type:'checklist',items:this.checklist});return 'Checklist updated.';
    }
    if(!root)throw new Error('Abra uma pasta no VS Code.');
    if(a.action==='list'){const files=await vscode.workspace.findFiles(new vscode.RelativePattern(root,typeof a.pattern==='string'?a.pattern:'**/*'),'**/{node_modules,.git,dist,.env,.env.*}/**',500);return files.map(f=>vscode.workspace.asRelativePath(f)).filter(f=>!f.split('/').some(s=>s==='.env'||s.startsWith('.env.'))).join('\n');}
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
      for(const uri of files){signal.throwIfAborted();try{const relative=vscode.workspace.asRelativePath(uri);const file=await safePath(root,relative);const stat=await vscode.workspace.fs.stat(uri);if(stat.size>100000)continue;const text=await readFile(file,'utf8');if(text.includes('\0'))continue;for(const [i,line] of text.split('\n').entries())if(line.includes(a.query)){hits.push(`${relative}:${i+1}: ${line.slice(0,300)}`);if(hits.length>=80)return hits.join('\n');}}catch{}}
      return hits.join('\n')||'No matches.';
    }
    if(a.action==='edit'){
      if(!canWrite(mode))throw new Error('Read-only mode.');if(typeof a.oldText!=='string'||!a.oldText||typeof a.newText!=='string')throw new Error('Invalid edit.');
      const snapshot=await snapshotFile(root,a.path);const original=snapshot.content;if(original===null)throw new Error('File not found.');if(original.split(a.oldText).length!==2)throw new Error('oldText must match exactly once.');
      return this.execute({action:'write',path:a.path,content:original.replace(a.oldText,()=>a.newText)},mode,root,signal,permission,snapshot);
    }
    if(!canWrite(mode))throw new Error('Este modo permite apenas leitura.');
    if(a.action==='write'){
      if(typeof a.content!=='string'||a.content.length>200000)throw new Error('Conteúdo inválido ou maior que 200 KB.');
      const snapshot=expected||await snapshotFile(root,a.path);const file=snapshot.path;
      if(permission==='supervised'&&await vscode.window.showWarningMessage(`Vortex deseja gravar ${a.path}`,{modal:true,detail:a.content.slice(0,12000)},'Permitir')!=='Permitir')throw new ApprovalDenied();
      signal.throwIfAborted();await verifySnapshot(root,a.path,snapshot);
      const uri=vscode.Uri.file(file);const edit=new vscode.WorkspaceEdit();let exists=true;try{await vscode.workspace.fs.stat(uri);}catch{exists=false;}
      if(exists){const doc=await vscode.workspace.openTextDocument(uri);if(doc.isDirty||doc.getText()!==snapshot.content)throw new Error('The file has changed or contains unsaved edits. Read it again before editing.');edit.replace(uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),a.content);}else{edit.createFile(uri,{overwrite:false});edit.insert(uri,new vscode.Position(0,0),a.content);}
      signal.throwIfAborted();
      if(!await vscode.workspace.applyEdit(edit))throw new Error('Não foi possível aplicar a edição.');const doc=await vscode.workspace.openTextDocument(uri);if(!await doc.save())throw new Error('Edição aplicada mas não salva.');return 'Arquivo salvo: '+a.path;
    }
    if(a.action==='command'){
      if(typeof a.command!=='string'||!a.command.trim())throw new Error('Comando inválido.');
      if(await vscode.window.showWarningMessage('Executar comando no workspace?',{modal:true,detail:a.command},'Executar')!=='Executar')throw new ApprovalDenied();
      signal.throwIfAborted();return runCommand(a.command,root,signal);
    }
    throw new Error('Ação desconhecida.');
  }
}
