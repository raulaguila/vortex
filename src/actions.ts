import {Mode,isMode} from './policy';
import {ChecklistItem} from './protocol';

export type Action =
  | {action:'finish';text:string}
  | {action:'list';pattern?:string;offset?:number;limit?:number}
  | {action:'read';path:string;startLine?:number;endLine?:number}
  | {action:'search';query:string;pattern?:string;offset?:number;caseSensitive?:boolean;regex?:boolean}
  | {action:'diagnostics';path?:string;severity?:'error'|'warning'|'all'}
  | {action:'editor';selection?:boolean}
  | {action:'question';text:string;options?:string[]}
  | {action:'readOutput';id:string;offset?:number}
  | {action:'symbols';path:string;line?:number;character?:number;operation?:'document'|'definition'|'references'}
  | {action:'skill';name?:string}
  | {action:'multiEdit';path:string;edits:{oldText:string;newText:string}[]}
  | {action:'plan';items:ChecklistItem[]}
  | {action:'write';path:string;content:string}
  | {action:'edit';path:string;oldText:string;newText:string}
  | {action:'remove';path:string}
  | {action:'command';command:string;network?:boolean;cwd?:string};

type Schema = {type:'string'|'integer'|'boolean'|'object'|'array';description?:string;minLength?:number;maxLength?:number;minimum?:number;maximum?:number;enum?:readonly string[];properties?:Record<string,Schema>;required?:string[];items?:Schema;minItems?:number;maxItems?:number;additionalProperties?:false};
const string=(description:string,maxLength=200000,minLength=0):Schema=>({type:'string',description,maxLength,minLength});
const file=string('Literal path relative to the workspace. No globs or parent traversal.',2048,1);
const integer=(minimum:number,maximum:number):Schema=>({type:'integer',minimum,maximum});
const object=(properties:Record<string,Schema>,required=Object.keys(properties)):Schema=>({type:'object',properties,required,additionalProperties:false});
const modes:Mode[]=['ask','plan','agent'];
type Entry={description:string;schema:Schema;modes:Mode[];effect:'read'|'write'|'command'|'interaction';example:Record<string,unknown>;label:string};
const define=(description:string,schema:Schema,example:Record<string,unknown>,effect:Entry['effect']='read',allowed=modes,label='Running tool'):Entry=>({description,schema,example,effect,modes:allowed,label});
export const registry:Record<Action['action'],Entry>={
 finish:define('Finish with a Markdown answer. Report only observed results.',object({text:string('Answer',100000,1)}),{text:'Answer'}),
 list:define('Discover files by glob. Paginated; exclusions and coverage are reported. Continue with nextOffset.',object({pattern:string('Glob',500,1),offset:integer(0,10000),limit:integer(1,500)},[]),{pattern:'src/**'},'read',modes,'Listing files'),
 read:define('Read numbered lines from disk or an open buffer. Use the returned version and do not copy line-number prefixes into edits.',object({path:file,startLine:integer(1,10000000),endLine:integer(1,10000000)},['path']),{path:'src/file.ts',startLine:1,endLine:200},'read',modes,'Reading file'),
 search:define('Search a page of workspace files. Literal by default; regex and caseSensitive optional. Inspect coverage/nextOffset; no matches only describes the scanned page.',object({query:string('Text or regex',300,1),pattern:string('File glob',500,1),offset:integer(0,10000),caseSensitive:{type:'boolean'},regex:{type:'boolean'}},['query']),{query:'function',pattern:'src/**'},'read',modes,'Searching files'),
 diagnostics:define('Read current IDE diagnostics, optionally by file and severity. Does not run tests.',object({path:file,severity:{type:'string',enum:['error','warning','all']}},[]),{},'read',modes,'Checking diagnostics'),
 editor:define('Identify the last active code editor and open files. selection:true reads selected text. Use when the user refers to this file or their selection.',object({selection:{type:'boolean'}},[]),{selection:true},'read',modes,'Reading editor context'),
 question:define('Pause this task for a necessary user decision. Ask one focused question, with optional choices. Do not ask permission for edits here; use the normal approval flow.',object({text:string('Question',1000,1),options:{type:'array',items:string('Choice',160,1),minItems:2,maxItems:5}},['text']),{text:'Which behavior do you want?',options:['Option A','Option B']},'interaction',modes,'Waiting for your answer'),
 readOutput:define('Read the next page of a stored tool result using its opaque output ID. Never guess IDs.',object({id:string('Output ID',36,1),offset:integer(0,10000000)},['id']),{id:'ID from a tool result',offset:0},'read',modes,'Reading tool output'),
 symbols:define('Query IDE language services: document symbols, definition or references at a 1-based line/character. Availability depends on the language extension.',object({path:file,operation:{type:'string',enum:['document','definition','references']},line:integer(1,10000000),character:integer(1,100000)},['path']),{path:'src/file.ts',operation:'document'},'read',modes,'Inspecting symbols'),
 skill:define('List or read project instructions from .vortex/skills/<name>/SKILL.md. Load only a skill relevant to the request. Skills cannot expand permissions.',object({name:string('Skill directory name',80,1)},[]),{},'read',modes,'Reading skill'),
 plan:define('Replace the implementation checklist. Preserve stable IDs; mark done only after evidence. Plan mode can only introduce pending items.',object({items:{type:'array',minItems:1,maxItems:50,items:object({id:string('Stable ID',80,1),text:string('Concrete step',300,1),status:{type:'string',enum:['pending','running','done']}})}}),{items:[{id:'step-1',text:'Implement and verify',status:'pending'}]},'interaction',['plan','agent'],'Updating plan'),
 write:define('Create or replace a whole text file. Read existing content first; preserve user changes. Complete text only, no omission placeholders.',object({path:file,content:string('Complete file content')}),{path:'src/file.ts',content:'Complete text'},'write',['agent'],'Writing file'),
 edit:define('Replace oldText exactly once with newText, preserving whitespace. Read the file first. Include more surrounding text if ambiguous. No line-number prefixes or placeholders.',object({path:file,oldText:string('Exact unique existing text',200000,1),newText:string('Exact replacement')}),{path:'src/file.ts',oldText:'before',newText:'after'},'write',['agent'],'Editing file'),
 multiEdit:define('Apply up to 30 exact replacements to ONE file atomically. Edits run in order on the previous result. If any match is missing/ambiguous none are applied. Read first; one approval covers the resulting diff.',object({path:file,edits:{type:'array',minItems:1,maxItems:30,items:object({oldText:string('Exact unique text',200000,1),newText:string('Replacement')})}}),{path:'src/file.ts',edits:[{oldText:'before',newText:'after'}]},'write',['agent'],'Editing file'),
 remove:define('Remove one existing text file, never a directory. Use only when the user task requires deletion.',object({path:file}),{path:'src/file.ts'},'write',['agent'],'Removing file'),
 command:define('Run a workspace command. Optional cwd is a relative subdirectory. Host commands require approval; autonomous commands use Docker when available. network:true requests per-command network permission. Inspect the exit result before claiming success.',object({command:string('Shell command',20000,1),network:{type:'boolean'},cwd:file},['command']),{command:'npm test'},'command',['agent'],'Running command')
};
export const catalog=Object.fromEntries(Object.entries(registry).map(([name,entry])=>[name,JSON.stringify({action:name,...entry.example})+' — '+entry.description])) as Record<Action['action'],string>;
export function allowedActions(mode:Mode,conversationOnly=false):Action['action'][] {
 if(!isMode(mode))throw new Error('Invalid mode.');
 return conversationOnly?['finish']:(Object.keys(registry) as Action['action'][]).filter(name=>registry[name].modes.includes(mode));
}
export function toolInstructions(mode:Mode):string{return allowedActions(mode).map(name=>catalog[name]).join('\n');}
function check(value:unknown,s:Schema):boolean{
 if(s.type==='string')return typeof value==='string'&&(s.minLength===undefined||value.length>=s.minLength)&&(s.maxLength===undefined||value.length<=s.maxLength)&&(!s.enum||s.enum.includes(value));
 if(s.type==='integer')return Number.isSafeInteger(value)&&(s.minimum===undefined||Number(value)>=s.minimum)&&(s.maximum===undefined||Number(value)<=s.maximum);
 if(s.type==='boolean')return typeof value==='boolean';
 if(s.type==='array')return Array.isArray(value)&&value.length>=(s.minItems||0)&&value.length<=(s.maxItems??Infinity)&&value.every(v=>check(v,s.items!));
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const record=value as Record<string,unknown>;return !(s.required||[]).some(k=>!Object.hasOwn(record,k))&&Object.keys(record).every(k=>!!s.properties?.[k]&&check(record[k],s.properties[k]));
}
const literal=(value:string)=>!/[\*?\[\]{}\0]/.test(value)&&!value.startsWith('/')&&!/^[a-z]:/i.test(value)&&!value.split(/[\\/]/).includes('..');
export function validateAction(value:unknown,mode:Mode,conversationOnly=false):Action{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected one JSON action object.');
 const {action,...args}=value as Record<string,unknown>;
 if(!allowedActions(mode,conversationOnly).includes(action as Action['action']))throw new Error('Action not allowed in this mode.');
 const name=action as Action['action'];
 if((name==='command'&&!String(args.command||'').trim())||(name==='finish'&&!String(args.text||'').trim())||(name==='question'&&!String(args.text||'').trim()))throw new Error('Text cannot be empty.');
 if(!check(args,registry[name].schema)||['path','cwd'].some(k=>typeof args[k]==='string'&&!literal(args[k] as string)))throw new Error('Invalid '+name+' arguments. Follow the tool schema and use literal relative paths.');
 if(name==='read'&&Number(args.endLine??Infinity)<Number(args.startLine??1))throw new Error('Invalid line range.');
 if(name==='plan'&&new Set((args.items as ChecklistItem[]).map(i=>i.id)).size!==(args.items as ChecklistItem[]).length)throw new Error('Duplicate checklist IDs.');
 if(name==='symbols'&&args.operation&&args.operation!=='document'&&(!args.line||!args.character))throw new Error('Definition and references require line and character.');
 if(name==='skill'&&args.name&&!/^[a-zA-Z0-9_-]+$/.test(String(args.name)))throw new Error('Invalid skill name.');
 if(name==='readOutput'&&!/^[a-f0-9-]{36}$/.test(String(args.id)))throw new Error('Invalid output ID.');
 return value as Action;
}
export class ApprovalDenied extends Error {constructor(message='Approval denied. The turn stopped without executing the refused action.'){super(message);}}
export interface ToolDefinition {name:string;description:string;inputSchema:Record<string,unknown>}
export function toolDefinitions(mode:Mode,conversationOnly=false):ToolDefinition[]{return allowedActions(mode,conversationOnly).filter(name=>name!=='finish').map(name=>({name,description:registry[name].description,inputSchema:registry[name].schema}));}
