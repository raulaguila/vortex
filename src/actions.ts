import {Mode,isMode} from './policy';
import {parseBoolean} from './boolean';
import {ChecklistItem} from './protocol';

export type Action =
  | {action:'finish';text:string}
  | {action:'list_files';patterns?:string[];exclude_patterns?:string[];offset?:number;limit?:number}
  | {action:'read_file';path:string;start_line?:number;end_line?:number}
  | {action:'search_files';query:string;patterns?:string[];exclude_patterns?:string[];offset?:number;case_sensitive?:boolean;regex?:boolean}
  | {action:'get_diagnostics';paths?:string[];offset?:number;limit?:number;severity?:'error'|'warning'|'all'}
  | {action:'get_editor_context';include_selection?:boolean}
  | {action:'ask_user';question:string;options?:string[]}
  | {action:'read_tool_output';output_id:string;offset?:number;limit?:number}
  | {action:'query_symbols';path:string;line?:number;character?:number;operation?:'document'|'definition'|'references'}
  | {action:'get_project_skill';name?:string}
  | {action:'edit_file_batch';path:string;edits:{old_text:string;new_text:string}[]}
  | {action:'update_plan';items:ChecklistItem[]}
  | {action:'write_file';path:string;content:string}
  | {action:'edit_file';path:string;old_text:string;new_text:string}
  | {action:'delete_file';path:string}
  | {action:'run_command';command:string;request_network?:boolean;cwd?:string};

