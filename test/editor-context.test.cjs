const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const Module=require('node:module');
const mock={window:{activeTextEditor:undefined,onDidChangeActiveTextEditor:()=>({dispose(){}})},workspace:{textDocuments:[],findFiles:async()=>[]},RelativePattern:class{constructor(root,pattern){this.root=root;this.pattern=pattern;}}};
const load=Module._load;
Module._load=function(name,...args){return name==='vscode'?mock:load.call(this,name,...args);};
const {EditorContext}=require('../dist/editorContext');
const {executeReadTool}=require('../dist/readTools');
Module._load=load;
test('one loaded document is explicitly distinguished from the complete workspace listing',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-editor-scope-'));
 const editor=new EditorContext();
 try{
  for(const name of ['package.json','README.md','extension.ts'])await fs.writeFile(path.join(root,name),'fixture');
  mock.workspace.textDocuments=[{uri:{scheme:'file',fsPath:path.join(root,'package.json')},languageId:'json',isDirty:false,version:1}];
  mock.workspace.findFiles=async()=> (await fs.readdir(root)).map(name=>({fsPath:path.join(root,name)}));
  const snapshot=await editor.snapshot(root);
  assert.deepEqual(snapshot.files.map(f=>f.path),['package.json']);
  assert.equal(snapshot.scope,'open_editor_documents');
  assert.equal(snapshot.file_contents_included,false);
  assert.match(snapshot.coverage,/not a directory listing/);
  assert.match(snapshot.next_step,/use list_files.*then read_file/);
  const listing=JSON.parse(await executeReadTool({action:'list_files'},root,new AbortController().signal));
  assert.equal(listing.scope,'workspace_files');
  assert.equal(listing.files.length,3);
  assert.deepEqual(listing.patterns,['**/*']);
  assert.equal(listing.next_offset,null);
  mock.workspace.textDocuments=[];
  const empty=await editor.snapshot(root);
  assert.equal(empty.files.length,0);
  assert.match(empty.coverage,/Other workspace files may exist/);
 }finally{editor.dispose();mock.workspace.textDocuments=[];await fs.rm(root,{recursive:true,force:true});}
});
test('every mode and protocol distinguishes editor metadata from project evidence',()=>{
 const {systemPrompt}=require('../dist/prompt');
 const {registry}=require('../dist/actions');
 for(const mode of ['ask','plan','agent'])for(const protocol of ['native','compatibility']){
  const prompt=systemPrompt(mode,'auto',[],false,'supervised',protocol);
  assert.match(prompt,/one open file does not mean the project has one file/);
  assert.match(prompt,/list_files to discover workspace files and read relevant manifests/);
 }
 assert.match(registry.get_editor_context.description,/Not a directory listing/);
});
