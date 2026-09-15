/* Browser integration against the real provider manager, with simulated provider responses. */
const {chromium} = require('playwright-core');
const {createServer} = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ProviderManager} = require('../dist/providerManager');
const {parseRequest} = require('../dist/protocol');
const {renderSidebar} = require('../dist/view');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const themes = {
  dark: {'sideBar-background':'#181818','foreground':'#cccccc','descriptionForeground':'#989898','input-background':'#222222','input-foreground':'#cccccc','input-placeholderForeground':'#929292','focusBorder':'#007fd4','button-background':'#0078d4','button-foreground':'#ffffff','widget-border':'#333333','quickInput-background':'#252526','textLink-foreground':'#75bfff'},
  light: {'sideBar-background':'#f8f8f8','foreground':'#3b3b3b','descriptionForeground':'#616161','input-background':'#ffffff','input-foreground':'#3b3b3b','input-placeholderForeground':'#767676','focusBorder':'#005fb8','button-background':'#005fb8','button-foreground':'#ffffff','widget-border':'#cecece','quickInput-background':'#ffffff','textLink-foreground':'#005fb8','toolbar-hoverBackground':'#0000000d','list-inactiveSelectionBackground':'#e4e6f1'},
  contrast: {'sideBar-background':'#000000','foreground':'#ffffff','descriptionForeground':'#ffffff','input-background':'#000000','input-foreground':'#ffffff','input-placeholderForeground':'#ffffff','focusBorder':'#f38518','button-background':'#000000','button-foreground':'#ffffff','widget-border':'#6fc3df','input-border':'#6fc3df','contrastBorder':'#6fc3df','quickInput-background':'#000000','textLink-foreground':'#4daafc'}
};
class Storage { values=new Map();get(k,d){return this.values.has(k)?structuredClone(this.values.get(k)):d;}async update(k,v){this.values.set(k,structuredClone(v));} }
class Secrets {values=new Map();async get(k){return this.values.get(k);}async store(k,v){this.values.set(k,v);}async delete(k){this.values.delete(k);} }
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const server=createServer(async(req,res)=>{try{if(req.url==='/'||req.url==='/settings'){const isSettings=req.url==='/settings';const template=await fs.readFile(path.join(root,'media',isSettings?'settings.html':'sidebar.html'),'utf8');res.setHeader('Content-Type','text/html');res.end(renderSidebar(template,{cspSource:"'self'",nonce:'test',style:isSettings?'/settings.css':'/style.css',script:isSettings?'/settings.js':'/app.js',logo:'/vortex.svg',shared:'/shared.js',vendor:'/vendor.js',picker:'/picker.js',version:require('../package.json').version}));}else if(['/style.css','/settings.css','/app.js','/settings.js','/shared.js','/vendor.js','/picker.js','/vortex.svg'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'image/svg+xml');res.end(await fs.readFile(path.join(root,'media',req.url.slice(1))));}else{res.statusCode=404;res.end();}}catch(e){res.statusCode=500;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const context=await browser.newContext();const pages=new Set();let settings,chat;const errors=[];let startCount=0,executionSaves=0,copied='';
  const manager=new ProviderManager(new Storage(),new Secrets(),async url=>new Response(JSON.stringify(url.includes('/models/')?{context_length:32768}: {data:[{id:'chat-model'},{id:'plan-model'}]})));
  const post=(page,m)=>page.isClosed()?Promise.resolve():page.evaluate(m=>window.postMessage(m,'*'),m);
  const broadcast=async()=>{const state=await manager.snapshot();await Promise.all([...pages].filter(p=>!p.isClosed()).map(p=>post(p,{type:'state',state,busy:false})));};
  const sessions=[{id:'11111111-1111-1111-1111-111111111111',title:'Explore the repository',updatedAt:Date.now()}];
  async function createPage(isSettings){
   const page=await context.newPage();pages.add(page);page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
   await page.exposeFunction('bridge',async raw=>{const m=parseRequest(raw);const ok=(message,providerId)=>post(page,{type:'result',requestId:m.requestId,ok:true,message,providerId});try{switch(m.type){
    case 'copyText':copied=m.text;await ok();return;
    case 'ready':await broadcast();if(isSettings)await post(page,{type:'settingsSection',section:'providers'});else await post(page,{type:'history',events:[],busy:false,status:'Ready'});return;
    case 'openSettings':if(!settings||settings.isClosed())settings=await createPage(true);await post(settings,{type:'settingsSection',section:m.section||'providers'});await ok();return;
    case 'saveProvider':{const id=await manager.save(m.provider);await broadcast();await ok('Connection saved.',id);await manager.refresh(id,m.requestId,broadcast);return;}
    case 'testProvider':await ok('Connection tested: '+await manager.test(m.provider)+' models in catalog. This does not prove chat support.');return;
    case 'selectModel':await manager.setSelection(m.model);break;
    case 'favoriteModel':await manager.favorite(m.model,m.favorite);break;
    case 'setDefaultModel':await manager.setDefault(m.mode,m.model);break;
    case 'applyMode':await manager.applyMode(m.mode);break;
    case 'saveModels':await manager.saveModels(m.settings);break;
    case 'traceInfo':await post(page,{type:'traceInfo',path:'/local/last-flow.json',exists:false,bytes:0});return;
    case 'setExecution':executionSaves++;await manager.setExecution(m.execution);break;
    case 'setConversation':await manager.setConversation(m.patch);break;
    case 'manualModel':await manager.manual(m.model,m.remove);break;
    case 'modelInfo':await manager.inspect(m.model);break;
    case 'setContext':await manager.setContext(m.model,m.source,m.tokens);break;
    case 'removeProvider':await manager.remove(m.id);break;
    case 'refreshModels':await manager.refresh(m.id,m.requestId,broadcast);break;
    case 'refreshAllModels':await Promise.all(manager.providers().map(p=>manager.refresh(p.id,m.requestId,broadcast)));break;
    case 'listSessions':await post(page,{type:'sessions',sessions:sessions.filter(s=>s.title.toLowerCase().includes(m.query.toLowerCase())),requestId:m.requestId});return;
    case 'clear':await post(page,{type:'checklist',items:[]});await manager.applyMode(m.mode);await broadcast();await post(page,{type:'history',events:[],busy:false,status:'Ready'});return;
    case 'loadSession':await post(page,{type:'history',events:[{role:'user',text:'Restored session'}],busy:false,status:'Ready'});return;
    case 'start':startCount++;await post(page,{type:'accepted',requestId:m.requestId});await post(page,{type:'event',event:{role:'user',text:m.prompt}});await post(page,{type:'checklist',items:[{id:'one',text:'Inspect code',status:'done'},{id:'two',text:'Implement tests',status:'pending'}]});await post(page,{type:'context',used:2048,budget:16384,removed:2,source:'fallback'});await post(page,{type:'event',event:{role:'assistant',text:'## Result\n- [x] Inspected\n\n```js\nconst safe = true;\n```\n<script>alert(1)</script> [bad](javascript:alert(1))'}});await post(page,{type:'runEnd',requestId:m.requestId,status:'complete'});return;
   }await broadcast();await ok();}catch(e){await post(page,{type:'result',requestId:m.requestId,ok:false,message:e.message});}});
   await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('ui')||'null'),setState:v=>sessionStorage.setItem('ui',JSON.stringify(v)),postMessage:m=>{void window.bridge(m);}});});
   await page.goto(`http://127.0.0.1:${server.address().port}${isSettings?'/settings':'/'}`);return page;
  }
  chat=await createPage(false);await chat.setViewportSize({width:360,height:800});
  assert.equal(await chat.locator('#mode').inputValue(),'ask');assert.equal(await chat.locator('#all-sessions').count(),0);
  await chat.locator('#mode-trigger').click();assert.deepEqual(await chat.locator('.choice-option strong').allTextContents(),[' Ask',' Plan',' Agent']);await chat.locator('#choice-menu').press('Escape');
  await chat.locator('#prompt').fill('Keep this draft');await chat.locator('#open-settings').click();
  while(!settings)await new Promise(r=>setTimeout(r,20));await settings.setViewportSize({width:800,height:800});
  await settings.locator('#add-provider').click();assert.equal(await settings.locator('#provider-dialog').evaluate(d=>d.open),true);
  await settings.locator('#provider-kind').selectOption('compatible');await settings.locator('#provider-name').fill('Personal endpoint');await settings.locator('#provider-url').fill('http://models.example/v1');await settings.locator('#tls-insecure').check();await settings.locator('#provider-key').fill('test-only-key');
  await settings.locator('#test-provider').click();await settings.locator('#form-notice').filter({hasText:'Connection tested'}).waitFor();await settings.locator('#save-provider').click();await settings.locator('.connection-status').filter({hasText:'2 models'}).waitFor();assert.equal(await settings.locator('#provider-key').inputValue(),'');await settings.locator('#cancel-form').click();
  assert.equal(await chat.locator('#prompt').inputValue(),'Keep this draft');
  await chat.locator('#open-settings').click();assert.equal([...pages].filter(p=>!p.isClosed()).length,2);
  await settings.locator('#nav-models').click();const id=manager.providers()[0].id;
  await settings.locator('#default-plan').selectOption(JSON.stringify([id,'plan-model']));await settings.locator('#context-model').selectOption(JSON.stringify([id,'chat-model']));await settings.locator('#context-limit').filter({hasText:'32,768'}).waitFor();await settings.locator('#context-source').selectOption('custom');await settings.locator('#context-tokens').fill('8192');await settings.locator('#save-models').click();
  await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Analyze and create'}).click();await chat.locator('#selected-model').filter({hasText:'plan-model'}).waitFor();
  await chat.locator('#model-trigger').click();await chat.locator('#refresh-models').click();await chat.waitForFunction(()=>!document.getElementById('refresh-models').disabled);await chat.locator('.model-option').filter({hasText:'chat-model'}).click();
  await chat.locator('#context-status').filter({hasText:'8,192'}).waitFor();
  await settings.locator('#context-source').selectOption('api');await settings.locator('#save-models').click();await chat.locator('#context-status').filter({hasText:'32,768'}).waitFor();
  // API metadata arrives after the selection; the same model must update immediately.
  await manager.setContext({providerId:id,modelId:'chat-model'},'api',32768);
  manager.transport=async()=>new Response(JSON.stringify({context_length:262144}));
  await manager.inspect({providerId:id,modelId:'chat-model'});await broadcast();await chat.locator('#context-status').filter({hasText:'262,144'}).waitFor();
  await settings.waitForFunction(()=>document.getElementById('context-tokens').value==='262144');
  assert.equal(await settings.locator('#context-tokens').inputValue(),'262144');
  await manager.setContext({providerId:id,modelId:'chat-model'},'api',262144);
  manager.transport=async()=>new Response(JSON.stringify({context_length:131072}));
  await manager.inspect({providerId:id,modelId:'chat-model'});await broadcast();
  await chat.locator('#context-status').filter({hasText:'131,072'}).waitFor();await settings.waitForFunction(()=>document.getElementById('context-tokens').value==='131072');assert.equal(await settings.locator('#context-tokens').inputValue(),'131072');
  await post(chat,{type:'context',model:{providerId:id,modelId:'chat-model'},used:100,budget:65536,source:'api',removed:0});
  await chat.locator('#context-status').filter({hasText:'131,072'}).waitFor();
  await post(chat,{type:'context',model:{providerId:id,modelId:'different-model'},used:1,budget:1024,source:'custom',removed:0});
  assert.ok((await chat.locator('#context-status').innerText()).includes('131,072'));
  manager.transport=async url=>new Response(JSON.stringify(url.includes('/models/')?{context_length:32768}:{data:[{id:'chat-model'},{id:'plan-model'}]}));
  for(const trigger of ['mode','permission']){
    if(trigger==='permission'){await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Explore and implement'}).click();}
    await chat.locator('#'+trigger+'-trigger').click();const pop=await chat.locator('#choice-menu').boundingBox();const composer=await chat.locator('.composer').boundingBox();assert.ok(pop.y+pop.height<=composer.y-4);assert.equal(Math.round(pop.width),Math.round(composer.width));
    await chat.locator('#choice-menu').press('Escape');assert.equal(await chat.locator('#'+trigger+'-trigger').getAttribute('aria-expanded'),'false');
  }
  await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Analyze and create'}).click();
  await settings.locator('#nav-conversation').click();await settings.locator('#send-key').selectOption('modifierEnter');await settings.locator('#font-size').selectOption('18');await settings.locator('#ui-language').selectOption('pt');assert.equal(await chat.locator('#prompt').evaluate(el=>getComputedStyle(el).fontSize),'13px');await settings.locator('#save-conversation').click();await chat.locator('#mode-trigger').filter({hasText:'Planejar'}).waitFor();assert.equal(await chat.locator('#prompt').evaluate(el=>getComputedStyle(el).fontSize),'18px');
  await chat.locator('#prompt').press('Enter');assert.equal(startCount,0);await chat.locator('#prompt').press('Control+Enter');await chat.locator('.message-body h2').waitFor();assert.equal(startCount,1);assert.equal(await chat.locator('.message-body script').count(),0);assert.equal(await chat.locator('.message-body a[href^="javascript:"]').count(),0);assert.equal(await chat.locator('#checklist-items li').count(),2);
  await settings.locator('#ui-language').selectOption('en');await settings.locator('#font-size').selectOption('');await settings.locator('#save-conversation').click();
  await chat.locator('#history-button').click();await chat.locator('#session-search').fill('repository');await chat.locator('#sessions-results .session-title').waitFor();await chat.locator('#close-sessions').click();
  for(const [theme,tokens]of Object.entries(themes)){
   for(const p of [chat,settings])await p.evaluate(({theme,tokens})=>{document.body.classList.remove('vscode-high-contrast','vscode-light','vscode-dark');document.body.classList.add(theme==='contrast'?'vscode-high-contrast':'vscode-'+theme);for(const [key,value]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+key,value);},{theme,tokens});
   for(const width of [280,360,480]){await chat.setViewportSize({width,height:800});await chat.screenshot({path:path.join(output,`v2-${theme}-${width}-chat.png`)});assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await chat.locator('#model-trigger').click();const box=await chat.locator('#model-picker').boundingBox();assert.ok(box.y>=0&&box.x>=0&&box.x+box.width<=width);await chat.screenshot({path:path.join(output,`v2-${theme}-${width}-models.png`)});await chat.locator('#close-picker').click();}
   for(const width of [480,800,1200]){await settings.setViewportSize({width,height:800});for(const section of ['providers','models','conversation','execution','diagnostics']){await settings.locator('#nav-'+section).click();await settings.screenshot({path:path.join(output,`v2-${theme}-${width}-${section}.png`)});assert.ok(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}}
  }
  // Representative conversation and functional message actions.
  const longMessage='Please improve the account screen.\n'.repeat(24);
  await post(chat,{type:'history',events:[{role:'user',text:longMessage,timestamp:Date.now()},{role:'activity',text:'read · account.ts · success\nRead 80 lines.'},{role:'activity',text:'edit · account.ts · denied\nApproval denied.'},{role:'assistant',text:'## Account screen\nThe edit was **not applied** because approval was declined.\n\n- Existing files are unchanged.\n- You can review the proposed implementation.\n\n```ts\nconst enabled = true;\n```',timestamp:Date.now()}],busy:false,status:'Ready'});
  await chat.locator('.expand-message').waitFor();assert.equal(await chat.locator('.activity-group').count(),1);assert.equal(await chat.locator('.activity-group .activity').count(),2);
  assert.equal(await chat.locator('.activity-group').getAttribute('open'),null);
  await chat.locator('.activity-group > summary').click();assert.equal(await chat.locator('.activity-label').first().innerText(),'Read file');assert.equal(await chat.locator('.activity-label').nth(1).innerText(),'Action declined');
  assert.equal(await chat.locator('.activity-path').first().innerText(),'account.ts');await chat.locator('.activity > summary').first().click();assert.equal(await chat.locator('.activity-output pre').first().innerText(),'Read 80 lines.');
  await chat.setViewportSize({width:360,height:800});await chat.screenshot({path:path.join(output,'activity-details-360.png')});await chat.locator('.activity-group > summary').click();

  await chat.locator('.expand-message').click();assert.equal(await chat.locator('.message-collapsed').count(),0);await chat.locator('.expand-message').click();
  await chat.locator('article.user').getByRole('button',{name:'Copy message'}).click();await chat.waitForFunction(()=>document.querySelector('article.user .message-action').title==='Copied');assert.equal(copied,longMessage);
  const startsBefore=startCount;await chat.locator('article.user').getByRole('button',{name:'Reuse message'}).click();assert.equal(await chat.locator('#prompt').inputValue(),longMessage);assert.equal(startCount,startsBefore);await chat.locator('#prompt').fill('');
  assert.ok((await chat.locator('#chat-heading').innerText()).startsWith('Please improve'));
  for(const width of [280,360,480]){await chat.setViewportSize({width,height:800});for(const [theme,tokens] of Object.entries(themes)){await chat.evaluate(tokens=>{for(const [key,value]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+key,value);},tokens);await chat.screenshot({path:path.join(output,`v4-${theme}-${width}-conversation.png`)});assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}}
  await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Explore and implement'}).click();
  assert.equal(await chat.locator('#permission-trigger use').getAttribute('href'),'#i-hand');
  await chat.locator('#permission-trigger').click();await chat.locator('.choice-option').filter({hasText:'Edit automatically'}).click();assert.equal(await chat.locator('#permission-trigger use').getAttribute('href'),'#i-bolt');
  assert.equal(await chat.locator('.permissions > svg').count(),0);
  await chat.setViewportSize({width:800,height:800});
  const modelBox=await chat.locator('#model-trigger').boundingBox();const toolbarBox=await chat.locator('.composer-toolbar').boundingBox();assert.ok(modelBox.width<toolbarBox.width/2,'Model hover must not stretch across unused space');
  await chat.locator('#model-trigger').hover();await chat.screenshot({path:path.join(output,'v3-wide-hover.png')});
  await post(chat,{type:'checklist',items:[]});
  await post(chat,{type:'history',events:[{role:'user',text:'oi'},{role:'assistant',text:'Oi! Como posso ajudar?'},{role:'user',text:'tudo bem?'},{role:'assistant',text:'Tudo bem! O que você quer construir?'}],busy:false,status:'Ready'});
  for(const width of [280,360,480,538]){
    await chat.setViewportSize({width,height:1030});await chat.locator('#prompt').fill('');
    await chat.evaluate(tokens=>{document.body.className='vscode-dark';for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [key,value]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+key,value);document.getElementById('timeline').scrollTop=0;},themes.dark);
    const bounds=await chat.locator('.composer').boundingBox();assert.equal(Math.round(bounds.x),16);assert.equal(Math.round(width-bounds.x-bounds.width),16);assert.ok(bounds.height<=(width>430?116:152));
    await chat.screenshot({path:path.join(output,`v5-spacing-${width}.png`)});
  }
  for(const [text,expected]of [['Waiting for model','Waiting for model'],['Reading file · src/example.ts','Reading file · src/example.ts'],['Running command','Running command'],['Waiting for approval','Waiting for approval']]){
    await post(chat,{type:'status',busy:true,text});await chat.locator('#run-progress').waitFor();assert.equal(await chat.locator('.progress-label').innerText(),expected);
  }
  await chat.setViewportSize({width:280,height:800});await post(chat,{type:'status',busy:true,text:'Reading file · src/very/long/path/to/a/component/example.ts'});assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await chat.screenshot({path:path.join(output,'live-progress-280.png')});
  await chat.evaluate(()=>window.VortexUI.setLanguage('pt'));await post(chat,{type:'status',busy:true,text:'Waiting for model'});assert.equal(await chat.locator('.progress-label').innerText(),'Aguardando o modelo');
  await post(chat,{type:'history',events:[{role:'user',text:'Review files'}],busy:true,status:'Reading file · README.md'});assert.equal(await chat.locator('.progress-label').innerText(),'Lendo arquivo · README.md');
  await post(chat,{type:'status',busy:false,text:'Concluído'});assert.equal(await chat.locator('#run-progress').isVisible(),false);await chat.evaluate(()=>window.VortexUI.setLanguage('en'));
  await chat.locator('#close-chat').click();await chat.locator('#welcome').waitFor();assert.equal(await chat.locator('#mode').inputValue(),'ask');assert.equal(await chat.locator('#checklist').isVisible(),false);assert.equal(await chat.locator('#prompt').inputValue(),'');
  await chat.locator('#recent-sessions .session-title').first().click();await chat.locator('.message-body').filter({hasText:'Restored session'}).waitFor();await chat.locator('#new-task').click();await chat.locator('#welcome').waitFor();
  await settings.locator('#nav-providers').click();await settings.getByRole('button',{name:'Edit',exact:true}).click();await settings.locator('#provider-name').fill('Unsaved name');await settings.locator('#provider-key').fill('temporary-secret');await settings.locator('#cancel-form').click();await settings.close();await chat.locator('#open-settings').click();while(settings.isClosed())await new Promise(r=>setTimeout(r,20));await settings.getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await settings.locator('#provider-key').inputValue(),'');assert.equal(await settings.locator('#provider-name').inputValue(),'Personal endpoint');
  await post(chat,{type:'taskState',resume:false,implementPlan:false,reviewChanges:false,undoChanges:false});assert.equal(await chat.locator('.task-actions').isVisible(),false);
  await post(chat,{type:'taskState',resume:true,implementPlan:false,reviewChanges:true,undoChanges:false});assert.equal(await chat.locator('[data-task-action="resume"]').isVisible(),true);assert.equal(await chat.locator('[data-task-action="reviewChanges"]').isVisible(),true);assert.equal(await chat.locator('[data-task-action="undoChanges"]').isVisible(),false);
  await post(chat,{type:'status',busy:true,text:'Waiting for your answer'});assert.equal(await chat.locator('.task-actions').isVisible(),false);assert.equal(await chat.locator('.progress-label').innerText(),'Waiting for your answer');
  await settings.locator('#cancel-form').click();await settings.locator('#nav-execution').click();const modelTimeout=settings.locator('[name="firstResponseTimeout"]');assert.equal(await modelTimeout.inputValue(),'120');await modelTimeout.fill('600');assert.equal(await modelTimeout.evaluate(el=>el.checkValidity()),true);await modelTimeout.fill('0');assert.equal(await modelTimeout.evaluate(el=>el.checkValidity()),false);await modelTimeout.fill('120');
  // Section navigation wraps in both directions; reset/discard never submits the form.
  await settings.locator('#nav-providers').focus();await settings.locator('#nav-providers').press('ArrowLeft');assert.equal(await settings.locator('#nav-diagnostics').evaluate(el=>el===document.activeElement),true);await settings.locator('#nav-diagnostics').press('ArrowRight');assert.equal(await settings.locator('#nav-providers').evaluate(el=>el===document.activeElement),true);
  await settings.locator('#nav-execution').click();await modelTimeout.fill('600');await settings.locator('.execution-actions').getByRole('button',{name:'Save execution limits',exact:true}).click();await settings.locator('#execution-notice').filter({hasText:'Execution limits saved.'}).waitFor();assert.equal(manager.preferences().execution.firstResponseTimeout,600);const savedExecutions=executionSaves;
  await settings.locator('.execution-actions').getByRole('button',{name:'Restore defaults',exact:true}).click();assert.equal(await modelTimeout.inputValue(),'120');await settings.locator('.execution-actions').getByRole('button',{name:'Discard',exact:true}).click();assert.equal(await modelTimeout.inputValue(),'600');assert.equal(executionSaves,savedExecutions);assert.equal(manager.preferences().execution.firstResponseTimeout,600);
  await post(chat,{type:'status',busy:false,text:'Ready'});await settings.locator('#nav-conversation').click();await settings.locator('#font-size').selectOption('20');await settings.locator('#nav-models').click();await settings.locator('#nav-conversation').click();assert.equal(await settings.locator('#font-size').inputValue(),'20');assert.equal(await chat.locator('#prompt').evaluate(el=>getComputedStyle(el).fontSize),'13px');await settings.locator('#save-conversation').click();await chat.waitForFunction(()=>getComputedStyle(document.getElementById('prompt')).fontSize==='20px');
  const longRef={providerId:id,modelId:'organization/very-long-model-name-with-context-and-version-'.repeat(3)};await manager.manual(longRef,false);await manager.setSelection(longRef);await broadcast();
  for(const width of [280,360,480]){await chat.setViewportSize({width,height:800});assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await chat.locator('.composer').evaluate(el=>getComputedStyle(el).paddingBottom),'12px');assert.equal(await chat.locator('#run-status').isVisible(),false);await chat.screenshot({path:path.join(output,`v070-font20-${width}.png`)});}
  await post(chat,{type:'stream',id:'partial',text:'An incomplete response',done:false});await post(chat,{type:'stream',id:'partial',text:'',done:true,incomplete:true});assert.equal(await chat.locator('.incomplete').count(),1);
  await post(chat,{type:'runProgress',progress:{runId:'r',phase:'waiting_model',startedAt:Date.now()-5000,phaseStartedAt:Date.now()-5000}});await chat.locator('.progress-label').filter({hasText:'Waiting for model'}).waitFor();await post(chat,{type:'status',busy:false,text:'Ready'});
  await settings.locator('#font-size').selectOption('');await settings.locator('#save-conversation').click();
  const hcLight={...themes.light,'contrastBorder':'#0f4a85','focusBorder':'#0f4a85'};
  for(const p of [chat,settings])await p.evaluate(tokens=>{document.body.classList.add('vscode-high-contrast-light');for(const [k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+k,v);},hcLight);
  for(const width of [280,360,480]){await chat.setViewportSize({width,height:800});await chat.screenshot({path:path.join(output,`v070-hc-light-${width}.png`)});assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  for(const width of [480,800,1200]){await settings.setViewportSize({width,height:800});for(const section of ['providers','models','conversation','execution','diagnostics']){await settings.locator('#nav-'+section).click();await settings.screenshot({path:path.join(output,`v070-hc-light-${width}-${section}.png`)});assert.ok(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}}
  await post(chat,{type:'event',event:{role:'activity',text:'',activity:{runId:'rejected',id:'validation-1',name:'modelValidation',status:'error',output:'Invalid read arguments: arguments.path is required.',startedAt:Date.now(),endedAt:Date.now()}}});await chat.locator('.activity-group > summary').last().click();assert.equal(await chat.locator('.activity-label').last().innerText(),'Model response rejected');
  await post(chat,{type:'runFailure',code:'tool_validation',message:'Invalid read arguments: arguments.path is required.',retryable:false});await chat.getByRole('button',{name:'View diagnostics',exact:true}).waitFor();assert.equal(await chat.getByRole('button',{name:'Try again',exact:true}).count(),0);await chat.getByRole('button',{name:'Open settings',exact:true}).click();await settings.locator('#section-models').waitFor();
  assert.deepEqual(errors,[]);console.log('UI passed: two surfaces, modal BYOK, defaults, context, English/Portuguese, shortcuts, Markdown safety, checklist, sessions, close/reopen, Ask default/order, permission icons, bounded hover, responsive visual captures including 20px font and high contrast light, grouped activities, copy/reuse and expanded messages. Provider responses simulated.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
