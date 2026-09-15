import * as vscode from 'vscode';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {AgentController} from './agent';
import {ProviderManager} from './providerManager';
import {parseRequest, Request, Response} from './protocol';
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
  private snapshotVersion = 0;
  private initialized = false;
  private restored?:Promise<void>;
  private routes = new Map<string, Surface>();
  private settingsSection: 'providers' | 'models' | 'conversation' = 'providers';
  constructor(private ctx: vscode.ExtensionContext) {
    this.sessions=new SessionStore(vscode.Uri.joinPath(ctx.storageUri||ctx.globalStorageUri,'sessions').fsPath);
    this.providers = new ProviderManager(ctx.globalState, ctx.secrets);
    this.agent = new AgentController(this.providers, message => {
      if(message.type==='context')void this.state().catch(()=>undefined);
      if(message.type==='accepted'||message.type==='history')void ctx.workspaceState.update('activeSession',this.agent.activeSessionId);
      if(message.type === 'accepted' || message.type === 'runEnd') {
        const target = this.routes.get(message.requestId); if(target) this.post(target, message);
      } else for(const target of this.surfaces) if(target.kind === 'chat' || message.type === 'status') this.post(target, message);
    }, this.sessions);
  }
  dispose() { this.agent.dispose(); this.panel?.dispose(); }
  private post(target: Surface, data: Response) { if(!target.disposed) void target.webview.postMessage(data); }
  private async state() {
    const version = ++this.snapshotVersion;
    const state = await this.providers.snapshot();
    if(version === this.snapshotVersion) for(const target of this.surfaces) this.post(target, {type:'state',state,busy:this.agent.busy});
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.bind(view.webview, 'chat', listener => view.onDidDispose(listener));
  }
  openSettings(section: 'providers' | 'models' | 'conversation' = 'providers') {
    this.settingsSection = section;
    if(this.panel) {
      this.panel.reveal();
      if(this.panelSurface) this.post(this.panelSurface, {type:'settingsSection',section});
      return;
    }
    const panel = vscode.window.createWebviewPanel('vortex.settings', 'Vortex — Configurações', vscode.ViewColumn.Active, {enableScripts:true, retainContextWhenHidden:true});
    this.panel = panel;
    this.panelSurface = this.bind(panel.webview, 'settings', listener => panel.onDidDispose(listener));
    panel.onDidDispose(() => { if(this.panel === panel) {this.panel=undefined; this.panelSurface=undefined;} });
  }
  private bind(webview: vscode.Webview, kind: Surface['kind'], onDispose: (listener: () => void) => vscode.Disposable): Surface {
    const target: Surface = {webview, kind, disposed:false}; this.surfaces.add(target);
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    webview.options = {enableScripts:true,localResourceRoots:[media]};
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
    webview.html = renderSidebar(readFileSync(vscode.Uri.joinPath(media, kind === 'chat' ? 'sidebar.html' : 'settings.html').fsPath, 'utf8'), {
      cspSource:webview.cspSource, nonce:randomBytes(24).toString('hex'), style:asset(kind === 'chat' ? 'style.css' : 'settings.css'), script:asset(kind === 'chat' ? 'app.js' : 'settings.js'), logo:asset('vortex.svg'),shared:asset('shared.js'),vendor:asset('vendor.js'),picker:asset('picker.js')
    });
    const listener = webview.onDidReceiveMessage(async (raw: unknown) => {
      let msg: Request;
      try { msg=parseRequest(raw); }
      catch { this.post(target,{type:'result',requestId:typeof (raw as any)?.requestId === 'string' ? (raw as any).requestId.slice(0,100) : '',ok:false,message:'Mensagem inválida. Verifique os campos e tente novamente.'}); return; }
      try { await this.handle(target,msg); }
      catch(error) { this.post(target,{type:'result',requestId:msg.requestId,ok:false,message:error instanceof Error ? error.message : 'Não foi possível concluir a operação.'}); }
    });
    onDispose(() => { target.disposed=true; listener.dispose(); this.surfaces.delete(target); });
    return target;
  }
  private async handle(target: Surface, msg: Request): Promise<void> {
    const success = (message?: string, providerId?: string) => this.post(target,{type:'result',requestId:msg.requestId,ok:true,message,providerId});
    switch(msg.type) {
      case 'ready':
        await this.providers.migrateSelection(msg.legacySelection); await this.state();
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
      case 'listSessions': this.post(target,{type:'sessions',sessions:await this.sessions.list(msg.query),requestId:msg.requestId});return;
      case 'loadSession': await this.agent.load(msg.id); return;
      case 'deleteSession': await this.agent.removeSession(msg.id);success();return;
      case 'refreshAllModels': await Promise.all(this.providers.providers().map(p=>this.providers.refresh(p.id,msg.requestId+':'+p.id,()=>this.state())));success();return;
      case 'modelInfo': await this.providers.inspect(msg.model);await this.state();success();return;
      case 'setContext': await this.providers.setContext(msg.model,msg.source,msg.tokens);break;
      case 'openSettings': this.openSettings(msg.section); success(); return;
      case 'stop': this.agent.stop(); return;
      case 'clear':
        if(this.agent.busy) throw new Error('Aguarde a tarefa terminar.');
        await this.providers.applyMode(msg.mode); await this.state(); this.agent.clear(); return;
      case 'start':
        if(target.kind !== 'chat') throw new Error('Inicie a tarefa pela conversa.');
        this.routes.set(msg.requestId,target);
        try { await this.agent.start(msg); } finally { this.routes.delete(msg.requestId); }
        return;
      case 'applyMode':
        if(this.agent.busy) throw new Error('Aguarde a tarefa terminar para trocar de modo.');
        await this.providers.applyMode(msg.mode);const selectedMode=this.providers.preferences().selected;if(selectedMode)await this.providers.ensureLimits(selectedMode);break;
      case 'setDefaultModel': await this.providers.setDefault(msg.mode,msg.model); break;
      case 'setConversation': await this.providers.setConversation(msg.patch); break;
      case 'saveProvider': {
        if(this.agent.busy) throw new Error('Aguarde a tarefa terminar para editar conexões.');
        const id=await this.providers.save(msg.provider); await this.state(); success('Conexão salva.',id);
        await this.providers.refresh(id,msg.requestId,()=>this.state()); return;
      }
      case 'testProvider': success(`Conexão testada: ${await this.providers.test(msg.provider)} modelos no catálogo. Isso não comprova suporte ao chat.`); return;
      case 'removeProvider':
        if(this.agent.busy) throw new Error('Aguarde a tarefa terminar para remover conexões.');
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