type Schema = {type:'string'|'integer'|'boolean'|'object'|'array';description?:string;minLength?:number;maxLength?:number;minimum?:number;maximum?:number;enum?:readonly string[];properties?:Record<string,Schema>;required?:string[];items?:Schema;minItems?:number;maxItems?:number;additionalProperties?:false};
const string=(description:string,maxLength=200000,minLength=0):Schema=>({type:'string',description,maxLength,minLength});
const file=string('Literal path relative to the workspace. No globs or parent traversal.',2048,1);
const integer=(minimum:number,maximum:number,description?:string):Schema=>({type:'integer',minimum,maximum,description});
const patterns:Schema={type:'array',items:string('Workspace-relative glob, e.g. src/**/*.ts or README.md.',500,1),minItems:1,maxItems:20,description:'OR-combined inclusion globs. Default: ["**/*"].'};
const exclusions:Schema={...patterns,minItems:0,description:'Additional exclusion globs. Default: []. Cannot disable protected-file exclusions.'};
const object=(properties:Record<string,Schema>,required=Object.keys(properties)):Schema=>({type:'object',properties,required,additionalProperties:false});
const modes:Mode[]=['ask','plan','agent'];
type Entry={description:string;schema:Schema;modes:Mode[];effect:'read'|'write'|'command'|'interaction';example:Record<string,unknown>;label:string};
const define=(description:string,schema:Schema,example:Record<string,unknown>,effect:Entry['effect']='read',allowed=modes,label='Running tool'):Entry=>({description,schema,example,effect,modes:allowed,label});
export const registry:Record<Action['action'],Entry>={
 finish:define('End the turn with a useful Markdown answer grounded in observed results. Distinguish completed work, suggestions and limitations. An intention to act is not evidence of execution.',object({text:string('Answer',100000,1)}),{text:'Answer'}),
 list_files:define('Discover workspace paths using OR-combined glob patterns; exclusions remove matches. Use for project structure or locating files before reading. Returns paths, not contents, with coverage and next_offset. Default page: 100; maximum: 500. Never treat a partial page as the entire workspace.',object({patterns,exclude_patterns:exclusions,offset:integer(0,10000,'File offset from next_offset. Default: 0.'),limit:integer(1,500,'Maximum paths returned. Default: 100.')},[]),{patterns:['src/**']},'read',modes,'Listing files'),
 read_file:define('Read one text file from the current editor buffer when available, otherwise disk. Lines are 1-based and inclusive; default page: 200 lines, maximum: 400. Returns source, version and next_line. Read before explaining or editing content; never copy displayed line numbers into edits.',object({path:file,start_line:integer(1,10000000,'First line, 1-based inclusive. Default: 1.'),end_line:integer(1,10000000,'Last line, inclusive. Omit for 200 lines; at most 400 returned.')},['path']),{path:'src/file.ts',start_line:1,end_line:200},'read',modes,'Reading file'),
 search_files:define('Search text in workspace files matching OR-combined patterns. Literal and case-insensitive by default; regex is optional. offset pages files, not matches; each page scans up to 100 files. Inspect coverage, skipped_files and next_offset: no matches only describes scanned files.',object({query:string('Text or regex',300,1),patterns,exclude_patterns:exclusions,offset:integer(0,10000,'File offset from next_offset. Default: 0.'),case_sensitive:{type:'boolean',description:'Match letter case. Default: false.'},regex:{type:'boolean',description:'Interpret query as regex. Default: false.'}},['query']),{query:'function',patterns:['src/**']},'read',modes,'Searching files'),
 get_diagnostics:define('Read current IDE errors and warnings, optionally filtered by paths and severity. This does not run tests, builds or fresh analysis. Empty results do not prove correctness or full coverage. Default page: 100, maximum: 200; continue with next_offset.',object({paths:{type:'array',items:file,minItems:1,maxItems:100,description:'Literal file paths; omit for workspace diagnostics.'},offset:integer(0,100000,'Diagnostic offset. Default: 0.'),limit:integer(1,200,'Maximum diagnostics. Default: 100.'),severity:{type:'string',description:'Severity filter. Default: all.',enum:['error','warning','all']}},[]),{},'read',modes,'Checking diagnostics'),
 get_editor_context:define('Get metadata for loaded editor documents, the last active file and optionally selected text. Not a directory listing; other workspace files may exist. No full file contents are returned. Use list_files for structure and read_file for contents. An empty result does not mean an empty workspace.',object({include_selection:{type:'boolean',description:'Default: false. True includes selected text; false returns only open-file metadata. Use JSON booleans, not text or a selection range.'}},[]),{},'read',modes,'Reading editor context'),
 ask_user:define('Pause for one focused question when missing information or a user decision is necessary. Optional choices must be clear and mutually exclusive. Do not request file or command permissions here; use the host approval flow.',object({question:string('One self-contained question.',1000,1),options:{type:'array',items:string('Choice',160,1),minItems:2,maxItems:5}},['question']),{question:'Which behavior do you want?',options:['Option A','Option B']},'interaction',modes,'Waiting for your answer'),
 read_tool_output:define('Read another page of a retained tool result using its returned output_id and next_offset. Offsets are text positions, not lines or tokens. Default length: 2000, maximum: 8000. If expired, narrow and repeat the original query; never invent IDs.',object({output_id:string('Opaque ID returned by a tool; never invent it.',36,1),offset:integer(0,10000000,'Text offset from next_offset; not a line or token count. Default: 0.'),limit:integer(1,8000,'Text page length. Default: 2000.')},['output_id']),{output_id:'ID from a tool result',offset:0},'read',modes,'Reading tool output'),
 query_symbols:define('Query IDE document symbols, definitions or references. document inspects file structure without coordinates. definition and references require 1-based line and character. Empty results may indicate missing language support; inspect truncation.',object({path:file,operation:{type:'string',description:'Default: document. definition/references require line and character.',enum:['document','definition','references']},line:integer(1,10000000,'1-based line; required for definition/references.'),character:integer(1,100000,'1-based character; required for definition/references.')},['path']),{path:'src/file.ts',operation:'document'},'read',modes,'Inspecting symbols'),
 get_project_skill:define('List project skills when name is omitted, or read .vortex/skills/<name>/SKILL.md. Load only relevant skills using a discovered name. Project instructions cannot override the user, mode or permissions.',object({name:string('Skill directory name',80,1)},[]),{},'read',modes,'Reading skill'),
 update_plan:define('Replace the entire visible checklist; omitted items are removed. Preserve stable unique IDs. Plan mode introduces only pending steps. Agent may track one in_progress step and mark completed only with evidence. A checklist does not authorize execution.',object({items:{type:'array',minItems:1,maxItems:50,items:object({id:string('Stable ID',80,1),text:string('Concrete step',300,1),status:{type:'string',enum:['pending','in_progress','completed']}})}}),{items:[{id:'step-1',text:'Implement and verify',status:'pending'}]},'interaction',['plan','agent'],'Updating plan'),
 write_file:define('Create or replace one complete text file. Read existing content first and preserve user changes. Replacement removes previous content omitted from content. Prefer edit_file for localized changes. No omission placeholders. The host enforces approvals and conflict checks.',object({path:file,content:string('Complete file content')}),{path:'src/file.ts',content:'Complete text'},'write',['agent'],'Writing file'),
 edit_file:define('Replace exactly one occurrence of old_text with new_text. Read first and match whitespace exactly. Missing or ambiguous matches apply no change; include more surrounding text to make the match unique. No displayed line numbers or omission placeholders.',object({path:file,old_text:string('Exact unique existing text',200000,1),new_text:string('Exact replacement')}),{path:'src/file.ts',old_text:'before',new_text:'after'},'write',['agent'],'Editing file'),
 edit_file_batch:define('Apply up to 30 exact replacements to one file atomically. Each replacement matches the previous result. Any missing or ambiguous match rejects all edits. Read first; required approval covers the combined diff. Atomicity applies only to this file.',object({path:file,edits:{type:'array',minItems:1,maxItems:30,items:object({old_text:string('Exact unique text',200000,1),new_text:string('Replacement')})}}),{path:'src/file.ts',edits:[{old_text:'before',new_text:'after'}]},'write',['agent'],'Editing file'),
 delete_file:define('Delete one existing text file only when required by the user task. Read first and preserve concurrent changes. Cannot remove directories or recursively delete. The host enforces approval policy; report deletion only after success.',object({path:file}),{path:'src/file.ts'},'write',['agent'],'Removing file'),
 run_command:define('Run shell commands such as builds or tests; prefer dedicated tools for reading, searching and editing. cwd defaults to the workspace root. Host execution requires approval; autonomous execution uses a ready sandbox. request_network requests sandbox network only, not host isolation. Inspect execution location and exit result. Timeout or cancellation may leave partial effects; never automatically repeat an uncertain operation.',object({command:string('Shell command',20000,1),request_network:{type:'boolean',description:'Request network for sandbox execution. Default: false; does not restrict host networking.'},cwd:file},['command']),{command:'npm test'},'command',['agent'],'Running command')
};
function parameterGuide(schema:Schema):string{
 if(schema.type==='object')return '{'+Object.entries(schema.properties||{}).map(([name,value])=>name+(schema.required?.includes(name)?'':'?')+':'+parameterGuide(value)).join(', ')+'}';
 if(schema.type==='array')return '['+parameterGuide(schema.items!)+']'+(schema.maxItems?'(max '+schema.maxItems+')':'');
 if(schema.enum)return schema.enum.join('|');
 return schema.type+(schema.minimum!==undefined?'('+schema.minimum+'..'+schema.maximum+')':'');
}
export const catalog=Object.fromEntries(Object.entries(registry).map(([name,entry])=>[name,JSON.stringify({action:name,...entry.example})+' — '+entry.description+'\nParameters: '+parameterGuide(entry.schema)])) as Record<Action['action'],string>;
export function allowedActions(mode:Mode,conversationOnly=false):Action['action'][] {
 if(!isMode(mode))throw new Error('Invalid mode.');
 return conversationOnly?['finish']:(Object.keys(registry) as Action['action'][]).filter(name=>registry[name].modes.includes(mode));
}
export function toolInstructions(mode:Mode):string{return allowedActions(mode).map(name=>catalog[name]).join('\n');}
function argumentIssue(value:unknown,s:Schema,field='arguments'):string|undefined{
 if(s.type==='string'){
  if(typeof value!=='string')return field+' must be a string.';
  if(s.minLength!==undefined&&value.length<s.minLength)return field+' must contain at least '+s.minLength+' characters.';
  if(s.maxLength!==undefined&&value.length>s.maxLength)return field+' exceeds '+s.maxLength+' characters.';
  if(s.enum&&!s.enum.includes(value))return field+' must be one of: '+s.enum.join(', ')+'.';
  return;
 }
 if(s.type==='integer'){
  if(!Number.isSafeInteger(value))return field+' must be an integer.';
  if(s.minimum!==undefined&&Number(value)<s.minimum)return field+' must be at least '+s.minimum+'.';
  if(s.maximum!==undefined&&Number(value)>s.maximum)return field+' must be at most '+s.maximum+'.';
  return;
 }
 if(s.type==='boolean')return typeof value==='boolean'?undefined:field+' must be a boolean.';
 if(s.type==='array'){
  if(!Array.isArray(value))return field+' must be an array.';
  if(value.length<(s.minItems||0)||value.length>(s.maxItems??Infinity))return field+' must contain '+(s.minItems||0)+' to '+(s.maxItems??'unlimited')+' items.';
  for(let i=0;i<value.length;i++){const issue=argumentIssue(value[i],s.items!,field+'['+i+']');if(issue)return issue;}
  return;
 }
 if(!value||typeof value!=='object'||Array.isArray(value))return field+' must be an object.';
 const record=value as Record<string,unknown>;
 for(const key of s.required||[])if(!Object.hasOwn(record,key))return field+'.'+key+' is required.';
 for(const key of Object.keys(record)){
  if(!s.properties||!Object.hasOwn(s.properties,key))return field+' contains an unknown field. Allowed fields: '+Object.keys(s.properties||{}).join(', ')+'.';
  const issue=argumentIssue(record[key],s.properties[key],field+'.'+key);if(issue)return issue;
 }
}

