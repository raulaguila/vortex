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
  const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/show'){res.end(JSON.stringify({model_info:{'test.context_length':32768}}));return;}if(req.url==='/api/tags')res.end(JSON.stringify({models:[{name:'vortex-test-model'}]}));else if(req.url==='/api/chat')res.end(JSON.stringify({message:{content:JSON.stringify(scripted.shift()||{action:'finish',text:'Conexão validada no Extension Host com provedor local simulado.'})}}));else{res.statusCode=404;res.end('{}');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let app;
  try{
    app=await _electron.launch({executablePath:process.env.VSCODE_PATH||'/Applications/Visual Studio Code.app/Contents/MacOS/Code',args:['--no-sandbox','--skip-welcome','--skip-release-notes','--disable-updates','--disable-extensions','--user-data-dir='+path.join(temp,'profile'),'--extensions-dir='+path.join(temp,'extensions'),'--extensionDevelopmentPath='+(process.env.VORTEX_EXTENSION_PATH||root),path.join(temp,'workspace')],timeout:30000});
    const window=await app.firstWindow();await window.waitForLoadState('domcontentloaded');window.setDefaultTimeout(20000);await window.locator('.monaco-workbench').waitFor();
    await window.keyboard.press('F1');await window.locator('.quick-input-widget input').fill('>Vortex: Abrir agente');await window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Vortex: Abrir agente'}).first().click();
    async function findFrame(selector){for(let i=0;i<100;i++){for(const page of app.context().pages())for(const frame of page.frames())if(await frame.locator(selector).count())return frame;await new Promise(resolve=>setTimeout(resolve,100));}await window.screenshot({path:path.join(root,'test-results','host-failure.png')});throw new Error('Webview not found: '+selector);}
    let frame=await findFrame('#prompt');await frame.evaluate(()=>{window.testStates=[];window.addEventListener('message',e=>{if(e.data.type==='state')window.testStates.push(e.data.state);});});
    await frame.locator('#prompt').fill('Rascunho preservado');await frame.locator('#open-settings').click();const settings=await findFrame('#nav-providers');await settings.locator('#add-provider').click();
    await settings.locator('#provider-kind').selectOption('ollama');await settings.locator('#provider-name').fill('Ollama test');await settings.locator('#provider-url').fill(`http://127.0.0.1:${server.address().port}`);
    await settings.locator('#test-provider').click();await settings.locator('#form-notice').filter({hasText:'Connection tested'}).waitFor();await settings.locator('#save-provider').click();await settings.locator('.connection-status').filter({hasText:'1 models'}).waitFor();await settings.locator('#cancel-form').click();
    assert.equal(await frame.locator('#prompt').inputValue(),'Rascunho preservado');
    await frame.locator('#model-trigger').click();await frame.locator('.model-option').click();await frame.locator('#selected-model').filter({hasText:'vortex-test-model'}).waitFor();
    await frame.locator('#mode-trigger').click();await frame.locator('.choice-option').filter({hasText:'Answer questions'}).click();await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();try{await frame.locator('.message-body').filter({hasText:'Conexão validada no Extension Host'}).waitFor();}catch(e){console.log('Vortex test state:',await frame.locator('body').innerText());console.log('Snapshot trace:',await frame.evaluate(()=>JSON.stringify({current:state,received:window.testStates})));throw e;}
    // Exercise the actual approval dialog and WorkspaceEdit with a disposable file.
    const approvalFile=path.join(temp,'workspace','approval.txt');await fs.writeFile(approvalFile,'original');
    await frame.locator('#mode-trigger').click();await frame.locator('.choice-option').filter({hasText:'Explore and implement'}).click();
    await frame.locator('#prompt').fill('Change approval.txt to updated');
    scripted=[{action:'edit',path:'approval.txt',oldText:'original',newText:'updated'}];
    await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    const dialog=window.locator('.monaco-dialog-box');await dialog.waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await dialog.getByRole('button',{name:/Cancel/}).click();
    await frame.locator('.message-body').filter({hasText:'Approval denied'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    scripted=[{action:'edit',path:'approval.txt',oldText:'original',newText:'updated'},{action:'finish',text:'Approved edit completed.'}];
    await frame.locator('#prompt').fill('Apply the change to approval.txt');
    await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();
    await dialog.waitFor();assert.equal(await fs.readFile(approvalFile,'utf8'),'original');
    await dialog.getByRole('button',{name:/Permitir/}).click();
    await frame.locator('.message-body').filter({hasText:'Approved edit completed.'}).waitFor();
    assert.equal(await fs.readFile(approvalFile,'utf8'),'updated');
    scripted=[{action:'edit',path:'approval.txt',oldText:'updated',newText:'bad stale edit'},{action:'finish',text:'Concurrent edit preserved.'}];
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
    await send('Plan an update to approval.txt',[
      {action:'plan',items:[{id:'implement',text:'Update approval.txt',status:'pending'}]},
      {action:'finish',text:'Plan ready for implementation.'}],'Plan ready for implementation.');
    assert.equal(await frame.locator('#checklist-items li').count(),1);
    await choose('mode','Explore and implement');
    assert.equal(await frame.locator('#permission').inputValue(),'autonomous');
    await send('Implement the plan for approval.txt',[
      {action:'edit',path:'approval.txt',oldText:'updated',newText:'autonomous'},
      {action:'plan',items:[{id:'implement',text:'Update approval.txt',status:'done'}]},
      {action:'finish',text:'Autonomous implementation verified.'}],'Autonomous implementation verified.');
    assert.equal(await fs.readFile(approvalFile,'utf8'),'autonomous');
    assert.equal(await dialog.isVisible(),false);
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
    await frame.locator('#open-settings').click();const sameSettings=await findFrame('#nav-providers');assert.equal(sameSettings,settings);
    await settings.getByRole('button',{name:'Edit',exact:true}).click();await settings.locator('#provider-name').fill('Edited connection');await settings.locator('#save-provider').click();await settings.locator('.connection h3').filter({hasText:'Edited connection'}).waitFor();await settings.locator('#cancel-form').click();
    await settings.getByRole('button',{name:'Remove',exact:true}).click();await settings.getByRole('button',{name:'Remove connection',exact:true}).click();await settings.locator('#connections').filter({hasText:'No providers'}).waitFor();await frame.locator('#selected-model').filter({hasText:'Select model'}).waitFor();
    await frame.locator('#close-chat').click();await frame.locator('#recent-sessions .session-title').first().waitFor();assert.equal(await frame.locator('#mode').inputValue(),'ask');await frame.locator('#recent-sessions .session-title').first().click();await frame.locator('.message-body').first().waitFor();
    await frame.locator('#prompt').fill('Draft survives window reload');
    await window.keyboard.press('F1');await window.locator('.quick-input-widget input').fill('>Developer: Reload Window');
    await Promise.all([window.waitForEvent('domcontentloaded'),window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Developer: Reload Window'}).first().click()]);
    await window.locator('.monaco-workbench').waitFor();frame=await findFrame('#prompt');
    await frame.locator('.message-body').first().waitFor();
    assert.equal(await frame.locator('#prompt').inputValue(),'Draft survives window reload');
    await frame.waitForFunction(()=>document.getElementById('mode').value==='agent');
    assert.equal(await frame.locator('#permission').inputValue(),'autonomous');
    await frame.locator('#new-task').click();await frame.locator('#welcome').waitFor();
    const layout=await frame.evaluate(()=>({padding:getComputedStyle(document.body).paddingLeft,width:innerWidth,composer:document.querySelector('.composer').getBoundingClientRect().width}));assert.equal(layout.padding,'0px');assert.equal(Math.round(layout.width-layout.composer),32);
    await window.screenshot({path:path.join(root,'test-results','extension-host.png')});
    console.log('Extension Host passed: real VS Code activation, webview CSP, provider test/save/catalog/select/send/edit/remove, draft retention including window reload, concurrent edit protection, all six mode/permission pairs, Plan→Agent checklist, session policy restoration, supervised edit approval/refusal, autonomous edits, and terminal approval/refusal under both policies. Local Ollama responses simulated.');
  }finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
