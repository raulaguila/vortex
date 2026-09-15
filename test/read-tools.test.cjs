const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const Module=require('node:module');
const mock={commands:{executeCommand:async()=>[]},workspace:{textDocuments:[],fs:{stat:uri=>fs.stat(uri.fsPath)},findFiles:async()=>[]},Uri:{file:fsPath=>({fsPath})},RelativePattern:class{constructor(root,pattern){this.root=root;this.pattern=pattern;}},languages:{getDiagnostics:()=>[]}};
const load=Module._load;Module._load=function(name,...args){return name==='vscode'?mock:load.call(this,name,...args);};const {executeReadTool,invalidateFileQueries}=require('../dist/readTools');Module._load=load;
test('reads use dirty buffers, record versions and expose line pagination',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-read-'));try{
  const file=path.join(root,'a.txt');await fs.writeFile(file,'disk');mock.workspace.textDocuments=[{uri:{fsPath:file},isDirty:true,getText:()=>Array.from({length:300},(_,i)=>'buffer'+i).join('\n')}];
  const versions=new Map(),result=JSON.parse(await executeReadTool({action:'read_file',path:'a.txt'},root,new AbortController().signal,versions));
  assert.equal(result.source,'buffer');assert.equal(result.dirty,true);assert.match(result.content,/1: buffer0/);assert.equal(result.next_line,201);assert.equal(versions.size,1);
  mock.workspace.textDocuments=[];assert.match(await executeReadTool({action:'read_file',path:'a.txt'},root,new AbortController().signal),/disk/);
 }finally{mock.workspace.textDocuments=[];await fs.rm(root,{recursive:true,force:true});}
});
test('file listing and search report the actual page coverage',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-search-'));try{
  await fs.writeFile(path.join(root,'a.txt'),'needle');mock.workspace.findFiles=async()=>Array.from({length:150},(_,i)=>({fsPath:path.join(root,i===0?'a.txt':`b${i}.txt`)}));
  const signal=new AbortController().signal,list=JSON.parse(await executeReadTool({action:'list_files',limit:50},root,signal));assert.equal(list.files.length,50);assert.equal(list.next_offset,50);
  const search=JSON.parse(await executeReadTool({action:'search_files',query:'needle'},root,signal));assert.equal(search.matches.length,1);assert.equal(search.scanned_files,1);assert.equal(search.skipped_files,99);assert.equal(search.next_offset,100);
  const empty=JSON.parse(await executeReadTool({action:'get_project_skill'},root,signal));assert.deepEqual(empty.skills,[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('multiple inclusion patterns deduplicate paths before listing and searching',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-filters-'));
 try{
  for(const file of ['a.ts','b.js','c.ts'])await fs.writeFile(path.join(root,file),'needle');
  const requested=[];
  mock.workspace.findFiles=async(pattern,excluded)=>{requested.push([pattern.pattern,excluded]);return (pattern.pattern==='*.ts'?['a.ts','c.ts']:['a.ts','b.js']).map(file=>({fsPath:path.join(root,file)}));};
  const action={action:'list_files',patterns:['*.ts','*.js'],exclude_patterns:['**/*.test.ts'],limit:2};
  const first=JSON.parse(await executeReadTool(action,root,new AbortController().signal));
  assert.deepEqual(first.files,['a.ts','b.js']);assert.equal(first.next_offset,2);assert.equal(first.total_discovered,3);
  assert.ok(requested.every(([,excluded])=>excluded.includes('node_modules')&&excluded.includes('**/*.test.ts')));
  const second=JSON.parse(await executeReadTool({...action,offset:first.next_offset},root,new AbortController().signal));
  assert.deepEqual(second.files,['c.ts']);assert.equal(second.next_offset,null);
  const search=JSON.parse(await executeReadTool({action:'search_files',query:'needle',patterns:['*.ts','*.js']},root,new AbortController().signal));
  assert.equal(search.matches.length,3);assert.equal(search.scanned_files,3);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('diagnostics filters several literal paths and pages only matching diagnostics',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-diagnostics-'));
 try{
  for(const file of ['a.ts','b.ts','c.ts'])await fs.writeFile(path.join(root,file),'');
  mock.languages.getDiagnostics=()=>['a.ts','b.ts','c.ts'].map(file=>[{fsPath:path.join(root,file)},[{severity:0,message:file,range:{start:{line:0}}},{severity:1,message:'warning',range:{start:{line:1}}}]]);
  const action={action:'get_diagnostics',paths:['a.ts','c.ts'],severity:'error',limit:1};
  const first=JSON.parse(await executeReadTool(action,root,new AbortController().signal));
  assert.equal(first.total,2);assert.equal(first.items[0].file,'a.ts');assert.equal(first.next_offset,1);
  const second=JSON.parse(await executeReadTool({...action,offset:1},root,new AbortController().signal));
  assert.equal(second.items[0].file,'c.ts');assert.equal(second.next_offset,null);
 }finally{mock.languages.getDiagnostics=()=>[];await fs.rm(root,{recursive:true,force:true});}
});

test('search cursors continue inside a truncated file without gaps or duplicate matches',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-cursor-'));try{
  await fs.writeFile(path.join(root,'a.txt'),'needle\n'.repeat(2201));let discoveries=0;mock.workspace.findFiles=async()=>{discoveries++;return [{fsPath:path.join(root,'a.txt')}];};
  const action={action:'search_files',query:'needle'};let cursor,lines=[];
  do{const page=JSON.parse(await executeReadTool({...action,cursor},root,new AbortController().signal));lines.push(...page.matches.map(m=>m.line));cursor=page.next_cursor;}while(cursor);
  assert.equal(discoveries,1);assert.equal(lines.length,2201);assert.equal(new Set(lines).size,2201);assert.equal(lines.at(-1),2201);
  const first=JSON.parse(await executeReadTool(action,root,new AbortController().signal));invalidateFileQueries();await assert.rejects(executeReadTool({...action,cursor:first.next_cursor},root,new AbortController().signal),/expired/);
 }finally{invalidateFileQueries();await fs.rm(root,{recursive:true,force:true});}
});
test('symbol queries include nested methods and containers',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-symbols-'));try{
  await fs.writeFile(path.join(root,'a.ts'),'class A {}');mock.commands.executeCommand=async()=>[{name:'A',kind:4,range:{start:{line:0,character:0}},children:[{name:'method',kind:5,range:{start:{line:1,character:2}}}]}];
  const result=JSON.parse(await executeReadTool({action:'query_symbols',path:'a.ts'},root,new AbortController().signal));assert.deepEqual(result.items.map(i=>i.name),['A','method']);assert.equal(result.items[1].container,'A');assert.equal(result.items[1].line,2);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('exclusion globs flatten alternatives for VS Code 1.96 ripgrep',()=>{
 const {exclusionGlob}=require('../dist/readTools');const glob=exclusionGlob(['approval.txt','src/{generated,{cache,tmp}}/**']);
 assert.equal(glob,'{**/node_modules/**,**/.git/**,**/dist/**,**/coverage/**,**/.env/**,**/.env.*/**,**/*.vsix/**,approval.txt,src/generated/**,src/cache/**,src/tmp/**}');
 assert.throws(()=>exclusionGlob(['{a,b}'.repeat(10)]),/Too many/);
});
