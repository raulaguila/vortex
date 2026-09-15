import {defaults, Kind, Provider} from './providers';
import {Mode,Permission,isMode,isPermission} from './policy';

export interface ModelRef { providerId: string; modelId: string }
export type ChatMode = Mode;
export interface ConversationPreferences { language: 'pt' | 'en' | 'es' | 'auto'; uiLanguage: 'en' | 'pt'; fontSize: number | null; sendKey: 'enter' | 'modifierEnter' }
export interface ExecutionPreferences {maxSteps:number;commandTimeout:number;taskTimeout:number;tokenBudget:number|null}
export const defaultExecution=():ExecutionPreferences=>({maxSteps:20,commandTimeout:60,taskTimeout:1800,tokenBudget:null});
export interface Preferences { execution?:ExecutionPreferences; toolProtocols?: Record<string,'auto'|'native'|'compatibility'>; selected: ModelRef | null; favorites: ModelRef[]; manualModels: ModelRef[]; defaults: Record<ChatMode, ModelRef | null>; conversation: ConversationPreferences; context: Record<string, {source: 'api' | 'custom'; tokens: number}> }
export const defaultConversation = (): ConversationPreferences => ({language: 'auto', uiLanguage: 'en', fontSize: null, sendKey: 'enter'});
export interface ProviderInput { id?: string; name: string; kind: Kind; baseUrl: string; key: string; clearKey: boolean; tlsInsecure?: boolean }
export interface Catalog { status: 'idle' | 'loading' | 'ready' | 'error'; models: string[]; error?: string; requestId?: string }
export interface Connection extends Provider { hasKey: boolean; catalog: Catalog }
export interface ModelLimits { tools?: boolean; input: number | null; output: number | null; status: 'ready' | 'unknown'; error?: string }
export interface ChecklistItem { id: string; text: string; status: 'pending' | 'running' | 'done' }
export interface SessionSummary { id: string; title: string; updatedAt: number }
export interface SettingsState {effectiveProtocols?:Record<string,'native'|'compatibility'>; contextBudgets?: Record<string,{tokens:number;output:number;source:string}>; selectedContext?: {model:ModelRef;tokens:number;output:number;source:string} | null; providers: Connection[]; preferences: Preferences; limits: Record<string, ModelLimits> }
export interface AgentEvent { role: 'user' | 'assistant' | 'activity'; text: string; timestamp?: number; durationMs?: number }
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
  | {type:'setExecution';execution:ExecutionPreferences}
  | {type:'attachContext'|'setupSandbox'}
  | {type:'removeContext';id:string}
  | {type:'resume'|'implementPlan'|'reviewChanges'|'undoChanges'}
  | {type:'setToolProtocol';model:ModelRef;protocol:'auto'|'native'|'compatibility'}
  | { type: 'setContext'; model: ModelRef; source: 'api' | 'custom'; tokens: number }
  | { type: 'listSessions'; query: string;offset?:number }
  | { type: 'loadSession' | 'deleteSession'; id: string }
  | { type: 'openLink'; url: string }
  | { type: 'copyText'; text: string }
  | { type: 'stop' }
) & { requestId: string };
export type Response =
  | {type:'usage';model:ModelRef;input:number;output:number}
  | {type:'attachments';items:{id:string;label:string;path?:string}[]}
  | {type:'stream';id:string;text:string;done:boolean}
  | {type:'toolProgress';id:string;name:string;status:string;elapsed?:number}
  | { type: 'state'; state: SettingsState; busy: boolean }
  | { type: 'result'; requestId: string; ok: boolean; message?: string; providerId?: string }
  | { type: 'history'; events: AgentEvent[]; busy: boolean; status: string }
  | { type: 'event'; event: AgentEvent }
  | { type: 'checklist'; items: ChecklistItem[] }
  | { type: 'context'; model?: ModelRef; used: number; budget: number; removed: number; source: string }
  | { type: 'sessions'; sessions: SessionSummary[]; requestId: string;offset?:number;hasMore?:boolean }
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
    case 'attachContext':case 'setupSandbox':valid=true;break;
    case 'removeContext':valid=string(v.id);break;
    case 'resume':case 'implementPlan':case 'reviewChanges':case 'undoChanges':valid=true;break;
    case 'setExecution': {const e=v.execution;valid=record(e)&&Number.isInteger(e.maxSteps)&&Number(e.maxSteps)>=1&&Number(e.maxSteps)<=200&&Number.isInteger(e.commandTimeout)&&Number(e.commandTimeout)>=1&&Number(e.commandTimeout)<=3600&&Number.isInteger(e.taskTimeout)&&Number(e.taskTimeout)>=1&&Number(e.taskTimeout)<=86400&&(e.tokenBudget===null||Number.isSafeInteger(e.tokenBudget)&&Number(e.tokenBudget)>=1024);break;}
    case 'setToolProtocol': valid=isModelRef(v.model)&&['auto','native','compatibility'].includes(String(v.protocol));break;
    case 'modelInfo': valid = isModelRef(v.model); break;
    case 'setContext': valid = isModelRef(v.model) && ['api','custom'].includes(String(v.source)) && typeof v.tokens === 'number' && Number.isInteger(v.tokens) && v.tokens >= 1024 && v.tokens <= 10000000; break;
    case 'listSessions': valid = typeof v.query === 'string' && v.query.length <= 200&&(v.offset===undefined||Number.isSafeInteger(v.offset)&&Number(v.offset)>=0); break;
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
