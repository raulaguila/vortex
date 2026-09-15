import {Mode,canWrite,isMode} from './policy';
import {ChecklistItem} from './protocol';

export type Action =
  | {action:'finish';text:string}
  | {action:'list';pattern?:string}
  | {action:'read';path:string;startLine?:number;endLine?:number}
  | {action:'search';query:string;pattern?:string}
  | {action:'diagnostics'}
  | {action:'plan';items:ChecklistItem[]}
  | {action:'write';path:string;content:string}
  | {action:'edit';path:string;oldText:string;newText:string}
  | {action:'command';command:string};

const catalog: Record<Action['action'],string> = {
  finish:'{"action":"finish","text":"Markdown answer"}',
  list:'{"action":"list","pattern":"src/**"} — optional glob; at most 500 paths.',
  read:'{"action":"read","path":"src/file.ts","startLine":1,"endLine":200} — literal path; at most 400 numbered lines, file at most 1 MB.',
  search:'{"action":"search","query":"literal text","pattern":"src/**"} — optional glob; at most 300 files and 80 matches.',
  diagnostics:'{"action":"diagnostics"} — current VS Code diagnostics; this does not run tests.',
  plan:'{"action":"plan","items":[{"id":"step-1","text":"Concrete step","status":"pending"}]} — full checklist, 1–50 unique IDs; statuses pending, running, done. Preserve IDs on updates.',
  write:'{"action":"write","path":"src/file.ts","content":"complete replacement"} — create or replace a file, at most 200 KB of text.',
  edit:'{"action":"edit","path":"src/file.ts","oldText":"unique exact match","newText":"replacement"} — oldText must occur exactly once.',
  command:'{"action":"command","command":"npm test"} — workspace shell; approval required, 60-second timeout. A nonzero exit is a failure.'
};
export function allowedActions(mode:Mode,conversationOnly=false):Action['action'][] {
  if(!isMode(mode))throw new Error('Invalid mode.');
  if(conversationOnly)return ['finish'];
  return ['finish','list','read','search','diagnostics',...(mode==='ask'?[]:['plan' as const]),...(canWrite(mode)?['write','edit','command'] as const:[])];
}
export function toolInstructions(mode:Mode):string {return allowedActions(mode).map(name=>catalog[name]).join('\n');}
const text=(v:unknown,max:number,empty=false):v is string=>typeof v==='string'&&v.length<=max&&(empty||!!v.trim());
const literal=(v:unknown)=>text(v,2048)&&!/[\*?\[\]{}\0]/.test(v)&&!v.startsWith('/')&&!v.split(/[\\/]/).includes('..');
export function validateAction(value:unknown,mode:Mode,conversationOnly=false):Action {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected one JSON action object.');
  const a=value as Record<string,unknown>;
  if(!allowedActions(mode,conversationOnly).includes(a.action as Action['action']))throw new Error(`Action not allowed in ${conversationOnly?'conversation':mode} mode.`);
  let valid=false;
  switch(a.action){
    case 'finish':valid=text(a.text,100000);break;
    case 'list':valid=a.pattern===undefined||text(a.pattern,500);break;
    case 'read':valid=literal(a.path)&&[a.startLine,a.endLine].every(n=>n===undefined||Number.isSafeInteger(n)&&Number(n)>0)&&(a.endLine===undefined||Number(a.endLine)>=Number(a.startLine??1));break;
    case 'search':valid=text(a.query,300)&&(a.pattern===undefined||text(a.pattern,500));break;
    case 'diagnostics':valid=true;break;
    case 'write':valid=literal(a.path)&&text(a.content,200000,true);break;
    case 'edit':valid=literal(a.path)&&text(a.oldText,200000)&&text(a.newText,200000,true);break;
    case 'command':valid=text(a.command,20000);break;
    case 'plan':valid=Array.isArray(a.items)&&a.items.length>0&&a.items.length<=50&&a.items.every(i=>i&&text(i.id,80)&&text(i.text,300)&&['pending','running','done'].includes(i.status))&&new Set(a.items.map(i=>i.id)).size===a.items.length;break;
  }
  if(!valid)throw new Error(`Invalid ${String(a.action)} arguments. Use the documented schema; file paths must be literal, not globs.`);
  return value as Action;
}

export class ApprovalDenied extends Error {constructor(){super('Approval denied. The turn stopped without executing the refused action.');}}