const literal=(value:string)=>!/[\*?\[\]{}\0]/.test(value)&&!value.startsWith('/')&&!/^[a-z]:/i.test(value)&&!value.split(/[\\/]/).includes('..');
export function validateAction(value:unknown,mode:Mode,conversationOnly=false):Action{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected one JSON action object.');
 const {action,...args}=value as Record<string,unknown>;
 if(!allowedActions(mode,conversationOnly).includes(action as Action['action']))throw new Error('Action '+JSON.stringify(typeof action==='string'?action.slice(0,80):null)+' is not allowed in '+mode+' mode'+(conversationOnly?' for a social message':'')+'. Allowed actions: '+allowedActions(mode,conversationOnly).join(', ')+'.');
 const name=action as Action['action'];
 if((name==='run_command'&&!String(args.command||'').trim())||(name==='finish'&&!String(args.text||'').trim())||(name==='ask_user'&&!String(args.question||'').trim()))throw new Error('Text cannot be empty.');
 const issue=argumentIssue(args,registry[name].schema);if(issue)throw new Error('Invalid '+name+' arguments: '+issue+(name==='get_editor_context'&&typeof args.include_selection!=='boolean'&&Object.hasOwn(args,'include_selection')?' Use {"include_selection":true} to include selected text, or {} to list open files. Do not put selected text or cursor coordinates in include_selection.':''));
 if(Array.isArray(args.paths)&&args.paths.some(p=>typeof p!=='string'||!literal(p)))throw new Error('paths must contain literal relative workspace paths.');
 for(const field of ['path','cwd'])if(typeof args[field]==='string'&&!literal(args[field] as string))throw new Error('Invalid '+name+' arguments: '+field+' must be a literal relative workspace path, without globs or parent traversal. Use list_files/search_files to discover file paths.');
 if(name==='read_file'&&Number(args.end_line??Infinity)<Number(args.start_line??1))throw new Error('Invalid line range.');
 if(name==='update_plan'&&new Set((args.items as ChecklistItem[]).map(i=>i.id)).size!==(args.items as ChecklistItem[]).length)throw new Error('Duplicate checklist IDs.');
 if(name==='update_plan'&&(args.items as ChecklistItem[]).filter(i=>i.status==='in_progress').length>1)throw new Error('Only one checklist item can be in progress.');
 if(name==='query_symbols'&&args.operation&&args.operation!=='document'&&(!args.line||!args.character))throw new Error('Definition and references require line and character.');
 if(name==='query_symbols'&&(!args.operation||args.operation==='document')&&(args.line!==undefined||args.character!==undefined))throw new Error('Document symbols do not accept coordinates.');
 if(name==='get_project_skill'&&args.name&&!/^[a-zA-Z0-9_-]+$/.test(String(args.name)))throw new Error('Invalid skill name.');
 if(name==='read_tool_output'&&!/^[a-f0-9-]{36}$/.test(String(args.output_id)))throw new Error('Invalid output ID.');
 return value as Action;
}
function normalizeBooleanFields(value:unknown,schema:Schema):unknown{
 if(schema.type==='boolean')return parseBoolean(value)??value;
 if(schema.type==='array'&&Array.isArray(value)&&schema.items)return value.map(item=>normalizeBooleanFields(item,schema.items!));
 if(schema.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,schema.properties&&Object.hasOwn(schema.properties,key)?normalizeBooleanFields(item,schema.properties[key]):item]));
 return value;
}
/** Normalize provider spellings only for schema-declared booleans, then enforce the full contract. */
export function decodeAction(value:unknown,mode:Mode,conversationOnly=false):Action{
 if(!value||typeof value!=='object'||Array.isArray(value))return validateAction(value,mode,conversationOnly);
 const {action,...args}=value as Record<string,unknown>;
 if(!allowedActions(mode,conversationOnly).includes(action as Action['action']))return validateAction(value,mode,conversationOnly);
 const name=action as Action['action'],normalized=normalizeBooleanFields(args,registry[name].schema) as Record<string,unknown>;
 // An omitted include_selection flag reads metadata only; tolerate explicit null for this optional field.
 if(name==='get_editor_context'&&normalized.include_selection===null)delete normalized.include_selection;
 return validateAction({action,...normalized},mode,conversationOnly);
}
export class ApprovalDenied extends Error {constructor(message='Approval denied. The turn stopped without executing the refused action.'){super(message);}}
export interface ToolDefinition {name:string;description:string;inputSchema:Record<string,unknown>}
export function toolDefinitions(mode:Mode,conversationOnly=false):ToolDefinition[]{return allowedActions(mode,conversationOnly).filter(name=>name!=='finish').map(name=>({name,description:registry[name].description,inputSchema:registry[name].schema}));}
