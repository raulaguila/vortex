import {defaults, Kind, Provider} from './providers';
import {Mode,Permission,isMode,isPermission} from './policy';

export interface ModelRef { providerId: string; modelId: string }
export type ChatMode = Mode;
export interface ConversationPreferences { language: 'pt' | 'en' | 'es' | 'auto'; uiLanguage: 'en' | 'pt'; fontSize: number | null; sendKey: 'enter' | 'modifierEnter' }
export interface Preferences { selected: ModelRef | null; favorites: ModelRef[]; manualModels: ModelRef[]; defaults: Record<ChatMode, ModelRef | null>; conversation: ConversationPreferences; context: Record<string, {source: 'api' | 'custom'; tokens: number}> }
export const defaultConversation = (): ConversationPreferences => ({language: 'auto', uiLanguage: 'en', fontSize: null, sendKey: 'enter'});
export interface ProviderInput { id?: string; name: string; kind: Kind; baseUrl: string; key: string; clearKey: boolean; tlsInsecure?: boolean }
export interface Catalog { status: 'idle' | 'loading' | 'ready' | 'error'; models: string[]; error?: string; requestId?: string }
export interface Connection extends Provider { hasKey: boolean; catalog: Catalog }
export interface ModelLimits { input: number | null; output: number | null; status: 'ready' | 'unknown'; error?: string }
export interface ChecklistItem { id: string; text: string; status: 'pending' | 'running' | 'done' }
export interface SessionSummary { id: string; title: string; updatedAt: number }
export interface SettingsState { contextBudgets?: Record<string,{tokens:number;output:number;source:string}>; selectedContext?: {model:ModelRef;tokens:number;output:number;source:string} | null; providers: Connection[]; preferences: Preferences; limits: Record<string, ModelLimits> }
export interface AgentEvent { role: 'user' | 'assistant' | 'activity'; text: string; timestamp?: number }
export type Request = (
  | { type: 'ready'; legacySelection?: ModelRef }
  | { type: 'saveProvider' | 'testProvider'; provider: ProviderInput }
  | { type: 'removeProvider' | 'refreshModels'; id: string }
  | { type: 'selectModel'; model: ModelRef | null }
  | { type: 'favoriteModel'; model: ModelRef; favorite: boolean }
  | { type: 'manualModel'; model: ModelRef; remove: boolean }
  | { type: 'start'; prompt: string; model: ModelRef; mode: Mode; permission: Permission }
  | { type: 'openSettings'; section?: 'providers' | 'models' | 'conversation' }
  | { type: 'setDefaultModel'; mode: ChatMode; model: ModelRef | null }
  | { type: 'applyMode'; mode: ChatMode }
  | { type: 'setConversation'; patch: Partial<ConversationPreferences> }
  | { type: 'clear'; mode: ChatMode }
  | { type: 'refreshAllModels' }
  | { type: 'modelInfo'; model: ModelRef }
  | { type: 'setContext'; model: ModelRef; source: 'api' | 'custom'; tokens: number }
  | { type: 'listSessions'; query: string }
  | { type: 'loadSession' | 'deleteSession'; id: string }
  | { type: 'openLink'; url: string }
  | { type: 'copyText'; text: string }
  | { type: 'stop' }
) & { requestId: string };
export type Response =
  | { type: 'state'; state: SettingsState; busy: boolean }
  | { type: 'result'; requestId: string; ok: boolean; message?: string; providerId?: string }
  | { type: 'history'; events: AgentEvent[]; busy: boolean; status: string }
  | { type: 'event'; event: AgentEvent }
  | { type: 'checklist'; items: ChecklistItem[] }
  | { type: 'context'; model?: ModelRef; used: number; budget: number; removed: number; source: string }
  | { type: 'sessions'; sessions: SessionSummary[]; requestId: string }
  | { type: 'sessionLoaded'; mode: Mode; permission: Permission; model: ModelRef }

  | { type: 'settingsSection'; section: 'providers' | 'models' | 'conversation' }
  | { type: 'accepted'; requestId: string }
  | { type: 'runEnd'; requestId: string; status: 'complete' | 'error' | 'stopped' }
  | { type: 'status'; busy: boolean; text: string };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max && v.trim().length > 0;
