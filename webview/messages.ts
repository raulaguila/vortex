import type {Response} from '../src/protocol';
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown)=>typeof v==='string';const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
const bool=(v:unknown)=>typeof v==='boolean';const array=(v:unknown)=>Array.isArray(v)&&v.length<=10000;
const model=(v:unknown)=>record(v)&&str(v.providerId)&&str(v.modelId);
const activity=(v:unknown)=>record(v)&&str(v.runId)&&str(v.id)&&str(v.name)&&str(v.output)&&num(v.startedAt)&&num(v.endedAt)&&(v.operation===undefined||record(v.operation)&&str(v.operation.id)&&str(v.operation.path)&&['not_applied','applied','partial','uncertain'].includes(v.operation.outcome)&&['prepared','applying','applied','saved','recorded'].includes(v.operation.phase))&&(v.truncated===undefined||bool(v.truncated))&&(v.sessionId===undefined||str(v.sessionId))&&(v.outputRef===undefined||str(v.outputRef))&&['success','error','denied','recovered','cancelled','uncertain'].includes(v.status);
const event=(v:unknown)=>record(v)&&['user','assistant','activity'].includes(v.role)&&str(v.text)&&(v.interactionId===undefined||str(v.interactionId))&&(v.activity===undefined||activity(v.activity));
/** Validate the webview boundary before touching DOM or persistent draft state. */
export function isHostResponse(v:unknown):v is Response {
 if(!record(v)||!str(v.type))return false;
 switch(v.type){
 case 'planState':{
  if(!str(v.sessionId)||!bool(v.legacy))return false;const p=v.plan;if(p===null)return true;
  if(!record(p)||!str(p.plan_id)||!num(p.version)||!str(p.objective)||!['proposed','running','paused','completed'].includes(p.status)||!array(p.steps)||p.steps.length>50||!array(p.executions)||p.executions.length!==p.steps.length)return false;
  if(!p.steps.every(s=>record(s)&&str(s.id)&&str(s.title)&&str(s.objective)&&array(s.depends_on)&&s.depends_on.every(str)&&array(s.criteria)&&s.criteria.every(c=>record(c)&&str(c.id)&&str(c.description)&&['command','human'].includes(c.verification))))return false;
  return p.executions.every((e:any,i:number)=>{
   if(!record(e)||e.id!==p.steps[i].id||!['pending','running','validating','completed','waiting_user','blocked','failed','interrupted'].includes(e.status)||!array(e.attempts))return false;
   return e.attempts.every(a=>record(a)&&num(a.number)&&array(a.criteria)&&a.criteria.every(c=>record(c)&&str(c.id)&&str(c.reason)&&str(c.status))&&array(a.evidence)&&a.evidence.every(r=>record(r)&&str(r.tool)&&str(r.status)&&(r.command===undefined||record(r.command)&&str(r.command.output))));
  });
 }
 case 'dialog':{const d=v.dialog;return d===null||record(d)&&str(d.id)&&['confirm','pick','input','notice','progress'].includes(d.kind)&&str(d.title)&&(d.detail===undefined||str(d.detail))&&(d.accept===undefined||str(d.accept))&&(d.value===undefined||str(d.value))&&(d.choices===undefined||array(d.choices)&&d.choices.every(c=>record(c)&&str(c.id)&&str(c.label)&&(c.description===undefined||str(c.description))));}
 case 'interaction':{const i=v.interaction;if(i===null)return true;if(!record(i)||!str(i.id)||!str(i.runId))return false;return i.kind==='question'?str(i.question)&&i.question.length<=1000&&(i.options===undefined||array(i.options)&&i.options.length<=5&&i.options.every(o=>str(o)&&o.length<=160))&&(i.recommended_option===undefined||str(i.recommended_option)&&Array.isArray(i.options)&&i.options.includes(i.recommended_option)):i.kind==='approval'&&['create','edit','delete','command','network'].includes(i.operation)&&bool(i.preview)&&(i.path===undefined||str(i.path))&&(i.detail===undefined||str(i.detail))&&(i.hunks===undefined||array(i.hunks)&&i.hunks.length<=100&&i.hunks.every(h=>record(h)&&str(h.label)&&str(h.diff)&&h.diff.length<=2000));}
 case 'state':{const s=v.state,p=s?.preferences;return bool(v.busy)&&record(s)&&array(s.providers)&&s.providers.every((c:any)=>record(c)&&str(c.id)&&str(c.name)&&str(c.kind)&&record(c.catalog)&&array(c.catalog.models)&&c.catalog.models.every(str))&&record(p)&&record(p.conversation)&&record(p.defaults)&&array(p.favorites)&&p.favorites.every(model)&&array(p.manualModels)&&p.manualModels.every(model)&&(p.selected===null||model(p.selected));}
 case 'result':return str(v.requestId)&&bool(v.ok)&&(v.message===undefined||str(v.message));
 case 'accepted':return str(v.requestId);
 case 'runEnd':return str(v.requestId)&&['complete','error','stopped'].includes(v.status);
 case 'status':return bool(v.busy)&&str(v.text);
 case 'history':return array(v.events)&&v.events.every(event)&&bool(v.busy)&&str(v.status);
 case 'event':return event(v.event);
 case 'activityUpdate':return activity(v.activity);
 case 'runProgress':return record(v.progress)&&str(v.progress.runId)&&str(v.progress.phase)&&num(v.progress.startedAt)&&num(v.progress.phaseStartedAt)&&(v.progress.tool===undefined||record(v.progress.tool)&&str(v.progress.tool.id)&&str(v.progress.tool.name));
 case 'runFailure':return str(v.code)&&str(v.message)&&bool(v.retryable);
 case 'commandOutput':return str(v.runId)&&str(v.id)&&['stdout','stderr'].includes(v.stream)&&str(v.text)&&v.text.length<=32768;
 case 'toolProgress':return str(v.id)&&str(v.name)&&str(v.status);
 case 'stream':return str(v.id)&&str(v.text)&&bool(v.done);
 case 'usage':return model(v.model)&&num(v.input)&&num(v.output);
 case 'context':return num(v.used)&&num(v.budget)&&num(v.removed)&&str(v.source)&&(v.model===undefined||model(v.model));
 case 'checklist':return array(v.items)&&v.items.every((i:any)=>record(i)&&str(i.id)&&str(i.text)&&['pending','in_progress','completed'].includes(i.status));
 case 'attachments':return array(v.items)&&v.items.every((i:any)=>record(i)&&str(i.id)&&str(i.label));
 case 'sessions':return str(v.requestId)&&array(v.sessions)&&v.sessions.every((i:any)=>record(i)&&str(i.id)&&str(i.title)&&num(i.updatedAt));
 case 'sessionLoaded':return (v.readOnly===undefined||typeof v.readOnly==='boolean')&&model(v.model)&&['ask','plan','agent'].includes(v.mode)&&['supervised','autonomous'].includes(v.permission);
 case 'settingsSection':return ['providers','models','conversation','execution','diagnostics'].includes(v.section);
 case 'taskState':return ['resume','implementPlan','reviewChanges','undoChanges'].every(k=>bool(v[k]));
 case 'traceInfo':return str(v.path)&&num(v.bytes)&&bool(v.exists);
 case 'recoveryInfo':return array(v.items)&&v.items.every(i=>record(i)&&str(i.id)&&['backup','lock'].includes(i.kind));
 case 'persistenceState':return typeof v.failed==='boolean';
 case 'storageInfo':return num(v.bytes)&&num(v.sessions)&&[0,30,90,180].includes(v.retentionDays);
 case 'chatTestResult':return str(v.requestId)&&bool(v.ok)&&num(v.elapsed)&&str(v.message)&&str(v.protocol);
 case 'toolsTestResult':return str(v.requestId)&&model(v.model)&&record(v.result)&&['chat','streaming','tools'].every(k=>['validated','failed','unverified'].includes(v.result[k]))&&num(v.result.elapsed)&&num(v.result.timestamp)&&str(v.result.message)&&str(v.result.protocol);
 default:return false;
 }
}
export function onHostMessage(handler:(message:Response)=>void){window.addEventListener('message',event=>{if(isHostResponse(event.data))handler(event.data);});}
