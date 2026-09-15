import {randomUUID} from 'node:crypto';
import {Client, Provider, validateUrl} from './providers';
import {Catalog, ModelRef, Preferences, ProviderInput, SettingsState, sameModel, ChatMode, ConversationPreferences, defaultConversation, ModelLimits} from './protocol';

export interface Store { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): Thenable<void> | Promise<void> }
export interface Secrets { get(key: string): Thenable<string | undefined> | Promise<string | undefined>; store(key: string, value: string): Thenable<void> | Promise<void>; delete(key: string): Thenable<void> | Promise<void> }
const emptyPreferences = (): Preferences => ({selected: null, favorites: [], manualModels: [], defaults: {ask: null, plan: null, agent: null}, conversation: defaultConversation(), context: {}});
export class ProviderManager {
  private prefsCache?: Preferences;
  private providersCache?: Provider[];
  private connectionRevisions = new Map<string,number>();
  private limitVersions = new Map<string, number>();
  private limits = new Map<string, ModelLimits>();
  private catalogs = new Map<string, Catalog>();
  private versions = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: Store, private secrets: Secrets, private transport: typeof fetch = fetch) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation); this.queue = pending.catch(() => undefined); return pending;
  }
  providers(): Provider[] { if(!this.providersCache)this.providersCache=this.storage.get<Provider[]>('providers', []);return structuredClone(this.providersCache); }
  preferences(): Preferences {
    if(this.prefsCache) return structuredClone(this.prefsCache);
    const fallback = emptyPreferences();
    const stored = this.storage.get<Partial<Preferences>>('modelPreferences', {});
    this.prefsCache={...fallback, ...stored, defaults: {...fallback.defaults, ...stored.defaults}, conversation: {...fallback.conversation, ...stored.conversation}};
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
    return {selectedContext:selected?{model:selected,...this.contextBudget(selected)}:null,contextBudgets,limits:Object.fromEntries(this.limits),providers,preferences};
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
  async client(id: string): Promise<Client> { const p = this.find(id); return new Client(p, await this.secrets.get('key:' + id) || '', this.transport); }
  private async resolve(input: ProviderInput): Promise<{provider: Provider; key: string}> {
    const existing = input.id ? this.find(input.id) : undefined;
    if (input.clearKey && !['ollama','compatible'].includes(input.kind)) throw new Error('Este provedor exige uma API key.');
    const saved = existing ? await this.secrets.get('key:' + existing.id) || '' : '';
    // Changing provider type must never silently forward an existing provider's credential.
    if (existing && existing.kind !== input.kind && !input.key.trim() && saved && !input.clearKey) throw new Error('Ao mudar o tipo, informe uma nova chave ou remova a chave anterior.');
    const key = input.clearKey ? '' : input.key.trim() || saved;
    if (!key && !['ollama','compatible'].includes(input.kind)) throw new Error('Este provedor exige uma API key.');
    return {provider: {id: existing?.id || randomUUID(), name: input.name.trim(), kind: input.kind, baseUrl: validateUrl(input.baseUrl.trim()), tlsInsecure: input.kind === 'compatible' && (input.tlsInsecure ?? existing?.tlsInsecure ?? false)}, key};
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
      this.catalogs.delete(provider.id); for(const key of this.limits.keys()) if(JSON.parse(key)[0] === provider.id) this.limits.delete(key); return provider.id;
    });
  }
  async test(input: ProviderInput): Promise<number> { const {provider, key} = await this.resolve(input); return (await new Client(provider, key, this.transport).models()).length; }
  async remove(id: string): Promise<void> {
    return this.serial(async () => {
      this.find(id);const next=this.providers().filter(p=>p.id!==id);await this.storage.update('providers', next);this.providersCache=next;
      this.connectionRevisions.set(id,(this.connectionRevisions.get(id)||0)+1);
      for(const key of this.limits.keys())if(JSON.parse(key)[0]===id)this.limits.delete(key);
      this.versions.set(id, (this.versions.get(id) || 0) + 1); this.catalogs.delete(id);
      const prefs = this.preferences();
      await this.persistPreferences( {...prefs, context: Object.fromEntries(Object.entries(prefs.context).filter(([key]) => JSON.parse(key)[0] !== id)), defaults: Object.fromEntries(Object.entries(prefs.defaults).map(([mode, model]) => [mode, model?.providerId === id ? null : model])) as Preferences['defaults'], selected: prefs.selected?.providerId === id ? null : prefs.selected, favorites: prefs.favorites.filter(m => m.providerId !== id), manualModels: prefs.manualModels.filter(m => m.providerId !== id)});
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