export function isModelRef(v: unknown): v is ModelRef {
  return record(v) && string(v.providerId) && string(v.modelId);
}
function isProvider(v: unknown): v is ProviderInput {
  return record(v) && (v.id === undefined || string(v.id)) && string(v.name, 80)
    && typeof v.kind === 'string' && Object.hasOwn(defaults, v.kind)
    && string(v.baseUrl, 2048) && typeof v.key === 'string' && v.key.length <= 8192 && typeof v.clearKey === 'boolean'
    && (v.tlsInsecure === undefined || typeof v.tlsInsecure === 'boolean');
}
export function parseRequest(v: unknown): Request {
  if (!record(v) || !string(v.requestId, 100)) throw new Error('Mensagem inválida.');
  let valid = false;
  switch (v.type) {
    case 'ready': valid = v.legacySelection === undefined || isModelRef(v.legacySelection); break;
    case 'saveProvider': case 'testProvider': valid = isProvider(v.provider); break;
    case 'removeProvider': case 'refreshModels': valid = string(v.id); break;
    case 'selectModel': valid = v.model === null || isModelRef(v.model); break;
    case 'favoriteModel': valid = isModelRef(v.model) && typeof v.favorite === 'boolean'; break;
    case 'manualModel': valid = isModelRef(v.model) && typeof v.remove === 'boolean'; break;
    case 'start': valid = string(v.prompt, 100000) && isModelRef(v.model) && isMode(v.mode) && isPermission(v.permission); break;
    case 'openSettings': valid = v.section === undefined || ['providers','models','conversation'].includes(String(v.section)); break;
    case 'setDefaultModel': valid = ['ask','plan','agent'].includes(String(v.mode)) && (v.model === null || isModelRef(v.model)); break;
    case 'clear': case 'applyMode': valid = ['ask','plan','agent'].includes(String(v.mode)); break;
    case 'setConversation': valid = isConversationPatch(v.patch); break;
    case 'openLink': valid = typeof v.url === 'string' && /^https?:\/\//.test(v.url) && v.url.length < 4096; break;
    case 'copyText': valid = string(v.text,100000); break;
    case 'modelInfo': valid = isModelRef(v.model); break;
    case 'setContext': valid = isModelRef(v.model) && ['api','custom'].includes(String(v.source)) && typeof v.tokens === 'number' && Number.isInteger(v.tokens) && v.tokens >= 1024 && v.tokens <= 10000000; break;
    case 'listSessions': valid = typeof v.query === 'string' && v.query.length <= 200; break;
    case 'loadSession': case 'deleteSession': valid = string(v.id,100); break;
    case 'stop': case 'refreshAllModels': valid = true; break;
  }
  if (!valid) throw new Error('Mensagem inválida. Verifique os campos e tente novamente.');
  return v as Request;
}
export const sameModel = (a: ModelRef | null, b: ModelRef | null): boolean => !!a && !!b && a.providerId === b.providerId && a.modelId === b.modelId;

export function isConversationPatch(v: unknown): v is Partial<ConversationPreferences> {
  if (!record(v) || !Object.keys(v).length || Object.keys(v).some(k => !['language','uiLanguage','fontSize','sendKey'].includes(k))) return false;
  return (!Object.hasOwn(v,'uiLanguage') || ['en','pt'].includes(String(v.uiLanguage)))
    && (!Object.hasOwn(v,'language') || ['pt','en','es','auto'].includes(String(v.language)))
    && (!Object.hasOwn(v,'sendKey') || ['enter','modifierEnter'].includes(String(v.sendKey)))
    && (!Object.hasOwn(v,'fontSize') || v.fontSize === null || typeof v.fontSize === 'number' && Number.isInteger(v.fontSize) && v.fontSize >= 11 && v.fontSize <= 20);
}
