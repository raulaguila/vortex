const {_electron} = require('playwright-core');
const {createServer} = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-host-'));
  await fs.mkdir(path.join(temp,'profile','User'),{recursive:true});await fs.mkdir(path.join(temp,'workspace'));
  await fs.writeFile(path.join(temp,'profile','User','settings.json'),JSON.stringify({'vortex.sandbox.image':'vortex-host-approval-fixture:absent','security.workspace.trust.enabled':false,'workbench.startupEditor':'none','telemetry.telemetryLevel':'off','extensions.autoUpdate':false,'window.restoreWindows':'none','window.dialogStyle':'custom','workbench.colorTheme':'Default Dark Modern'}));
  let scripted=[],lastFixtureAction;
  const server=createServer(async(req,res)=>{
    let payload={};const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)payload=JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('Content-Type','application/json');
    if(req.url.startsWith('/company/')){
      if(req.headers.authorization!=='Bearer fixture-company-key'){res.statusCode=401;res.end('{}');return;}
      res.end(JSON.stringify(req.url==='/company/models'?{data:[{id:'company-model'}]}:req.url==='/company/chat/completions'?{choices:[{finish_reason:'stop',message:{content:payload.tools?'Compatible gateway validated inside VS Code.':JSON.stringify({action:'finish',text:'Compatible gateway validated inside VS Code.'})}}]}:{}));return;
    }
    if(req.url==='/api/show'){res.end(JSON.stringify({model_info:{'test.context_length':32768}}));return;}
    if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'vortex-test-model'}]}));return;}
    if(req.url==='/api/chat'){
      if(/^Summarize/.test(payload.messages?.[0]?.content||'')){res.end(JSON.stringify({message:{content:'Earlier fixture actions are recorded in the saved history. Preserve the current request, mode and approvals.'}}));return;}
      const retryDiscovery=lastFixtureAction?.action==='list_files'&&String(payload.messages?.at(-1)?.content).includes('Workspace changed during discovery. Restart the query.');
      if(retryDiscovery)await new Promise(resolve=>setTimeout(resolve,250));
      const probe=JSON.stringify(payload).includes('vortex-connection-probe.txt'),nonce=JSON.stringify(payload).match(/Verification code: ([a-f0-9-]{36})/)?.[1];let action=probe?(nonce?{action:'finish',text:'Verified '+nonce}:{action:'read_file',path:'vortex-connection-probe.txt'}):retryDiscovery?lastFixtureAction:scripted.shift()||{action:'finish',text:'Conexão validada no Extension Host com provedor local simulado.'};
      if(action.action==='report_fixture_step'){const stale=action.stale;action={action:'report_step_result',outcome:'completed',summary:'Work ready for verification',...(stale?{step_id:'previous-step'}:{})};}
      lastFixtureAction=action;
      if(payload.tools){const {action:name,...args}=action;res.end(JSON.stringify({done:true,done_reason:'stop',message:name==='finish'?{content:action.text}:{content:'',tool_calls:[{id:'call-'+Date.now(),function:{name,arguments:args}}]}}));}
      else res.end(JSON.stringify({message:{content:JSON.stringify(action)}}));return;
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let app;
  try{
    // This suite exercises host-command approval; real Docker isolation has its own required CI job.
    const executablePath=await require('./runtime-paths.cjs').vscodePath();
    async function install(vsix){const {execFile}=require('node:child_process');const [cli,...args]=require('@vscode/test-electron').resolveCliArgsFromVSCodeExecutablePath(executablePath,{reuseMachineInstall:true});await new Promise((resolve,reject)=>execFile(cli,[...args,'--user-data-dir='+path.join(temp,'profile'),'--extensions-dir='+path.join(temp,'extensions'),'--install-extension',vsix,'--force'],{timeout:60000,shell:process.platform==='win32'},(e,out,err)=>e?reject(new Error(String(err))):resolve(out)));}
    if(process.env.VORTEX_VSIX_PATH)await install(process.env.VORTEX_UPGRADE_FROM||process.env.VORTEX_VSIX_PATH);
    async function launch(){
    app=await _electron.launch({env:{...process.env,DOCKER_HOST:'tcp://127.0.0.1:1',DOCKER_CONTEXT:''},executablePath,args:[...(process.platform==='linux'?['--password-store=basic']:[]),'--no-sandbox','--skip-welcome','--skip-release-notes','--disable-updates','--user-data-dir='+path.join(temp,'profile'),'--extensions-dir='+path.join(temp,'extensions'),...(process.env.VORTEX_VSIX_PATH?[]:['--extensionDevelopmentPath='+(process.env.VORTEX_EXTENSION_PATH||root)]),path.join(temp,'workspace')],timeout:30000});
    const window=await app.firstWindow();await window.waitForLoadState('domcontentloaded');window.setDefaultTimeout(20000);await window.locator('.monaco-workbench').waitFor();
    await window.locator('.activitybar [aria-label^="Vortex"]').first().waitFor();
    await window.keyboard.press('F1');await window.locator('.quick-input-widget input[type="text"]').fill('>Vortex: Abrir agente');await window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Vortex: Abrir agente'}).first().click();
    return window;
    }
    let window=await launch();
    async function findFrame(selector){for(let i=0;i<100;i++){for(const page of app.context().pages())for(const frame of page.frames()){try{if(await frame.locator(selector).count()&&await frame.evaluate(()=>document.readyState==='complete'))return frame;}catch(error){if(!/detached|destroyed|closed/i.test(error.message))throw error;}}await new Promise(resolve=>setTimeout(resolve,100));}await window.screenshot({path:path.join(root,'test-results','host-failure.png')});throw new Error('Webview not found: '+selector);}
    let frame=await findFrame('#prompt');await frame.evaluate(()=>{window.testStates=[];window.addEventListener('message',e=>{if(e.data.type==='state')window.testStates.push(e.data.state);});});
    await frame.locator('#prompt').fill('Rascunho preservado');await frame.locator('#open-settings').click();let settings=await findFrame('#nav-providers');await settings.locator('#add-provider').click();
    await settings.locator('#cancel-form').click();await settings.locator('#nav-execution').click();await settings.locator('[name="firstResponseTimeout"]').fill('600');await settings.locator('.execution-settings button[type="submit"]').click();
    await frame.waitForFunction(()=>window.testStates.some(s=>s.preferences.execution?.firstResponseTimeout===600));
    if(process.env.VORTEX_UPGRADE_FROM)await new Promise(resolve=>setTimeout(resolve,1000));
    await settings.locator('#nav-providers').click();await settings.locator('#add-provider').click();
    await settings.locator('#provider-kind').selectOption('ollama');await settings.locator('#provider-name').fill('Ollama test');await settings.locator('#provider-url').fill(`http://127.0.0.1:${server.address().port}`);
    await settings.locator('#test-provider').click();await settings.locator('#form-notice').filter({hasText:'Connection tested'}).waitFor();await settings.locator('#save-provider').click();await settings.locator('.connection-status').filter({hasText:'1 models'}).waitFor();await settings.locator('#cancel-form').click();
    assert.equal(await frame.locator('#prompt').inputValue(),'Rascunho preservado');
    if(process.env.VORTEX_UPGRADE_FROM)await new Promise(resolve=>setTimeout(resolve,1000));
    await frame.locator('#model-trigger').click();await frame.locator('.model-option').click();await frame.locator('#selected-model').filter({hasText:'vortex-test-model'}).waitFor();
    await frame.locator('#mode-trigger').click();await frame.locator('.choice-option').filter({hasText:'Answer questions'}).click();await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();try{await frame.locator('.message-body').filter({hasText:'Conexão validada no Extension Host'}).waitFor();}catch(e){console.log('Vortex test state:',await frame.locator('body').innerText());console.log('Snapshot trace:',await frame.evaluate(()=>JSON.stringify({received:window.testStates})));throw e;}
    await frame.waitForFunction(()=>!document.getElementById('stop')||document.getElementById('stop').hidden);if(process.env.VORTEX_UPGRADE_FROM){
      await frame.locator('#prompt').fill('Upgrade draft retained');
      const closed=app.waitForEvent('close');if(process.platform==='darwin')await window.keyboard.press('Meta+q');else await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.close();});await closed;app=undefined;await install(process.env.VORTEX_VSIX_PATH);window=await launch();frame=await findFrame('#prompt');
      await frame.evaluate(()=>{window.testStates=[];window.addEventListener('message',e=>{if(e.data.type==='state')window.testStates.push(e.data.state);});});
      await frame.locator('.message-body').filter({hasText:'Conexão validada no Extension Host'}).waitFor();
      assert.equal(await frame.locator('#prompt').inputValue(),'Upgrade draft retained');
      await frame.locator('#selected-model').filter({hasText:'vortex-test-model'}).waitFor();
      await frame.locator('#open-settings').click();settings=await findFrame('#nav-providers');await settings.locator('.connection h3').filter({hasText:'Ollama test'}).waitFor();
      await settings.locator('#nav-execution').click();assert.equal(await settings.locator('[name="firstResponseTimeout"]').inputValue(),'600');
      console.log('Upgrade preserved session, draft, connection, model selection and preferences.');
    }else{
      // Reload immediately after rapid writes: connections and preferences must survive together.
      await window.keyboard.press('F1');await window.locator('.quick-input-widget input[type="text"]').fill('>Developer: Reload Window');
      await Promise.all([window.waitForEvent('domcontentloaded'),window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Developer: Reload Window'}).first().click()]);
      await window.locator('.monaco-workbench').waitFor();frame=await findFrame('#prompt');await frame.locator('.message-body').first().waitFor();
      await frame.locator('#selected-model').filter({hasText:'vortex-test-model'}).waitFor();
      await frame.evaluate(()=>{window.testStates=[];window.addEventListener('message',e=>{if(e.data.type==='state')window.testStates.push(e.data.state);});});
      await frame.locator('#open-settings').click();settings=await findFrame('#nav-providers');await settings.locator('.connection h3').filter({hasText:'Ollama test'}).waitFor();
    }
    await settings.locator('#nav-models').click();await settings.locator('#test-chat').click();await settings.locator('#chat-test-result').filter({hasText:'OK ·'}).waitFor();
    await settings.locator('#test-tools').click();await settings.locator('#tools-test-result').filter({hasText:'Tools: validated'}).waitFor();
    await settings.locator('#output-limit').fill('8000');await settings.locator('#save-models').click();await frame.waitForFunction(()=>window.testStates.some(s=>Object.values(s.preferences.outputTokens||{}).includes(8000)));
    await settings.locator('#nav-diagnostics').click();await settings.locator('#trace-location').filter({hasText:'last-flow.json'}).waitFor();const tracePath=await settings.locator('#trace-location').innerText();const flow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.ok(flow.turns.length);assert.ok(!flow.user_question.includes('Reply OK.'));await settings.locator('#open-trace').click();
    // Settings-local export with validation, overwrite cancellation and no native dialog.
    await frame.locator('#open-settings').click();await settings.locator('#nav-diagnostics').click();
    await settings.locator('#export-trace').click();await settings.locator('#vortex-dialog-input').fill('relative.json');await settings.locator('#vortex-dialog-accept').click();
    await settings.locator('#vortex-dialog-error').filter({hasText:'absolute path'}).waitFor();
    const exported=path.join(temp,'exported-flow.json');await settings.locator('#vortex-dialog-input').fill(exported);await settings.locator('#vortex-dialog-accept').click();await settings.locator('#vortex-dialog-title').filter({hasText:'Flow exported.'}).waitFor();await settings.locator('#vortex-dialog-accept').click();
    assert.deepEqual(JSON.parse(await fs.readFile(exported,'utf8')),flow);
    await fs.writeFile(exported,'preserve');await settings.locator('#export-trace').click();await settings.locator('#vortex-dialog-input').fill(exported);await settings.locator('#vortex-dialog-accept').click();await settings.locator('#vortex-dialog-title').filter({hasText:'Replace existing file?'}).waitFor();await settings.locator('#vortex-dialog-cancel').click();assert.equal(await fs.readFile(exported,'utf8'),'preserve');
    assert.equal(await window.locator('.monaco-dialog-box').isVisible(),false);
    // Sandbox notices stay in settings. This fixture deliberately has no Docker.
    await settings.locator('#nav-execution').click();await settings.getByRole('button',{name:'Download sandbox image',exact:true}).click();await settings.locator('#vortex-dialog-title').filter({hasText:'Install and start'}).waitFor();await settings.locator('#vortex-dialog-accept').click();
    // A native editor call is read-only in Ask; invalid arguments receive a correlated correction.
    scripted=[{action:'get_editor_context',include_selection:{start_line:1}},{action:'get_editor_context',include_selection:false},{action:'finish',text:'Editor recovery validated in Ask.'}];await frame.locator('#prompt').fill('Describe the files open in this workspace');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:'Editor recovery validated in Ask.'}).waitFor();await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    const recoveredFlow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.equal(recoveredFlow.turns.length,3);assert.equal(recoveredFlow.turns[0].response.stop_reason,'tool_use');assert.equal(recoveredFlow.turns[0].response.provider_stop_reason,'stop');assert.match(recoveredFlow.turns[0].response.validation_error,/include_selection must be a boolean/);assert.equal(recoveredFlow.turns[1].request.Messages.find(m=>m.role==='tool').tool_call_id,recoveredFlow.turns[0].response.tool_calls[0].id);assert.equal(recoveredFlow.turns[2].response.stop_reason,'stop');assert.deepEqual(await fs.readdir(path.join(temp,'workspace')),[]);
    // Quoted false must stay false, never become a request for selected text.
    scripted=[{action:'get_editor_context',include_selection:'false'},{action:'finish',text:'Quoted editor flag accepted in Ask.'}];await frame.locator('#prompt').fill('Identify the open workspace files');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:'Quoted editor flag accepted in Ask.'}).waitFor();await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    const quotedFlow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.equal(quotedFlow.turns.length,2);assert.equal(quotedFlow.turns[0].response.validation_error,undefined);assert.equal(JSON.parse(quotedFlow.turns[0].response.tool_calls[0].input).include_selection,'false');const quotedResult=quotedFlow.turns[1].request.Messages.find(m=>m.role==='tool'&&m.tool_call_id===quotedFlow.turns[0].response.tool_calls[0].id);assert.ok(quotedResult);assert.equal(JSON.parse(quotedResult.content).selection,undefined);assert.deepEqual(await fs.readdir(path.join(temp,'workspace')),[]);
    // Exercise the actual sidebar approval card and WorkspaceEdit with a disposable file.
    const approvalFile=path.join(temp,'workspace','approval.txt');await fs.writeFile(approvalFile,'original');
    // Context selection is searchable in the sidebar and preserves the draft.
    await frame.locator('#prompt').fill('Context draft');await frame.locator('#attach-context').click();await frame.locator('.vortex-dialog-choice').filter({hasText:/^File$/}).click();
    await frame.locator('#vortex-dialog-search').fill('approval.txt');await frame.locator('.vortex-dialog-choice').filter({hasText:'approval.txt'}).click();
    assert.equal(await frame.locator('#prompt').inputValue(),'Context draft');await frame.locator('.context-chip').filter({hasText:'approval.txt'}).waitFor();
    await frame.locator('.context-chip button').first().click();
    await frame.locator('#attach-context').click();await frame.locator('.vortex-dialog-choice').filter({hasText:/^Folder$/}).click();await frame.locator('.vortex-dialog-choice').filter({hasText:'Use this folder'}).click();await frame.locator('.context-chip').filter({hasText:'approval.txt'}).waitFor();await frame.locator('.context-chip button').first().click();
    await frame.locator('#mode-trigger').click();await frame.locator('.choice-option').filter({hasText:'Explore and implement'}).click();
    await frame.locator('#prompt').fill('Change approval.txt to updated');
    scripted=[{action:'read_file',path:'approval.txt'},
      {action:'edit_file',path:'approval.txt',old_text:'original',new_text:'updated'}];
    await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    const dialog=window.locator('.monaco-dialog-box');let approval=frame.locator('#interaction-card');await approval.waitFor();assert.equal(await dialog.isVisible(),false);
    assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await frame.locator('#interaction-reject').click();
    await frame.locator('.message-body').filter({hasText:'Approval denied'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    scripted=[{action:'read_file',path:'approval.txt'},
      {action:'edit_file',path:'approval.txt',old_text:'original',new_text:'updated'},{action:'finish',text:'Approved edit completed.'}];
    await frame.locator('#prompt').fill('Apply the change to approval.txt');
    await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    await approval.waitFor();assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await frame.locator('#interaction-preview').click();await window.locator('.tab.active').filter({hasText:'approval.txt'}).waitFor();assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await frame.locator('#interaction-approve').click();
    await frame.locator('.message-body').filter({hasText:'Approved edit completed.'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'updated');
    scripted=[{action:'read_file',path:'approval.txt'},
      {action:'edit_file',path:'approval.txt',old_text:'updated',new_text:'bad stale edit'},{action:'finish',text:'Concurrent edit preserved.'}];
    await frame.locator('#prompt').fill('Update approval.txt once more');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    await approval.waitFor();await fs.writeFile(approvalFile,'external edit');
    await frame.locator('#interaction-approve').click();
    await frame.locator('.message-body').filter({hasText:'Concurrent edit preserved.'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'external edit');await fs.writeFile(approvalFile,'updated');
    // Stop removes the pending request without applying it.
    scripted=[{action:'read_file',path:'approval.txt'},{action:'edit_file',path:'approval.txt',old_text:'updated',new_text:'must not apply'}];
    await frame.locator('#prompt').fill('Change approval.txt');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await approval.waitFor();
    await frame.locator('#prompt').fill('My next draft');await frame.locator('#stop').click();await approval.waitFor({state:'hidden'});await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    assert.equal(await fs.readFile(approvalFile,'utf8'),'updated');assert.equal(await frame.locator('#prompt').inputValue(),'My next draft');
    // Both hunk selection and the resulting partial application stay in the sidebar.
    const hunkFile=path.join(temp,'workspace','hunks.txt'),hunkOriginal=Array.from({length:30},(_,i)=>'line '+i).join('\n');await fs.writeFile(hunkFile,hunkOriginal);
    scripted=[{action:'read_file',path:'hunks.txt'},{action:'edit_file_batch',path:'hunks.txt',edits:[{old_text:'line 1\n',new_text:'changed 1\n'},{old_text:'line 25\n',new_text:'changed 25\n'}]}];
    await frame.locator('#prompt').fill('Update two separate lines in hunks.txt');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await approval.waitFor();
    await frame.locator('.interaction-hunks summary').click();assert.equal(await frame.locator('.interaction-hunk input').count(),2);await frame.locator('.interaction-hunk input').last().uncheck();
    assert.equal(await fs.readFile(hunkFile,'utf8'),hunkOriginal);await frame.locator('#interaction-approve').click();await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    assert.equal(await fs.readFile(hunkFile,'utf8'),hunkOriginal.replace('line 1\n','changed 1\n'));assert.equal(await frame.locator('#run-status').innerText(),'Stopped');
    // All mode/permission pairs pass through the real webview and controller.
    async function choose(kind,value){await frame.locator('#'+kind+'-trigger').click();await frame.locator('.choice-option').filter({hasText:value}).click();}
    async function send(prompt,replies,expected){scripted=replies;await frame.locator('#prompt').fill(prompt);await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:expected}).waitFor();}
    await fs.writeFile(path.join(temp,'workspace','README.md'),'Workspace fixture');
    await fs.writeFile(path.join(temp,'workspace','filter-fixture.txt'),'needle fixture');
    await send('List matching project files',[
      {action:'list_files',patterns:['*.txt','README.md','*.txt'],exclude_patterns:['approval.txt','hunks.txt']},
      {action:'finish',text:'Multiple filters verified.'}],'Multiple filters verified.');
    await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    const filterFlow=JSON.parse(await fs.readFile(tracePath,'utf8'));
    const filterResult=JSON.parse(filterFlow.turns.at(-1).request.Messages.filter(m=>m.role==='tool').at(-1).content);
    assert.deepEqual(filterResult.files,['README.md','filter-fixture.txt']);
    await fs.writeFile(path.join(temp,'workspace','long-output.txt'),'retained-output-marker '.repeat(500));
    scripted=[{action:'read_file',path:'long-output.txt'},{action:'finish',text:'Retained output fixture completed.'}];await frame.locator('#prompt').fill('Read long-output.txt');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:'Retained output fixture completed.'}).waitFor();await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    const latestGroup=frame.locator('.activity-group').last();await latestGroup.locator(':scope > summary').click();await latestGroup.locator('.activity > summary').click();await latestGroup.getByRole('button',{name:'View full output'}).click();await window.locator('.tab.active').filter({hasText:/call-.*\.txt/}).waitFor();await fs.unlink(path.join(temp,'workspace','long-output.txt'));
    await fs.unlink(path.join(temp,'workspace','README.md'));await fs.unlink(path.join(temp,'workspace','filter-fixture.txt'));
    for(const permission of ['supervised','autonomous']){
      await choose('mode','Explore and implement');await choose('permission',permission==='supervised'?'Ask before editing':'Edit automatically');
      for(const [mode,label]of [['ask','Answer questions'],['plan','Analyze and create']]){
        await choose('mode',label);assert.equal(await frame.locator('#permission').inputValue(),permission);
        assert.equal(await frame.locator('#permission-trigger').isVisible(),true);
        const expected=mode+' '+permission+' stayed read-only';
        await send('Review approval.txt without changing it',[
          {action:'write_file',path:'approval.txt',content:'unauthorized'},
          {action:'run_command',command:'exit 1'},
          {action:'read_file',path:'approval.txt'},
          {action:'finish',text:expected}],expected);
        assert.equal(await fs.readFile(approvalFile,'utf8'),'updated');
        assert.equal(await dialog.isVisible(),false);
      }
    }
    await choose('mode','Analyze and create');
    await send('O que pode me dizer sobre o projeto atual?',[
      {action:'finish',text:'Vou explorar os arquivos do workspace para entender o projeto.'},
      {action:'list_files',patterns:['**/*']},
      {action:'finish',text:'Workspace inspection completed after announcement recovery.'}
    ],'Workspace inspection completed after announcement recovery.');
    const planProposal={action:'propose_plan',objective:'Update and verify approval.txt',steps:[
      {files:[{path:'approval.txt',operation:'edit'}],title:'Update file',objective:'Change updated to autonomous',depends_on:[],criteria:[{description:'File contains the expected text',verification:'command',command:'node -e "if(require(\'fs\').readFileSync(\'approval.txt\',\'utf8\')!==\'autonomous\')process.exit(1)"',cwd:'.'}]},
      {title:'Verify again',objective:'Run an independent check',depends_on:[1],criteria:[{description:'Node is available',verification:'command',command:'node --version',cwd:'.'}]},
      {title:'Review result',objective:'Review the final fixture',depends_on:[2],criteria:[{description:'The user confirms the result',verification:'human'}]}
    ]};
    await choose('mode','Explore and implement');await choose('permission','Ask before editing');await choose('mode','Analyze and create');
    const invalidProposal=structuredClone(planProposal);delete invalidProposal.steps[0].criteria[0].description;
    scripted=[invalidProposal,{action:'finish',text:'The plan was proposed. Switch to Agent.'},planProposal];await frame.locator('#prompt').fill('planeje as mudanças');await frame.locator('#send').click();await frame.locator('#plan-toggle').waitFor();await frame.locator('#plan-toggle').click();await frame.locator('#plan-approve').waitFor();await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    assert.equal(await frame.locator('.plan-step').count(),3);assert.equal(await fs.readFile(approvalFile,'utf8'),'updated');
    assert.equal(await frame.locator('.message-body').filter({hasText:'The plan was proposed. Switch to Agent.'}).count(),0);
    const proposalFlow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.equal(proposalFlow.turns.length,3);assert.match(proposalFlow.turns[0].response.validation_error,/description is required/);assert.match(proposalFlow.turns[1].response.validation_error,/structured plan is still required/);assert.equal(proposalFlow.plan.status,'proposed');
    await frame.locator('#prompt').fill('Keep the plan draft');
    scripted=[{action:'finish',text:'Please approve the plan again.'},{action:'read_file',path:'approval.txt'},{action:'edit_file',path:'approval.txt',old_text:'updated',new_text:'autonomous'},
      {action:'report_fixture_step'},
      {action:'report_fixture_step',stale:true},{action:'report_fixture_step'},{action:'read_file',path:'approval.txt'},{action:'report_fixture_step',manual:true}];
    await frame.locator('#plan-approve').click();
    // Approval covers the displayed file and exact checks: no per-action clicks.
    await frame.locator('#plan-confirm').waitFor({state:'attached'});if(await frame.locator('#plan-toggle').getAttribute('aria-expanded')!=='true')await frame.locator('#plan-toggle').click();await frame.locator('#plan-confirm').waitFor();await frame.waitForFunction(()=>document.getElementById('stop').hidden);assert.equal(await frame.locator('.plan-step[data-status="completed"]').count(),2);assert.equal(await frame.locator('#prompt').inputValue(),'Keep the plan draft');
    assert.equal(await frame.locator('.message-body').filter({hasText:'Please approve the plan again.'}).count(),0);assert.match(await frame.locator('#plan-popover').innerText(),/plan is already approved|Approved scope/);
    // Review survives reopening the session; it is never auto-accepted.
    await frame.locator('#close-chat').click();await frame.locator('#recent-sessions .session-title').first().click();await frame.locator('#plan-confirm').waitFor({state:'attached'});if(await frame.locator('#plan-toggle').getAttribute('aria-expanded')!=='true')await frame.locator('#plan-toggle').click();await frame.locator('#plan-confirm').waitFor();
    await window.keyboard.press('F1');await window.locator('.quick-input-widget input[type="text"]').fill('>Developer: Reload Window');
    await Promise.all([window.waitForEvent('domcontentloaded'),window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Developer: Reload Window'}).first().click()]);
    await window.locator('.monaco-workbench').waitFor();frame=await findFrame('#prompt');approval=frame.locator('#interaction-card');await frame.locator('#plan-confirm').waitFor({state:'attached'});if(await frame.locator('#plan-toggle').getAttribute('aria-expanded')!=='true')await frame.locator('#plan-toggle').click();await frame.locator('#plan-confirm').waitFor();assert.equal(await frame.locator('.plan-step[data-status="completed"]').count(),2);
    await frame.locator('#open-settings').click();settings=await findFrame('#nav-providers');
    if(await frame.locator('#plan-toggle').getAttribute('aria-expanded')!=='true')await frame.locator('#plan-toggle').click();await frame.locator('#plan-comment').fill('Reviewed the final fixture');await frame.locator('#plan-confirm').click();
    await frame.waitForFunction(()=>document.querySelectorAll('.plan-step[data-status="completed"]').length===3);assert.equal(await fs.readFile(approvalFile,'utf8'),'autonomous');assert.equal(await dialog.isVisible(),false);
    await choose('permission','Edit automatically');
    await send('Update approval.txt with two related replacements',[
      {action:'read_file',path:'approval.txt'},
      {action:'edit_file_batch',path:'approval.txt',edits:[{old_text:'autonomous',new_text:'verified'},{old_text:'verified',new_text:'atomic'}]},
      {action:'finish',text:'Atomic update completed.'}],'Atomic update completed.');
    assert.equal(await fs.readFile(approvalFile,'utf8'),'atomic');
    scripted=[{action:'ask_user',question:'Which test behavior do you prefer?',options:['Fast','Full'],recommended_option:'Full'},{action:'finish',text:'Decision received.'}];
    await frame.locator('#prompt').fill('Ask me which test behavior to use');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    await frame.locator('#interaction-answer').waitFor();assert.equal(await frame.locator('.interaction-recommended').innerText(),'Recommended');assert.equal(await frame.locator('#timeline [data-interaction-id]:visible').count(),0);assert.equal(await dialog.isVisible(),false);await frame.locator('.interaction-option').filter({hasText:'Full'}).click();assert.equal(await frame.locator('#interaction-answer').inputValue(),'');assert.equal(await frame.locator('.interaction-option').filter({hasText:'Full'}).getAttribute('aria-checked'),'true');await frame.locator('#interaction-approve').click();await frame.locator('.message-body').filter({hasText:'Decision received.'}).waitFor();
    await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    const answerFlow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.ok(answerFlow.turns.at(-1).request.Messages.some(m=>m.role==='tool'&&m.content==='Full'));
    scripted=[{action:'ask_user',question:'Any extra constraints?'},{action:'finish',text:'Free answer received.'}];
    await frame.locator('#prompt').fill('Discuss the constraints');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('#interaction-answer').fill('Keep the public API unchanged');await frame.locator('#interaction-approve').click();await frame.locator('.message-body').filter({hasText:'Free answer received.'}).waitFor();
    scripted=[{action:'ask_user',question:'Continue with more changes?'},{action:'write_file',path:'should-not-exist.txt',content:'unexpected'}];
    await frame.locator('#prompt').fill('Discuss further changes');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('#interaction-reject').click();await frame.waitForFunction(()=>document.getElementById('stop').hidden);await assert.rejects(fs.access(path.join(temp,'workspace','should-not-exist.txt')));assert.equal(scripted.length,1);
    await send('Create nested/new-file.txt with hello',[
      {action:'write_file',path:'nested/new-file.txt',content:'hello'},
      {action:'finish',text:'Nested file created.'}],'Nested file created.');
    assert.equal(await fs.readFile(path.join(temp,'workspace','nested','new-file.txt'),'utf8'),'hello');
    for(const permission of ['supervised','autonomous']){
      await choose('permission',permission==='supervised'?'Ask before editing':'Edit automatically');
      scripted=[{action:'run_command',command:'echo vortex-command-'+permission},{action:'finish',text:'Command approved '+permission}];
      await frame.locator('#prompt').fill('Run the requested verification command');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
      await approval.waitFor();assert.equal(await dialog.isVisible(),false);await frame.locator('#interaction-approve').click();
      await frame.locator('.message-body').filter({hasText:'Command approved '+permission}).waitFor();
      scripted=[{action:'run_command',command:'echo refused-command-'+permission}];
      await frame.locator('#prompt').fill('Run another verification command');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
      await approval.waitFor();await frame.locator('#interaction-reject').click();
      await frame.waitForFunction(()=>document.getElementById('run-status').textContent==='Stopped');
    }
    await frame.locator('#close-chat').click();await frame.locator('#recent-sessions .session-title').first().click();
    await frame.waitForFunction(()=>document.getElementById('mode').value==='agent');
    assert.equal(await frame.locator('#permission').inputValue(),'autonomous');
    // Review and undo operate on the persisted task journal.
    await frame.locator('[data-task-action="reviewChanges"]').click();
    await frame.locator('#vortex-dialog').waitFor();assert.equal(await dialog.isVisible(),false);await frame.locator('#vortex-dialog-search').fill('nested');await frame.locator('.vortex-dialog-choice').filter({hasText:'nested/new-file.txt'}).waitFor();await frame.locator('#vortex-dialog-cancel').click();
    await frame.locator('[data-task-action="undoChanges"]').click();await frame.locator('#vortex-dialog').waitFor();assert.equal(await dialog.isVisible(),false);await frame.locator('#vortex-dialog-accept').click();
    for(let i=0;i<50;i++){try{await fs.access(path.join(temp,'workspace','nested','new-file.txt'));await new Promise(r=>setTimeout(r,100));}catch{break;}}
    await frame.waitForFunction(()=>document.getElementById('stop').hidden&&document.getElementById('run-status').textContent==='Ready');
    await assert.rejects(fs.access(path.join(temp,'workspace','nested','new-file.txt')));assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await frame.locator('#open-settings').click();const sameSettings=await findFrame('#nav-providers');assert.equal(sameSettings,settings);
    await settings.getByRole('button',{name:'Edit',exact:true}).click();await settings.locator('#provider-name').fill('Edited connection');await settings.locator('#save-provider').click();await settings.locator('.connection h3').filter({hasText:'Edited connection'}).waitFor();await settings.locator('#cancel-form').click();
    await settings.getByRole('button',{name:'Remove',exact:true}).click();await settings.getByRole('button',{name:'Remove connection',exact:true}).click();await settings.locator('#connections').filter({hasText:'No providers'}).waitFor();await frame.locator('#selected-model').filter({hasText:'Select model'}).waitFor();
    await frame.locator('#close-chat').click();await frame.locator('#recent-sessions .session-title').first().waitFor();assert.equal(await frame.locator('#mode').inputValue(),'ask');await frame.locator('#recent-sessions .session-title').first().click();await frame.locator('.message-body').first().waitFor();
    await frame.locator('#close-chat').click();await frame.locator('#recent-sessions .session-title').first().waitFor();const beforeDeletion=await frame.locator('#recent-sessions .session-row').count();
    await frame.locator('#recent-sessions .session-row button[aria-label^="Delete session"]').first().click();await frame.locator('#vortex-dialog-title').filter({hasText:'Delete this session'}).waitFor();await frame.locator('#vortex-dialog-cancel').click();
    await frame.waitForFunction(n=>document.querySelectorAll('#recent-sessions .session-row').length===n,beforeDeletion);
    await frame.locator('#recent-sessions .session-title').first().click();await frame.locator('.message-body').first().waitFor();
    await frame.locator('#prompt').fill('Draft survives window reload');
    await window.keyboard.press('F1');await window.locator('.quick-input-widget input[type="text"]').fill('>Developer: Reload Window');
    await Promise.all([window.waitForEvent('domcontentloaded'),window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Developer: Reload Window'}).first().click()]);
    await window.locator('.monaco-workbench').waitFor();frame=await findFrame('#prompt');
    await frame.locator('.message-body').first().waitFor();
    assert.equal(await frame.locator('#prompt').inputValue(),'Draft survives window reload');
    await frame.locator('#open-settings').click();const restoredSettings=await findFrame('#nav-conversation');await restoredSettings.locator('#nav-execution').click();assert.equal(await restoredSettings.locator('[name="firstResponseTimeout"]').inputValue(),'600');
    await frame.waitForFunction(()=>document.getElementById('mode').value==='agent');
    assert.equal(await frame.locator('#permission').inputValue(),'autonomous');
    await frame.locator('#new-task').click();await frame.locator('#welcome').waitFor();
    const layout=await frame.evaluate(()=>({padding:getComputedStyle(document.body).paddingLeft,width:innerWidth,composer:document.querySelector('.composer').getBoundingClientRect().width}));assert.equal(layout.padding,'0px');assert.equal(Math.round(layout.width-layout.composer),32);
    await frame.locator('#open-settings').click();const gatewaySettings=await findFrame('#nav-providers');await gatewaySettings.locator('#add-provider').click();
    await gatewaySettings.locator('#provider-kind').selectOption('compatible');await gatewaySettings.locator('#provider-name').fill('Company gateway');await gatewaySettings.locator('#provider-url').fill(`http://127.0.0.1:${server.address().port}/company`);await gatewaySettings.locator('#provider-key').fill('fixture-company-key');
    await gatewaySettings.locator('#test-provider').click();await gatewaySettings.locator('#form-notice').filter({hasText:'Connection tested'}).waitFor();await gatewaySettings.locator('#save-provider').click();await gatewaySettings.locator('.connection-status').filter({hasText:'1 models'}).waitFor();await gatewaySettings.locator('#cancel-form').click();
    await frame.locator('#model-trigger').click();await frame.locator('.model-option').click();await frame.locator('#prompt').fill('Validate the gateway connection');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:'Compatible gateway validated inside VS Code.'}).waitFor();
    await window.screenshot({path:path.join(root,'test-results','extension-host.png')});
    console.log('Extension Host passed: real VS Code activation, webview CSP, provider test/save/catalog/select/send/edit/remove, draft retention including window reload, concurrent edit protection, all six mode/permission pairs, versioned three-step plan, automatic checks, manual review and reload during review, session policy restoration, supervised edit approval/refusal, autonomous edits, terminal approval/refusal under both policies, atomic multi-edit, sidebar approval cards, stop before approval, partial hunk selection, selectable/free-text/cancelled clarification and recovery of rejected editor calls in Ask, isolated tool-cycle diagnosis and response token settings. Local Ollama and compatible gateway without /v1 (Bearer key, catalog and chat) responses simulated.');
  }catch(error){if(app&&app.windows().length){const page=app.windows()[0];console.error('WORKBENCH AT FAILURE:',(await page.locator('body').innerText()).slice(-6000));await page.screenshot({path:path.join(root,'test-results','host-failure.png')}).catch(()=>{});for(const frame of page.frames())if(await frame.locator('#timeline').count()){console.error('CHAT AT FAILURE:',await frame.locator('#timeline').textContent());console.error('CHAT CONTROLS:',await frame.evaluate(()=>({prompt:document.getElementById('prompt')?.value,readOnly:document.getElementById('prompt')?.readOnly,sendDisabled:document.getElementById('send')?.disabled,status:document.getElementById('run-status')?.textContent,notice:document.getElementById('chat-notice')?.textContent})));}}throw error;}finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
