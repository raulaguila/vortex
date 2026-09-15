import {probeModel} from './modelProbe';
import * as vscode from 'vscode';
import {randomBytes} from 'node:crypto';
import {RunTrace} from './trace';
import {stat,readFile,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {EditorContext} from './editorContext';
import {AgentController} from './agent';
import {ProviderManager} from './providerManager';
import {parseRequest, Request, Response,SettingsSection} from './protocol';
import {execFile} from 'node:child_process';
import {Sandbox} from './sandbox';
import {Attachments} from './attachments';
import {ChangeStore} from './changes';
import {ReviewService} from './review';
import {SessionStore} from './sessions';
import {renderSidebar} from './view';

type Surface = {webview: vscode.Webview; kind: 'chat' | 'settings'; disposed: boolean};
export function activate(context: vscode.ExtensionContext) {
  const controller = new VortexController(context);
  context.subscriptions.push(controller, vscode.window.registerWebviewViewProvider('vortex.sidebar', controller),
    vscode.commands.registerCommand('vortex.open', () => vscode.commands.executeCommand('vortex.sidebar.focus')),
    vscode.commands.registerCommand('vortex.openSettings', () => controller.openSettings()));
}
class VortexController implements vscode.WebviewViewProvider {
  private surfaces = new Set<Surface>();
  private panel?: vscode.WebviewPanel;
  private panelSurface?: Surface;
  private providers: ProviderManager;
  private agent: AgentController;
  private sessions: SessionStore;
  private attachments=new Attachments();
  private snapshotVersion = 0;
  private initialized = false;
  private restored?:Promise<void>;
  private routes = new Map<string, Surface>();
  private chatTest?:AbortController;
  private settingsSection: SettingsSection = 'providers';
  constructor(private ctx: vscode.ExtensionContext) {
    this.sessions=new SessionStore(vscode.Uri.joinPath(ctx.globalStorageUri,'sessions').fsPath,ctx.storageUri?vscode.Uri.joinPath(ctx.storageUri,'sessions').fsPath:undefined,vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,ctx.globalStorageUri.fsPath,vscode.Uri.joinPath(ctx.storageUri||ctx.globalStorageUri,'last-flow.json').fsPath);
    const traceUri=vscode.Uri.joinPath(ctx.storageUri||ctx.globalStorageUri,'last-flow.json');
    ctx.subscriptions.push(vscode.commands.registerCommand('vortex.openLastFlow',async()=>{try{await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(traceUri));}catch{void vscode.window.showInformationMessage('No saved flow yet. Send a message to Vortex first.');}}));
    const output=vscode.window.createOutputChannel('Vortex');ctx.subscriptions.push(output);
    const diagnostics:string[]=[];const log=(record:Record<string,unknown>)=>{const line=JSON.stringify({time:new Date().toISOString(),...record});diagnostics.push(line);if(diagnostics.length>1000)diagnostics.shift();output.appendLine(line);};
    ctx.subscriptions.push(vscode.commands.registerCommand('vortex.diagnostics',()=>output.show()),vscode.commands.registerCommand('vortex.exportDiagnostics',async()=>{const doc=await vscode.workspace.openTextDocument({language:'jsonl',content:diagnostics.join('\n')});await vscode.window.showTextDocument(doc);}));
    void Sandbox.recover(vscode.Uri.joinPath(ctx.globalStorageUri,'artifacts').fsPath).catch(()=>log({event:'sandboxRecovery',status:'failed'}));
    ctx.subscriptions.push(vscode.commands.registerCommand('vortex.setupSandbox',async()=>{
      const available=await new Sandbox().available();if(!available){void vscode.window.showInformationMessage('Install and start a local Docker runtime first. Host commands remain supervised.');return;}
      const image=await vscode.window.showInputBox({title:'Download sandbox image',value:vscode.workspace.getConfiguration('vortex').get<string>('sandbox.image')||'node:22-bookworm-slim',validateInput:value=>/^[a-zA-Z0-9][a-zA-Z0-9./_:@-]{0,250}$/.test(value)?undefined:'Invalid image reference'});if(!image)return;
      await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Vortex — Downloading sandbox image'},()=>new Promise<void>((resolve,reject)=>execFile('docker',['pull',image],{timeout:300000,maxBuffer:1024*1024},error=>error?reject(new Error('Image download failed. Check Docker and network access.')):resolve())));
      await vscode.workspace.getConfiguration('vortex').update('sandbox.image',image,vscode.ConfigurationTarget.Global);
    }));
    const reviews=new ReviewService(new ChangeStore(vscode.Uri.joinPath(ctx.globalStorageUri,'changes').fsPath));ctx.subscriptions.push(reviews);
    ctx.subscriptions.push(vscode.commands.registerCommand('vortex.reviewChanges',()=>this.agent.reviewChanges()),vscode.commands.registerCommand('vortex.undoChanges',()=>this.agent.undoChanges()));
    ctx.subscriptions.push(vscode.commands.registerCommand('vortex.attachContext',async(uri?:vscode.Uri)=>{await this.attachments.choose(uri);this.attachmentState();}));
    const editor=new EditorContext();ctx.subscriptions.push(editor);
    this.providers = new ProviderManager(ctx.globalState, ctx.secrets,undefined,log);
    this.agent = new AgentController(this.providers, message => {
      if(message.type==='toolProgress')log({runId:message.runId,id:message.id,tool:message.name,status:message.status,elapsed:message.elapsed});
      if(message.type==='runEnd')log({id:message.requestId,status:message.status});
      if(message.type==='context')void this.state().catch(()=>undefined);
      if(message.type==='accepted'){this.attachments.consume();this.attachmentState();}
      if(message.type==='accepted'||message.type==='history')void ctx.workspaceState.update('activeSession',this.agent.activeSessionId);
      if(message.type === 'accepted' || message.type === 'runEnd') {
        const target = this.routes.get(message.requestId); if(target) this.post(target, message);
      } else for(const target of this.surfaces) if(target.kind === 'chat' || message.type === 'status') this.post(target, message);
    }, this.sessions,reviews,vscode.Uri.joinPath(ctx.globalStorageUri,'artifacts').fsPath,editor,traceUri.fsPath);
  }
  private traceUri(){return vscode.Uri.joinPath(this.ctx.storageUri||this.ctx.globalStorageUri,'last-flow.json');}
  private async traceInfo(target:Surface){const uri=this.traceUri();const info=await stat(uri.fsPath).catch(()=>undefined);this.post(target,{type:'traceInfo',path:uri.fsPath,exists:!!info,bytes:info?.size||0});}
  private attachmentState(){for(const surface of this.surfaces)if(surface.kind==='chat')this.post(surface,{type:'attachments',items:this.attachments.list()});}
  dispose() { this.chatTest?.abort();this.agent.dispose(); this.panel?.dispose(); }
  private post(target: Surface, data: Response) { if(!target.disposed) void target.webview.postMessage(data); }
  private async state() {
    const version = ++this.snapshotVersion;
    const state = await this.providers.snapshot();
    if(version === this.snapshotVersion) for(const target of this.surfaces) this.post(target, {type:'state',state,busy:this.agent.busy});
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.bind(view.webview, 'chat', listener => view.onDidDispose(listener));
  }
  openSettings(section: SettingsSection = 'providers') {
    this.settingsSection = section;
    if(this.panel) {
      this.panel.reveal();
      if(this.panelSurface) this.post(this.panelSurface, {type:'settingsSection',section});
      return;
    }
    const panel = vscode.window.createWebviewPanel('vortex.settings', 'Vortex — Configurações', vscode.ViewColumn.Active, {enableScripts:true, retainContextWhenHidden:true});
    this.panel = panel;
    this.panelSurface = this.bind(panel.webview, 'settings', listener => panel.onDidDispose(listener));
    panel.onDidDispose(() => { if(this.panel === panel) {this.chatTest?.abort();this.panel=undefined; this.panelSurface=undefined;} });
  }
  private bind(webview: vscode.Webview, kind: Surface['kind'], onDispose: (listener: () => void) => vscode.Disposable): Surface {
    const target: Surface = {webview, kind, disposed:false}; this.surfaces.add(target);
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    webview.options = {enableScripts:true,localResourceRoots:[media]};
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
    webview.html = renderSidebar(readFileSync(vscode.Uri.joinPath(media, kind === 'chat' ? 'sidebar.html' : 'settings.html').fsPath, 'utf8'), {
      cspSource:webview.cspSource, nonce:randomBytes(24).toString('hex'), style:asset(kind === 'chat' ? 'style.css' : 'settings.css'), script:asset(kind === 'chat' ? 'app.js' : 'settings.js'), logo:asset('vortex.svg'),shared:asset('shared.js'),vendor:asset('vendor.js'),picker:asset('picker.js'),version:this.ctx.extension.packageJSON.version
    });
    const listener = webview.onDidReceiveMessage(async (raw: unknown) => {
      let msg: Request;
      try { msg=parseRequest(raw); }
      catch { this.post(target,{type:'result',requestId:typeof (raw as any)?.requestId === 'string' ? (raw as any).requestId.slice(0,100) : '',ok:false,message:'Mensagem inválida. Verifique os campos e tente novamente.'}); return; }
      try { await this.handle(target,msg); }
      catch(error) { this.post(target,{type:'result',requestId:msg.requestId,ok:false,message:error instanceof Error ? error.message : 'Não foi possível concluir a operação.'}); }
    });
    onDispose(() => { if(target.kind==='settings')this.chatTest?.abort();target.disposed=true; listener.dispose(); this.surfaces.delete(target); });
    return target;
  }
  private async handle(target: Surface, msg: Request): Promise<void> {
    const success = (message?: string, providerId?: string) => this.post(target,{type:'result',requestId:msg.requestId,ok:true,message,providerId});
    switch(msg.type) {
      case 'setupSandbox':await vscode.commands.executeCommand('vortex.setupSandbox');success();return;
      case 'attachContext':await this.attachments.choose();this.attachmentState();success();return;
      case 'removeContext':this.attachments.remove(msg.id);this.attachmentState();success();return;
      case 'ready':
        this.attachmentState();
        await this.providers.migrateSelection(msg.legacySelection);await this.providers.initialize();await this.sessions.recoverDeletions();await this.sessions.cleanup(this.providers.preferences().storage?.retentionDays||0); await this.state();
        if(!this.restored)this.restored=(async()=>{
          const id=this.ctx.workspaceState.get<string>('activeSession');
          if(id&&!this.agent.busy)try{await this.agent.load(id);}catch{await this.ctx.workspaceState.update('activeSession',undefined);}
        })();
        await this.restored;
        if(target.kind === 'chat') this.agent.history(message => this.post(target,message));
        else this.post(target,{type:'settingsSection',section:this.settingsSection});
        if(!this.initialized) { this.initialized=true; await Promise.all(this.providers.providers().map(p => this.providers.refresh(p.id,msg.requestId+':'+p.id,()=>this.state()).catch(()=>undefined))); }
        const selected=this.providers.preferences().selected;if(selected){await this.providers.ensureLimits(selected);await this.state();}
        return;
      case 'copyText': await vscode.env.clipboard.writeText(msg.text);success();return;
      case 'openLink': await vscode.env.openExternal(vscode.Uri.parse(msg.url));return;
      case 'listSessions': {const rows=await this.sessions.list(msg.query,msg.offset||0,51);this.post(target,{type:'sessions',sessions:rows.slice(0,50),requestId:msg.requestId,offset:msg.offset||0,hasMore:rows.length>50});return;}
      case 'loadSession': await this.agent.load(msg.id); return;
      case 'deleteSession': if(await vscode.window.showWarningMessage('Delete this session and its saved results?',{modal:true,detail:'This removes the conversation, retained outputs and undo history. Workspace files are preserved.'},'Delete')==='Delete')await this.agent.removeSession(msg.id);success();return;
      case 'refreshAllModels': await Promise.all(this.providers.providers().map(p=>this.providers.refresh(p.id,msg.requestId+':'+p.id,()=>this.state())));success();return;
      case 'modelInfo': await this.providers.inspect(msg.model);await this.state();success();return;
      case 'resume':case 'implementPlan':
        if(target.kind!=='chat')throw new Error('Use the conversation to continue.');this.routes.set(msg.requestId,target);
        try{await this.agent.resume(msg.requestId,msg.type==='implementPlan');}finally{this.routes.delete(msg.requestId);}success();return;
      case 'reviewChanges':await this.agent.reviewChanges();success();return;
      case 'undoChanges':await this.agent.undoChanges();success();return;
      case 'retry':if(target.kind!=='chat')throw new Error('Use the conversation.');this.routes.set(msg.requestId,target);try{await this.agent.retry(msg.requestId);}finally{this.routes.delete(msg.requestId);}return;
      case 'saveModels':if(this.agent.busy)throw new Error('Stop the task before saving model settings.');await this.providers.saveModels(msg.settings);break;
      case 'traceInfo':await this.traceInfo(target);return;
      case 'openTrace':await vscode.commands.executeCommand('vortex.openLastFlow');success();return;
      case 'exportTrace':{
        const uri=await vscode.window.showSaveDialog({defaultUri:vscode.Uri.file('vortex-flow.json'),filters:{JSON:['json']}});if(uri){await RunTrace.settled(this.traceUri().fsPath);const snapshot=await readFile(this.traceUri().fsPath);await vscode.workspace.fs.writeFile(uri,snapshot);}success();return;
      }
      case 'clearTrace':if(this.agent.busy)throw new Error('Stop the task before clearing its flow.');await RunTrace.settled(this.traceUri().fsPath);await unlink(this.traceUri().fsPath).catch((e)=>{if(e.code!=='ENOENT')throw e;});await this.traceInfo(target);success();return;
      case 'cancelTestChat':this.chatTest?.abort();success();return;
      case 'storageInfo':this.post(target,{type:'storageInfo',...await this.sessions.storageInfo(),retentionDays:this.providers.preferences().storage?.retentionDays||0});return;
      case 'setStorage':await this.providers.setStorage(msg.retentionDays);await this.sessions.cleanup(msg.retentionDays);await this.state();this.post(target,{type:'storageInfo',...await this.sessions.storageInfo(),retentionDays:msg.retentionDays});success();return;
      case 'cleanupStorage':if(this.agent.busy)throw new Error('Wait for the task to finish.');const retention=this.providers.preferences().storage?.retentionDays||0;if(!retention&&await vscode.window.showWarningMessage('Delete all completed sessions and their saved results?',{modal:true,detail:'This removes undo history. Workspace files are preserved.'},'Delete completed sessions')!=='Delete completed sessions'){success();return;}await this.sessions.cleanup(retention,true);this.post(target,{type:'storageInfo',...await this.sessions.storageInfo(),retentionDays:this.providers.preferences().storage?.retentionDays||0});success();return;
      case 'testTools':{
        if(this.agent.busy||this.chatTest)throw new Error('Wait for the current operation to finish.');
        const controller=new AbortController();this.chatTest=controller;const revision=this.providers.revision(msg.model);
        try{const result=await probeModel(this.providers,msg.model,controller.signal);if(revision!==this.providers.revision(msg.model))throw new Error('Connection changed. Test again.');this.post(target,{type:'toolsTestResult',requestId:msg.requestId,model:msg.model,result});}
        finally{this.chatTest=undefined;}return;
      }
      case 'testChat':{
        if(this.agent.busy||this.chatTest)throw new Error('Wait for the current operation to finish.');const controller=new AbortController();this.chatTest=controller;const started=Date.now();
        try{const client=await this.providers.client(msg.model.providerId);const answer=await client.chat(msg.model.modelId,'Connection test. Reply only OK.',[{role:'user',content:'Reply OK.'}],controller.signal,{tokens:4096,output:64});this.post(target,{type:'chatTestResult',requestId:msg.requestId,ok:true,elapsed:Date.now()-started,message:answer.slice(0,500),protocol:'Chat (no tools)'});}
        catch(e){this.post(target,{type:'chatTestResult',requestId:msg.requestId,ok:false,elapsed:Date.now()-started,message:controller.signal.aborted?'Test cancelled.':(e as Error).message,protocol:'Chat (no tools)'});}
        finally{this.chatTest=undefined;}return;
      }
      case 'setExecution':await this.providers.setExecution(msg.execution);break;
      case 'setToolProtocol': if(this.agent.busy)throw new Error('Stop the task before changing tool protocol.');await this.providers.setToolProtocol(msg.model,msg.protocol);break;
      case 'setContext': await this.providers.setContext(msg.model,msg.source,msg.tokens);break;
      case 'openSettings': this.openSettings(msg.section); success(); return;
      case 'stop': this.agent.stop(); return;
      case 'clear':
        if(this.agent.busy) throw new Error('Aguarde a tarefa terminar.');
        await this.providers.applyMode(msg.mode); await this.state(); this.agent.clear(); return;
      case 'start':
        if(target.kind !== 'chat') throw new Error('Inicie a tarefa pela conversa.');
        this.routes.set(msg.requestId,target);
        try { const attached=this.attachments.peek();await this.agent.start(msg,attached); } finally { this.routes.delete(msg.requestId); }
        return;
      case 'applyMode':
        if(this.agent.busy) throw new Error('Aguarde a tarefa terminar para trocar de modo.');
        await this.providers.applyMode(msg.mode);const selectedMode=this.providers.preferences().selected;if(selectedMode)await this.providers.ensureLimits(selectedMode);break;
      case 'setDefaultModel': await this.providers.setDefault(msg.mode,msg.model); break;
      case 'setConversation': await this.providers.setConversation(msg.patch); break;
      case 'saveProvider': {
        if(this.agent.busy||this.chatTest) throw new Error('Wait for the current operation before editing connections.');
        const id=await this.providers.save(msg.provider); await this.state(); success('Conexão salva.',id);
        await this.providers.refresh(id,msg.requestId,()=>this.state()); return;
      }
      case 'testProvider': success(`Conexão testada: ${await this.providers.test(msg.provider)} modelos no catálogo. Isso não comprova suporte ao chat.`); return;
      case 'removeProvider':
        if(this.agent.busy||this.chatTest) throw new Error('Wait for the current operation before removing connections.');
        await this.providers.remove(msg.id); await this.state(); success('Conexão removida.'); return;
      case 'refreshModels': await this.providers.refresh(msg.id,msg.requestId,()=>this.state()); success(); return;
      case 'selectModel':
        if(this.agent.busy) throw new Error('Aguarde a tarefa terminar para trocar o modelo.');
        await this.providers.setSelection(msg.model);await this.state();success();if(msg.model){await this.providers.inspect(msg.model);await this.state();}return;
      case 'favoriteModel': await this.providers.favorite(msg.model,msg.favorite); break;
      case 'manualModel':
        if(this.agent.busy&&msg.remove)throw new Error('Aguarde a tarefa terminar para remover modelos.');
        await this.providers.manual(msg.model,msg.remove); break;
    }
    await this.state(); success();
  }
}
