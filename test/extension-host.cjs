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
  await fs.writeFile(path.join(temp,'profile','User','settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','telemetry.telemetryLevel':'off','extensions.autoUpdate':false,'window.restoreWindows':'none','window.dialogStyle':'custom','workbench.colorTheme':'Default Dark Modern'}));
  let scripted=[];
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
      const probe=JSON.stringify(payload).includes('vortex-connection-probe.txt'),nonce=JSON.stringify(payload).match(/Verification code: ([a-f0-9-]{36})/)?.[1];const action=probe?(nonce?{action:'finish',text:'Verified '+nonce}:{action:'read',path:'vortex-connection-probe.txt'}):scripted.shift()||{action:'finish',text:'Conexão validada no Extension Host com provedor local simulado.'};
      if(payload.tools){const {action:name,...args}=action;res.end(JSON.stringify({done:true,done_reason:'stop',message:name==='finish'?{content:action.text}:{content:'',tool_calls:[{id:'call-'+Date.now(),function:{name,arguments:args}}]}}));}
      else res.end(JSON.stringify({message:{content:JSON.stringify(action)}}));return;
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let app;
  try{
    // This suite exercises host-command approval; real Docker isolation has its own required CI job.
    app=await _electron.launch({env:{...process.env,DOCKER_HOST:'tcp://127.0.0.1:1'},executablePath:await require('./runtime-paths.cjs').vscodePath(),args:['--no-sandbox','--skip-welcome','--skip-release-notes','--disable-updates','--disable-extensions','--user-data-dir='+path.join(temp,'profile'),'--extensions-dir='+path.join(temp,'extensions'),'--extensionDevelopmentPath='+(process.env.VORTEX_EXTENSION_PATH||root),path.join(temp,'workspace')],timeout:30000});
    const window=await app.firstWindow();await window.waitForLoadState('domcontentloaded');window.setDefaultTimeout(20000);await window.locator('.monaco-workbench').waitFor();
    await window.keyboard.press('F1');await window.locator('.quick-input-widget input[type="text"]').fill('>Vortex: Abrir agente');await window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Vortex: Abrir agente'}).first().click();
    async function findFrame(selector){for(let i=0;i<100;i++){for(const page of app.context().pages())for(const frame of page.frames())if(await frame.locator(selector).count())return frame;await new Promise(resolve=>setTimeout(resolve,100));}await window.screenshot({path:path.join(root,'test-results','host-failure.png')});throw new Error('Webview not found: '+selector);}
    let frame=await findFrame('#prompt');await frame.evaluate(()=>{window.testStates=[];window.addEventListener('message',e=>{if(e.data.type==='state')window.testStates.push(e.data.state);});});
    await frame.locator('#prompt').fill('Rascunho preservado');await frame.locator('#open-settings').click();const settings=await findFrame('#nav-providers');await settings.locator('#add-provider').click();
    await settings.locator('#cancel-form').click();await settings.locator('#nav-execution').click();await settings.locator('[name="firstResponseTimeout"]').fill('600');await settings.locator('.execution-settings button[type="submit"]').click();
    await frame.waitForFunction(()=>window.testStates.some(s=>s.preferences.execution?.firstResponseTimeout===600));
    await settings.locator('#nav-providers').click();await settings.locator('#add-provider').click();
    await settings.locator('#provider-kind').selectOption('ollama');await settings.locator('#provider-name').fill('Ollama test');await settings.locator('#provider-url').fill(`http://127.0.0.1:${server.address().port}`);
    await settings.locator('#test-provider').click();await settings.locator('#form-notice').filter({hasText:'Connection tested'}).waitFor();await settings.locator('#save-provider').click();await settings.locator('.connection-status').filter({hasText:'1 models'}).waitFor();await settings.locator('#cancel-form').click();
    assert.equal(await frame.locator('#prompt').inputValue(),'Rascunho preservado');
    await frame.locator('#model-trigger').click();await frame.locator('.model-option').click();await frame.locator('#selected-model').filter({hasText:'vortex-test-model'}).waitFor();
    await frame.locator('#mode-trigger').click();await frame.locator('.choice-option').filter({hasText:'Answer questions'}).click();await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();try{await frame.locator('.message-body').filter({hasText:'Conexão validada no Extension Host'}).waitFor();}catch(e){console.log('Vortex test state:',await frame.locator('body').innerText());console.log('Snapshot trace:',await frame.evaluate(()=>JSON.stringify({received:window.testStates})));throw e;}
    await frame.waitForFunction(()=>!document.getElementById('stop')||document.getElementById('stop').hidden);await settings.locator('#nav-models').click();await settings.locator('#test-chat').click();await settings.locator('#chat-test-result').filter({hasText:'OK ·'}).waitFor();
    await settings.locator('#test-tools').click();await settings.locator('#tools-test-result').filter({hasText:'Tools: validated'}).waitFor();
    await settings.locator('#output-limit').fill('8000');await settings.locator('#save-models').click();await frame.waitForFunction(()=>window.testStates.some(s=>Object.values(s.preferences.outputTokens||{}).includes(8000)));
    await settings.locator('#nav-diagnostics').click();await settings.locator('#trace-location').filter({hasText:'last-flow.json'}).waitFor();const tracePath=await settings.locator('#trace-location').innerText();const flow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.ok(flow.turns.length);assert.ok(!flow.user_question.includes('Reply OK.'));await settings.locator('#open-trace').click();
    // A native editor call is read-only in Ask; invalid arguments receive a correlated correction.
    scripted=[{action:'editor',selection:{startLine:1}},{action:'editor',selection:false},{action:'finish',text:'Editor recovery validated in Ask.'}];await frame.locator('#prompt').fill('Describe the files open in this workspace');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:'Editor recovery validated in Ask.'}).waitFor();await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    const recoveredFlow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.equal(recoveredFlow.turns.length,3);assert.equal(recoveredFlow.turns[0].response.stop_reason,'tool_use');assert.equal(recoveredFlow.turns[0].response.provider_stop_reason,'stop');assert.match(recoveredFlow.turns[0].response.validation_error,/selection must be a boolean/);assert.equal(recoveredFlow.turns[1].request.Messages.find(m=>m.role==='tool').tool_call_id,recoveredFlow.turns[0].response.tool_calls[0].id);assert.equal(recoveredFlow.turns[2].response.stop_reason,'stop');assert.deepEqual(await fs.readdir(path.join(temp,'workspace')),[]);
    // Quoted false must stay false, never become a request for selected text.
    scripted=[{action:'editor',selection:'false'},{action:'finish',text:'Quoted editor flag accepted in Ask.'}];await frame.locator('#prompt').fill('Identify the open workspace files');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:'Quoted editor flag accepted in Ask.'}).waitFor();await frame.waitForFunction(()=>document.getElementById('stop').hidden);
    const quotedFlow=JSON.parse(await fs.readFile(tracePath,'utf8'));assert.equal(quotedFlow.turns.length,2);assert.equal(quotedFlow.turns[0].response.validation_error,undefined);assert.equal(JSON.parse(quotedFlow.turns[0].response.tool_calls[0].input).selection,'false');const quotedResult=quotedFlow.turns[1].request.Messages.find(m=>m.role==='tool'&&m.tool_call_id===quotedFlow.turns[0].response.tool_calls[0].id);assert.ok(quotedResult);assert.equal(JSON.parse(quotedResult.content).selection,undefined);assert.deepEqual(await fs.readdir(path.join(temp,'workspace')),[]);
    // Exercise the actual approval dialog and WorkspaceEdit with a disposable file.
    const approvalFile=path.join(temp,'workspace','approval.txt');await fs.writeFile(approvalFile,'original');
    await frame.locator('#mode-trigger').click();await frame.locator('.choice-option').filter({hasText:'Explore and implement'}).click();
    await frame.locator('#prompt').fill('Change approval.txt to updated');
    scripted=[{action:'read',path:'approval.txt'},
      {action:'edit',path:'approval.txt',oldText:'original',newText:'updated'}];
    await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    const dialog=window.locator('.monaco-dialog-box');await dialog.waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await dialog.getByRole('button',{name:/Cancel/}).click();
    await frame.locator('.message-body').filter({hasText:'Approval denied'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    scripted=[{action:'read',path:'approval.txt'},
      {action:'edit',path:'approval.txt',oldText:'original',newText:'updated'},{action:'finish',text:'Approved edit completed.'}];
    await frame.locator('#prompt').fill('Apply the change to approval.txt');
    await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    await dialog.waitFor();assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await dialog.getByRole('button',{name:/Permitir/}).click();
    await frame.locator('.message-body').filter({hasText:'Approved edit completed.'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'updated');
    scripted=[{action:'read',path:'approval.txt'},
      {action:'edit',path:'approval.txt',oldText:'updated',newText:'bad stale edit'},{action:'finish',text:'Concurrent edit preserved.'}];
    await frame.locator('#prompt').fill('Update approval.txt once more');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    await dialog.waitFor();await fs.writeFile(approvalFile,'external edit');
    await dialog.getByRole('button',{name:/Permitir/}).click();
    await frame.locator('.message-body').filter({hasText:'Concurrent edit preserved.'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'external edit');await fs.writeFile(approvalFile,'updated');
    // All mode/permission pairs pass through the real webview and controller.
    async function choose(kind,value){await frame.locator('#'+kind+'-trigger').click();await frame.locator('.choice-option').filter({hasText:value}).click();}
    async function send(prompt,replies,expected){scripted=replies;await frame.locator('#prompt').fill(prompt);await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();await frame.locator('.message-body').filter({hasText:expected}).waitFor();}
    for(const permission of ['supervised','autonomous']){
      await choose('mode','Explore and implement');await choose('permission',permission==='supervised'?'Ask before editing':'Edit automatically');
      for(const [mode,label]of [['ask','Answer questions'],['plan','Analyze and create']]){
        await choose('mode',label);assert.equal(await frame.locator('#permission').inputValue(),permission);
        assert.equal(await frame.locator('#permission-trigger').isVisible(),true);
        const expected=mode+' '+permission+' stayed read-only';
        await send('Review approval.txt without changing it',[
          {action:'write',path:'approval.txt',content:'unauthorized'},
          {action:'command',command:'exit 1'},
          {action:'read',path:'approval.txt'},
          {action:'finish',text:expected}],expected);
        assert.equal(await fs.readFile(approvalFile,'utf8'),'updated');
        assert.equal(await dialog.isVisible(),false);
      }
    }
    await choose('mode','Analyze and create');
    await send('O que pode me dizer sobre o projeto atual?',[
      {action:'finish',text:'Vou explorar os arquivos do workspace para entender o projeto.'},
      {action:'list',pattern:'**/*'},
      {action:'finish',text:'Workspace inspection completed after announcement recovery.'}
    ],'Workspace inspection completed after announcement recovery.');
    await send('Plan an update to approval.txt',[
      {action:'plan',items:[{id:'implement',text:'Update approval.txt',status:'pending'}]},
      {action:'finish',text:'Plan ready for implementation.'}],'Plan ready for implementation.');
    assert.equal(await frame.locator('#checklist-items li').count(),1);
    await choose('mode','Explore and implement');
    assert.equal(await frame.locator('#permission').inputValue(),'autonomous');
    await send('Implement the plan for approval.txt',[
      {action:'read',path:'approval.txt'},
      {action:'edit',path:'approval.txt',oldText:'updated',newText:'autonomous'},
      {action:'plan',items:[{id:'implement',text:'Update approval.txt',status:'done'}]},
      {action:'finish',text:'Autonomous implementation verified.'}],'Autonomous implementation verified.');
    assert.equal(await fs.readFile(approvalFile,'utf8'),'autonomous');
    assert.equal(await dialog.isVisible(),false);
    await send('Update approval.txt with two related replacements',[
      {action:'read',path:'approval.txt'},
      {action:'multiEdit',path:'approval.txt',edits:[{oldText:'autonomous',newText:'verified'},{oldText:'verified',newText:'atomic'}]},
      {action:'finish',text:'Atomic update completed.'}],'Atomic update completed.');
    assert.equal(await fs.readFile(approvalFile,'utf8'),'atomic');
    scripted=[{action:'question',text:'Which test behavior do you prefer?',options:['Fast','Full']},{action:'finish',text:'Decision received.'}];
    await frame.locator('#prompt').fill('Ask me which test behavior to use');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    const answer=window.locator('.quick-input-widget input[type="text"]');await answer.waitFor();await answer.fill('Full');await window.keyboard.press('Enter');await frame.locator('.message-body').filter({hasText:'Decision received.'}).waitFor();
    await send('Create nested/new-file.txt with hello',[
      {action:'write',path:'nested/new-file.txt',content:'hello'},
      {action:'finish',text:'Nested file created.'}],'Nested file created.');
    assert.equal(await fs.readFile(path.join(temp,'workspace','nested','new-file.txt'),'utf8'),'hello');
    for(const permission of ['supervised','autonomous']){
      await choose('permission',permission==='supervised'?'Ask before editing':'Edit automatically');
      scripted=[{action:'command',command:'echo vortex-command-'+permission},{action:'finish',text:'Command approved '+permission}];
      await frame.locator('#prompt').fill('Run the requested verification command');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
      await dialog.waitFor();await dialog.getByRole('button',{name:/Executar/}).click();
      await frame.locator('.message-body').filter({hasText:'Command approved '+permission}).waitFor();
      scripted=[{action:'command',command:'echo refused-command-'+permission}];
      await frame.locator('#prompt').fill('Run another verification command');await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
      await dialog.waitFor();await dialog.getByRole('button',{name:/Cancel/}).click();
      await frame.waitForFunction(()=>document.getElementById('run-status').textContent==='Stopped');
    }
    await frame.locator('#close-chat').click();await frame.locator('#recent-sessions .session-title').first().click();
    await frame.waitForFunction(()=>document.getElementById('mode').value==='agent');
    assert.equal(await frame.locator('#permission').inputValue(),'autonomous');
    // Review and undo operate on the persisted task journal.
    await frame.locator('[data-task-action="reviewChanges"]').click();
    await window.locator('.quick-input-widget input[type="text"]').waitFor();await window.keyboard.press('Escape');
    await frame.locator('[data-task-action="undoChanges"]').click();await dialog.waitFor();await dialog.getByRole('button',{name:'Undo',exact:true}).click();
    for(let i=0;i<50;i++){try{await fs.access(path.join(temp,'workspace','nested','new-file.txt'));await new Promise(r=>setTimeout(r,100));}catch{break;}}
    await assert.rejects(fs.access(path.join(temp,'workspace','nested','new-file.txt')));assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await frame.locator('#open-settings').click();const sameSettings=await findFrame('#nav-providers');assert.equal(sameSettings,settings);
    await settings.getByRole('button',{name:'Edit',exact:true}).click();await settings.locator('#provider-name').fill('Edited connection');await settings.locator('#save-provider').click();await settings.locator('.connection h3').filter({hasText:'Edited connection'}).waitFor();await settings.locator('#cancel-form').click();
    await settings.getByRole('button',{name:'Remove',exact:true}).click();await settings.getByRole('button',{name:'Remove connection',exact:true}).click();await settings.locator('#connections').filter({hasText:'No providers'}).waitFor();await frame.locator('#selected-model').filter({hasText:'Select model'}).waitFor();
    await frame.locator('#close-chat').click();await frame.locator('#recent-sessions .session-title').first().waitFor();assert.equal(await frame.locator('#mode').inputValue(),'ask');await frame.locator('#recent-sessions .session-title').first().click();await frame.locator('.message-body').first().waitFor();
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
    console.log('Extension Host passed: real VS Code activation, webview CSP, provider test/save/catalog/select/send/edit/remove, draft retention including window reload, concurrent edit protection, all six mode/permission pairs, Plan→Agent checklist, session policy restoration, supervised edit approval/refusal, autonomous edits, terminal approval/refusal under both policies, atomic multi-edit, interactive clarification and recovery of rejected editor calls in Ask, isolated tool-cycle diagnosis and response token settings. Local Ollama and compatible gateway without /v1 (Bearer key, catalog and chat) responses simulated.');
  }catch(error){if(app){const page=app.windows()[0];await page.screenshot({path:path.join(root,'test-results','host-failure.png')}).catch(()=>{});for(const frame of page.frames())if(await frame.locator('#timeline').count())console.error('CHAT AT FAILURE:',await frame.locator('#timeline').innerText());}throw error;}finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
