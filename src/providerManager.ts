import {migrateExecution} from './execution';
import {randomUUID} from 'node:crypto';
import {Client, Provider, validateUrl} from './providers';
import {Catalog, ModelRef, Preferences, ProviderInput, SettingsState, ModelSettings, sameModel, ChatMode, ConversationPreferences, defaultConversation, ModelLimits,ExecutionPreferences,defaultExecution} from './protocol';

export interface Store { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): Thenable<void> | Promise<void> }
export interface Secrets { get(key: string): Thenable<string | undefined> | Promise<string | undefined>; store(key: string, value: string): Thenable<void> | Promise<void>; delete(key: string): Thenable<void> | Promise<void> }
const emptyPreferences = (): Preferences => ({selected: null, favorites: [], manualModels: [], defaults: {ask: null, plan: null, agent: null}, conversation: defaultConversation(), context: {},execution:defaultExecution()});
export class ProviderManager {
  private prefsCache?: Preferences;
  private providersCache?: Provider[];
  private connectionRevisions = new Map<string,number>();
  private limitVersions = new Map<string, number>();
  private limits = new Map<string, ModelLimits>();
  private unsupportedTools=new Set<string>();
  private catalogs = new Map<string, Catalog>();
  private versions = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: Store, private secrets: Secrets, private transport?: typeof fetch, private log?:(record:Record<string,unknown>)=>void) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation); this.queue = pending.catch(() => undefined); return pending;
  }
  async initialize(){if(this.storage.get<any>('modelPreferences',{}).schemaVersion!==3)await this.serial(()=>this.persistPreferences(this.preferences()));}
  providers(): Provider[] { if(!this.providersCache)this.providersCache=this.storage.get<Provider[]>('providers', []).map(p=>({...p,timeouts:p.timeouts&&Number.isInteger(p.timeouts.firstResponseTimeout)&&Number.isInteger(p.timeouts.idleTimeout)&&p.timeouts.firstResponseTimeout>=1&&p.timeouts.firstResponseTimeout<=3600&&p.timeouts.idleTimeout>=1&&p.timeouts.idleTimeout<=3600?p.timeouts:null}));return structuredClone(this.providersCache); }
  preferences(): Preferences {
    if(this.prefsCache) return structuredClone(this.prefsCache);
    const fallback = emptyPreferences();
    const stored = this.storage.get<Partial<Preferences>>('modelPreferences', {});
    this.prefsCache={...fallback, ...stored, schemaVersion:3, defaults: {...fallback.defaults, ...stored.defaults}, conversation: {...fallback.conversation, ...stored.conversation},execution:migrateExecution(stored.execution)};
    return structuredClone(this.prefsCache);
  }
  private async persistPreferences(value: Preferences): Promise<void> {
    await this.storage.update('modelPreferences', value);
    this.prefsCache=structuredClone(value);
  }
  async setDefault(mode: ChatMode, model: ModelRef | null): Promise<void> {
    return this.serial(async () => { if(model) this.find(model.providerId); const prefs = this.preferences(); await this.persistPreferences( {...prefs, defaults: {...prefs.defaults, [mode]: model}}); });
  }
  async applyMode(mode: ChatMode): Promise<void> {
    return this.serial(async () => { const prefs = this.preferences(); const model = prefs.defaults[mode]; if(model && this.providers().some(p => p.id === model.providerId)) await this.persistPreferences( {...prefs, selected: model}); });
  }
  async saveModels(settings:ModelSettings){await this.serial(async()=>{
    const prior=this.preferences();
    for(const ref of [...settings.favorites,...settings.manualModels,...Object.values(settings.defaults).filter((r):r is ModelRef=>!!r)])this.find(ref.providerId);
    for(const [key,value]of Object.entries(settings.context)){const [id]=JSON.parse(key);this.find(id);const limit=this.limits.get(key)?.input;if(JSON.stringify(prior.context[key])===JSON.stringify(value))continue;if(value.source==='api'&&!limit)throw new Error('Discover the API limit first.');if(limit&&value.tokens>limit)throw new Error('Context exceeds the API limit.');}
    for(const key of Object.keys(settings.toolProtocols||{}))this.find(JSON.parse(key)[0]);
    const removed=prior.manualModels.filter(m=>!settings.manualModels.some(r=>sameModel(m,r))&&!this.catalogs.get(m.providerId)?.models.includes(m.modelId));
    const gone=(m:ModelRef|null)=>m&&removed.some(r=>sameModel(m,r));
    await this.persistPreferences({...prior,...settings,selected:gone(prior.selected)?null:prior.selected,favorites:settings.favorites.filter(m=>!gone(m)),defaults:Object.fromEntries(Object.entries(settings.defaults).map(([k,m])=>[k,gone(m)?null:m])) as Preferences['defaults']});
    for(const key of new Set([...Object.keys(prior.toolProtocols||{}),...Object.keys(settings.toolProtocols||{})]))if(prior.toolProtocols?.[key]!==settings.toolProtocols?.[key])this.unsupportedTools.delete(key);
  });}
  async setExecution(execution:ExecutionPreferences){await this.serial(async()=>{await this.persistPreferences({...this.preferences(),execution});});}
  async setConversation(patch: Partial<ConversationPreferences>): Promise<void> {
    return this.serial(async () => { const prefs = this.preferences(); await this.persistPreferences( {...prefs, conversation: {...prefs.conversation, ...patch}}); });
  }
  private find(id: string): Provider {
    const p = this.providers().find(p => p.id === id); if (!p) throw new Error('Conexão não encontrada. Selecione outro modelo.'); return p;
  }
  async snapshot(): Promise<SettingsState> {
    const providers=await Promise.all(this.providers().map(async p => ({...p,hasKey:!!await this.secrets.get('key:'+p.id),catalog:this.catalogs.get(p.id)||{status:'idle' as const,models:[]}})));
    const preferences=this.preferences(), selected=preferences.selected;
    const refs=[...preferences.manualModels,...(selected?[selected]:[]),...providers.flatMap(p=>p.catalog.models.map(modelId=>({providerId:p.id,modelId}))),...Array.from(this.limits.keys(),key=>{const [providerId,modelId]=JSON.parse(key);return {providerId,modelId};})];
    const contextBudgets=Object.fromEntries(refs.map(ref=>[JSON.stringify([ref.providerId,ref.modelId]),this.contextBudget(ref)]));
    return {effectiveProtocols:Object.fromEntries(refs.map(ref=>[JSON.stringify([ref.providerId,ref.modelId]),this.toolProtocol(ref)])),selectedContext:selected?{model:selected,...this.contextBudget(selected)}:null,contextBudgets,limits:Object.fromEntries(this.limits),providers,preferences};
  }

  async inspect(model: ModelRef, signal?: AbortSignal): Promise<ModelLimits> {
    const key = JSON.stringify([model.providerId, model.modelId]);
    const provider = this.find(model.providerId);const providerVersion=this.connectionRevisions.get(provider.id);
    const revision=(this.limitVersions.get(key)||0)+1;this.limitVersions.set(key,revision);
    let limits: ModelLimits;
    try { limits = await (await this.client(model.providerId)).modelInfo(model.modelId,signal); }
    catch { signal?.throwIfAborted(); limits = {input:null,output:null,status:'unknown',error:'API metadata unavailable'}; }
    if(this.limitVersions.get(key)===revision && this.connectionRevisions.get(provider.id)===providerVersion && this.providers().some(p => p.id === provider.id && p.baseUrl === provider.baseUrl)) this.limits.set(key, limits);
    return limits;
  }
  async ensureLimits(model: ModelRef, signal?: AbortSignal): Promise<void> {
    if(!this.limits.has(JSON.stringify([model.providerId,model.modelId]))) await this.inspect(model,signal);
  }
  async setContext(model: ModelRef, source: 'api' | 'custom', tokens: number): Promise<void> {
    const key = JSON.stringify([model.providerId,model.modelId]);
    const limits = this.limits.get(key) || await this.inspect(model);
    if(source === 'api' && !limits.input) throw new Error('This API does not report a context limit. Choose a custom budget.');
    if(source === 'custom' && limits.input && tokens > limits.input) throw new Error(`Maximum context: ${limits.input} tokens.`);
    await this.serial(async () => { this.find(model.providerId); const prefs=this.preferences(); await this.persistPreferences({...prefs,context:{...prefs.context,[key]:{source,tokens}}}); });
  }
  contextBudget(model: ModelRef): {tokens:number; output:number; source:string} {
    const key=JSON.stringify([model.providerId,model.modelId]);const limit=this.limits.get(key);const config=this.preferences().context[key];
    const chosen=config?.source==='custom'?config.tokens:limit?.input||16384;
    const tokens=Math.min(chosen,limit?.input||chosen);
    return {tokens,output:Math.min(4096,limit?.output||4096,Math.floor(tokens/4)),source:config?.source==='custom'?'custom':limit?.input?'api':'fallback'};
  }
  toolProtocol(model:ModelRef):'native'|'compatibility' {
    const key=JSON.stringify([model.providerId,model.modelId]);
    const chosen=this.preferences().toolProtocols?.[key]||'auto';
    if(chosen!=='auto')return chosen;
    if(this.unsupportedTools.has(key))return 'compatibility';
    const supported=this.limits.get(key)?.tools;
    if(supported!==undefined)return supported?'native':'compatibility';
    this.find(model.providerId);return 'native';
  }
  fallbackTools(model:ModelRef):boolean{const key=JSON.stringify([model.providerId,model.modelId]);if((this.preferences().toolProtocols?.[key]||'auto')!=='auto')return false;this.unsupportedTools.add(key);return true;}
  async setToolProtocol(model:ModelRef,protocol:'auto'|'native'|'compatibility') {
    await this.serial(async()=>{this.find(model.providerId);this.unsupportedTools.delete(JSON.stringify([model.providerId,model.modelId]));const p=this.preferences();await this.persistPreferences({...p,toolProtocols:{...p.toolProtocols,[JSON.stringify([model.providerId,model.modelId])]:protocol}});});
  }
  async client(id: string): Promise<Client> { const p = this.find(id); return new Client(p, await this.secrets.get('key:' + id) || '', this.transport,this.log,{...this.preferences().execution!,...p.timeouts}); }
  private async resolve(input: ProviderInput): Promise<{provider: Provider; key: string}> {
    const existing = input.id ? this.find(input.id) : undefined;
    if (input.clearKey && !['ollama','compatible'].includes(input.kind)) throw new Error('Este provedor exige uma API key.');
    const saved = existing ? await this.secrets.get('key:' + existing.id) || '' : '';
    // Changing provider type must never silently forward an existing provider's credential.
    if (existing && existing.kind !== input.kind && !input.key.trim() && saved && !input.clearKey) throw new Error('Ao mudar o tipo, informe uma nova chave ou remova a chave anterior.');
    const key = input.clearKey ? '' : input.key.trim() || saved;
    if (!key && !['ollama','compatible'].includes(input.kind)) throw new Error('Este provedor exige uma API key.');
    return {provider: {id: existing?.id || randomUUID(), name: input.name.trim(), kind: input.kind, baseUrl: validateUrl(input.baseUrl.trim()), timeouts: input.timeouts===undefined?existing?.timeouts:input.timeouts, tlsInsecure: input.kind === 'compatible' && (input.tlsInsecure ?? existing?.tlsInsecure ?? false)}, key};
  }
  async save(input: ProviderInput): Promise<string> {
    return this.serial(async () => {
      const {provider, key} = await this.resolve(input);
      const oldKey = await this.secrets.get('key:' + provider.id);
      const list = this.providers(); const index = list.findIndex(p => p.id === provider.id);
      const next = [...list]; if (index < 0) next.push(provider); else next[index] = provider;
      await this.secrets.store('key:' + provider.id, key);
      try { await this.storage.update('providers', next);this.providersCache=structuredClone(next); }
      catch (error) { if (oldKey === undefined) await this.secrets.delete('key:' + provider.id); else await this.secrets.store('key:' + provider.id, oldKey); throw error; }
      this.connectionRevisions.set(provider.id,(this.connectionRevisions.get(provider.id)||0)+1);
      this.versions.set(provider.id, (this.versions.get(provider.id) || 0) + 1);
      for(const key of this.unsupportedTools)if(JSON.parse(key)[0]===provider.id)this.unsupportedTools.delete(key);
      this.catalogs.delete(provider.id); for(const key of this.limits.keys()) if(JSON.parse(key)[0] === provider.id) this.limits.delete(key); return provider.id;
    });
  }
  async test(input: ProviderInput): Promise<number> { const {provider, key} = await this.resolve(input); return (await new Client(provider, key, this.transport,this.log).models()).length; }
  async remove(id: string): Promise<void> {
    return this.serial(async () => {
      this.find(id);const next=this.providers().filter(p=>p.id!==id);await this.storage.update('providers', next);this.providersCache=next;
      this.connectionRevisions.set(id,(this.connectionRevisions.get(id)||0)+1);
      for(const key of this.limits.keys())if(JSON.parse(key)[0]===id)this.limits.delete(key);
      this.versions.set(id, (this.versions.get(id) || 0) + 1); this.catalogs.delete(id);
      const prefs = this.preferences();
      await this.persistPreferences( {...prefs, toolProtocols:Object.fromEntries(Object.entries(prefs.toolProtocols||{}).filter(([key])=>JSON.parse(key)[0]!==id)), context: Object.fromEntries(Object.entries(prefs.context).filter(([key]) => JSON.parse(key)[0] !== id)), defaults: Object.fromEntries(Object.entries(prefs.defaults).map(([mode, model]) => [mode, model?.providerId === id ? null : model])) as Preferences['defaults'], selected: prefs.selected?.providerId === id ? null : prefs.selected, favorites: prefs.favorites.filter(m => m.providerId !== id), manualModels: prefs.manualModels.filter(m => m.providerId !== id)});
      await this.secrets.delete('key:' + id);
    });
  }
  async refresh(id: string, requestId: string, changed: () => Promise<void>): Promise<void> {
    const version = (this.versions.get(id) || 0) + 1; this.versions.set(id, version);
    const current = () => this.versions.get(id) === version && this.providers().some(p => p.id === id);
    const client = await this.client(id);
    if (!current()) return;
    const prior = this.catalogs.get(id)?.models || [];
    this.catalogs.set(id, {status: 'loading', models: prior, requestId}); await changed();
    try { const models = await client.models(); if (current()) this.catalogs.set(id, {status: 'ready', models, requestId}); }
    catch (e) { if (current()) this.catalogs.set(id, {status: 'error', models: prior, requestId, error: e instanceof Error ? e.message : 'Não foi possível consultar o catálogo.'}); }
    if (current()) await changed();
  }
  async setSelection(model: ModelRef | null): Promise<void> {
    return this.serial(async () => { if (model) this.find(model.providerId); await this.persistPreferences( {...this.preferences(), selected: model}); });
  }
  async favorite(model: ModelRef, favorite: boolean): Promise<void> {
    return this.serial(async () => { this.find(model.providerId); const p = this.preferences(); const favorites = p.favorites.filter(m => !sameModel(m, model)); if (favorite) favorites.push(model); await this.persistPreferences( {...p, favorites}); });
  }
  async manual(model: ModelRef, remove: boolean): Promise<void> {
    return this.serial(async () => {
      this.find(model.providerId); const p = this.preferences(); const manualModels = p.manualModels.filter(m => !sameModel(m, model)); if (!remove) manualModels.push(model);
      const stillListed = this.catalogs.get(model.providerId)?.models.includes(model.modelId);
      await this.persistPreferences( {...p, manualModels, defaults: Object.fromEntries(Object.entries(p.defaults).map(([mode, value]) => [mode, remove && !stillListed && sameModel(value, model) ? null : value])) as Preferences['defaults'],
        favorites: remove && !stillListed ? p.favorites.filter(m => !sameModel(m, model)) : p.favorites,
        selected: remove && !stillListed && sameModel(p.selected, model) ? null : p.selected});
    });
  }
  async migrateSelection(legacy?: ModelRef): Promise<void> {
    if (!legacy || this.storage.get<Preferences | undefined>('modelPreferences', undefined) !== undefined || !this.providers().some(p => p.id === legacy.providerId)) return;
    await this.setSelection(legacy);
  }
}
