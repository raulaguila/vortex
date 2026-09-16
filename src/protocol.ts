import type {PlanState} from './plan';
import {defaults, Kind, Provider} from './providers';
import {Mode,Permission,isMode,isPermission} from './policy';

export interface ModelRef { providerId: string; modelId: string }
export type ChatMode = Mode;
export interface ConversationPreferences { language: 'pt' | 'en' | 'es' | 'auto'; uiLanguage: 'en' | 'pt'; fontSize: number | null; sendKey: 'enter' | 'modifierEnter' }
import {ExecutionPreferences,ModelTimeouts,validExecution,validTimeouts} from './execution';
export {ExecutionPreferences,defaultExecution} from './execution';
export type SettingsSection='providers'|'models'|'conversation'|'execution'|'diagnostics';
export type ModelSettings=Pick<Preferences,'defaults'|'favorites'|'manualModels'|'context'|'toolProtocols'|'outputTokens'>;
export interface Preferences {storage?:{retentionDays:0|30|90|180}; outputTokens?:Record<string,number|null>; schemaVersion?:number; execution?:ExecutionPreferences; toolProtocols?: Record<string,'auto'|'native'|'compatibility'>; selected: ModelRef | null; favorites: ModelRef[]; manualModels: ModelRef[]; defaults: Record<ChatMode, ModelRef | null>; conversation: ConversationPreferences; context: Record<string, {source: 'api' | 'custom'; tokens: number}> }
export const defaultConversation = (): ConversationPreferences => ({language: 'auto', uiLanguage: 'en', fontSize: null, sendKey: 'enter'});
export interface ProviderInput { id?: string; name: string; kind: Kind; baseUrl: string; key: string; clearKey: boolean; tlsInsecure?: boolean; timeouts?:ModelTimeouts|null }
export interface Catalog { status: 'idle' | 'loading' | 'ready' | 'error'; models: string[]; error?: string; requestId?: string }
export interface Connection extends Provider { hasKey: boolean; catalog: Catalog }
export interface ModelLimits { tools?: boolean; input: number | null; output: number | null; status: 'ready' | 'unknown'; error?: string }
export interface ChecklistItem { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }
export interface SessionSummary { id: string; title: string; updatedAt: number }
export interface SettingsState {diagnosticVersions?:Record<string,string>;effectiveProtocols?:Record<string,'native'|'compatibility'>; contextBudgets?: Record<string,{tokens:number;output:number;source:string}>; selectedContext?: {model:ModelRef;tokens:number;output:number;source:string} | null; providers: Connection[]; preferences: Preferences; limits: Record<string, ModelLimits> }
export interface ActivityData {plan?:{planId:string;version:number;stepId:string;attempt:number};operation?:import('./operation').OperationState;sessionId?:string;outputRef?:string;truncated?:boolean;runId:string;id:string;name:string;path?:string;status:'success'|'error'|'denied'|'recovered'|'cancelled'|'uncertain';output:string;startedAt:number;endedAt:number}
export type RunPhase='validating_step'|'preparing'|'context'|'waiting_model'|'receiving'|'compacting'|'approval'|'question'|'tool'|'summarizing'|'finishing'|'recovering';
export interface RunProgress {runId:string;phase:RunPhase;startedAt:number;phaseStartedAt:number;tool?:{id:string;name:string;path?:string}}
export interface AgentEvent { interactionId?:string; failureCode?:string; activity?:ActivityData; incomplete?:boolean; role: 'user' | 'assistant' | 'activity'; text: string; timestamp?: number; durationMs?: number }
export type Interaction = {id:string;runId:string} & (
  | {kind:'approval';operation:'create'|'edit'|'delete'|'command'|'network';path?:string;detail?:string;preview:boolean;hunks?:{label:string;diff:string}[]}
  | {kind:'question';question:string;options?:string[];recommended_option?:string}
);
export type InteractionReply = {id:string;decision:'approve'|'reject'|'answer'|'preview';answer?:string;hunks?:number[]};
export interface DialogSpec {id:string;kind:'confirm'|'pick'|'input'|'notice'|'progress';title:string;detail?:string;accept?:string;value?:string;choices?:{id:string;label:string;description?:string}[]}
export interface DialogReply {id:string;value:string|null}
export type Request = (
  | {type:'structureLegacyPlan';sessionId:string}
  | {type:'approvePlan';sessionId:string;planId:string;version:number;permission:Permission}
  | {type:'reviewStep';sessionId:string;planId:string;version:number;stepId:string;attempt:number;decision:'confirm'|'correct';comment:string}
  | {type:'resumePlan';sessionId:string;planId:string;version:number;stepId?:string;attempt?:number}
  | {type:'revisePlan';sessionId:string;planId:string;version:number;instruction:string}
  | ({type:'respondDialog'} & DialogReply)
  | ({type:'respondInteraction'} & InteractionReply)
  | {type:'openActivityOutput';sessionId:string;activityId:string}
  | {type:'recoveryInfo'}
  | {type:'recoverSession';id:string;kind:'backup'|'lock'}
  | { type: 'ready'; legacySelection?: ModelRef }
  | { type: 'saveProvider' | 'testProvider'; provider: ProviderInput }
  | { type: 'removeProvider' | 'refreshModels'; id: string }
  | { type: 'selectModel'; model: ModelRef | null }
  | { type: 'favoriteModel'; model: ModelRef; favorite: boolean }
  | { type: 'manualModel'; model: ModelRef; remove: boolean }
  | { type: 'start'; prompt: string; model: ModelRef; mode: Mode; permission: Permission }
  | { type: 'openSettings'; section?: SettingsSection }
  | { type: 'setDefaultModel'; mode: ChatMode; model: ModelRef | null }
  | { type: 'applyMode'; mode: ChatMode }
  | { type: 'setConversation'; patch: Partial<ConversationPreferences> }
  | { type: 'clear'; mode: ChatMode }
  | { type: 'refreshAllModels' }
  | { type: 'modelInfo'; model: ModelRef }
  | {type:'setExecution';execution:ExecutionPreferences}
  | {type:'saveModels';settings:ModelSettings}
  | {type:'testChat'|'testTools';model:ModelRef}
  | {type:'storageInfo'|'cleanupStorage'}
  | {type:'setStorage';retentionDays:0|30|90|180}
  | {type:'cancelTestChat'|'traceInfo'|'openTrace'|'exportTrace'|'clearTrace'|'retry'}
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
  | {type:'planState';sessionId:string;plan:PlanState|null;legacy:boolean}
  | {type:'dialog';dialog:DialogSpec|null}
  | {type:'interaction';interaction:Interaction|null}
  | {type:'recoveryInfo';items:{id:string;kind:'backup'|'lock'}[]}
  | {type:'persistenceState';failed:boolean}
  | {type:'activityUpdate';activity:ActivityData}
  | {type:'storageInfo';bytes:number;sessions:number;retentionDays:0|30|90|180}
  | {type:'commandOutput';runId:string;id:string;stream:'stdout'|'stderr';text:string}
  | {type:'runProgress';progress:RunProgress}
  | {type:'runFailure';code:string;message:string;retryable:boolean}
  | {type:'traceInfo';path:string;bytes:number;exists:boolean}
  | {type:'toolsTestResult';requestId:string;model:ModelRef;result:import('./modelProbe').ProbeResult}
  | {type:'chatTestResult';requestId:string;ok:boolean;elapsed:number;message:string;protocol:string}
  | {type:'usage';model:ModelRef;input:number;output:number}
  | {type:'attachments';items:{id:string;label:string;path?:string}[]}
  | {type:'stream';id:string;text:string;done:boolean;incomplete?:boolean}
  | {type:'taskState';resume:boolean;implementPlan:boolean;reviewChanges:boolean;undoChanges:boolean}
  | {type:'toolProgress';runId?:string;id:string;name:string;status:string;elapsed?:number}
  | { type: 'state'; state: SettingsState; busy: boolean }
  | { type: 'result'; requestId: string; ok: boolean; message?: string; providerId?: string }
  | { type: 'history'; events: AgentEvent[]; busy: boolean; status: string }
  | { type: 'event'; event: AgentEvent }
  | { type: 'checklist'; items: ChecklistItem[] }
  | { type: 'context'; model?: ModelRef; used: number; budget: number; removed: number; source: string }
  | { type: 'sessions'; sessions: SessionSummary[]; requestId: string;offset?:number;hasMore?:boolean }
  | { type: 'sessionLoaded'; readOnly?:boolean;mode: Mode; permission: Permission; model: ModelRef }

  | { type: 'settingsSection'; section: SettingsSection }
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
    && (v.tlsInsecure === undefined || typeof v.tlsInsecure === 'boolean') && (v.timeouts==null||validTimeouts(v.timeouts));
}
export function parseRequest(v: unknown): Request {
  if (!record(v) || !string(v.requestId, 100)) throw new Error('Mensagem inválida.');
  let valid = false;
  switch (v.type) {
    case 'structureLegacyPlan':valid=string(v.sessionId,100);break;
    case 'approvePlan':valid=string(v.sessionId,100)&&string(v.planId,100)&&Number.isSafeInteger(v.version)&&Number(v.version)>0&&isPermission(v.permission);break;
    case 'resumePlan':case 'reviewStep':valid=string(v.sessionId,100)&&string(v.planId,100)&&Number.isSafeInteger(v.version)&&Number(v.version)>0&&(v.type==='resumePlan'&&v.stepId===undefined&&v.attempt===undefined||string(v.stepId,80)&&Number.isSafeInteger(v.attempt)&&Number(v.attempt)>0)&&(v.type==='resumePlan'||['confirm','correct'].includes(String(v.decision))&&typeof v.comment==='string'&&v.comment.length<=4000&&(v.decision==='confirm'||!!v.comment.trim()));break;
    case 'revisePlan':valid=string(v.sessionId,100)&&string(v.planId,100)&&Number.isSafeInteger(v.version)&&Number(v.version)>0&&string(v.instruction,4000);break;
    case 'respondDialog':valid=string(v.id,100)&&(v.value===null||typeof v.value==='string'&&v.value.length<=4096);break;
    case 'respondInteraction':valid=string(v.id,100)&&['approve','reject','answer','preview'].includes(String(v.decision))&&(v.answer===undefined||string(v.answer,4000))&&(v.hunks===undefined||Array.isArray(v.hunks)&&v.hunks.length<=100&&v.hunks.every(n=>Number.isSafeInteger(n)&&n>=0)&&new Set(v.hunks).size===v.hunks.length)&&(v.decision==='answer'?string(v.answer,4000)&&v.hunks===undefined:v.answer===undefined)&&(v.hunks===undefined||v.decision==='approve');break;
    case 'openActivityOutput':valid=string(v.sessionId,100)&&string(v.activityId,100);break;
    case 'recoveryInfo':valid=true;break;
    case 'recoverSession':valid=string(v.id,100)&&['backup','lock'].includes(String(v.kind));break;
    case 'ready': valid = v.legacySelection === undefined || isModelRef(v.legacySelection); break;
    case 'saveProvider': case 'testProvider': valid = isProvider(v.provider); break;
    case 'removeProvider': case 'refreshModels': valid = string(v.id); break;
    case 'selectModel': valid = v.model === null || isModelRef(v.model); break;
    case 'favoriteModel': valid = isModelRef(v.model) && typeof v.favorite === 'boolean'; break;
    case 'manualModel': valid = isModelRef(v.model) && typeof v.remove === 'boolean'; break;
    case 'start': valid = string(v.prompt, 100000) && isModelRef(v.model) && isMode(v.mode) && isPermission(v.permission); break;
    case 'openSettings': valid = v.section === undefined || ['providers','models','conversation','execution','diagnostics'].includes(String(v.section)); break;
    case 'setDefaultModel': valid = ['ask','plan','agent'].includes(String(v.mode)) && (v.model === null || isModelRef(v.model)); break;
    case 'clear': case 'applyMode': valid = ['ask','plan','agent'].includes(String(v.mode)); break;
    case 'setConversation': valid = isConversationPatch(v.patch); break;
    case 'openLink': valid = typeof v.url === 'string' && /^https?:\/\//.test(v.url) && v.url.length < 4096; break;
    case 'copyText': valid = string(v.text,100000); break;
    case 'attachContext':case 'setupSandbox':valid=true;break;
    case 'removeContext':valid=string(v.id);break;
    case 'resume':case 'implementPlan':case 'reviewChanges':case 'undoChanges':valid=true;break;
    case 'setExecution': valid=validExecution(v.execution);break;
    case 'saveModels': valid=isModelSettings(v.settings);break;
    case 'storageInfo':case 'cleanupStorage':valid=true;break;
    case 'setStorage':valid=[0,30,90,180].includes(Number(v.retentionDays))&&typeof v.retentionDays==='number';break;
    case 'testChat':case 'testTools': valid=isModelRef(v.model);break;
    case 'cancelTestChat':case 'traceInfo':case 'openTrace':case 'exportTrace':case 'clearTrace':case 'retry':valid=true;break;
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

export function isModelSettings(v:any):v is ModelSettings {
 const refKey=(key:string)=>{try{const a=JSON.parse(key);return Array.isArray(a)&&a.length===2&&a.every(x=>typeof x==='string'&&x.length>0&&x.length<=500);}catch{return false;}};
 return record(v)&&(v.outputTokens===undefined||record(v.outputTokens)&&Object.entries(v.outputTokens).every(([k,n])=>refKey(k)&&(n===null||Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<10000000)))&&record(v.defaults)&&['ask','plan','agent'].every(k=>(v.defaults as any)[k]===null||isModelRef((v.defaults as any)[k]))&&Array.isArray(v.favorites)&&v.favorites.every(isModelRef)&&Array.isArray(v.manualModels)&&v.manualModels.every(isModelRef)&&record(v.context)&&Object.entries(v.context).every(([k,c]:any)=>refKey(k)&&record(c)&&['api','custom'].includes(String(c.source))&&Number.isSafeInteger(c.tokens)&&Number(c.tokens)>=1024&&Number(c.tokens)<=10000000)&&(v.toolProtocols===undefined||record(v.toolProtocols)&&Object.entries(v.toolProtocols).every(([k,p])=>refKey(k)&&['auto','native','compatibility'].includes(p as string)));
}
