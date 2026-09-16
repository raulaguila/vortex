/* Browser integration against the real provider manager, with simulated provider responses. */
const {chromium} = require('playwright-core');
const {createServer} = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ProviderManager} = require('../dist/providers/providerManager');
const {parseRequest} = require('../dist/ui/protocol');
const {renderSidebar} = require('../dist/ui/view');
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
  browser=await chromium.launch({executablePath:require('./runtime-paths.cjs').chromePath(),headless:true});
  const context=await browser.newContext();const pages=new Set();let settings,chat;const errors=[];const planReplies=[];const dialogReplies=[];let rejectDialog=false;const interactionReplies=[];let rejectInteraction=false;let startCount=0,executionSaves=0,copied='',openedActivity,attachRequests=0,removedContext;
  const manager=new ProviderManager(new Storage(),new Secrets(),async url=>new Response(JSON.stringify(url.includes('/models/')?{context_length:32768}: {data:[{id:'chat-model'},{id:'plan-model'}]})));
  const post=(page,m)=>page.isClosed()?Promise.resolve():page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:m})),m);
  const broadcast=async()=>{const state=await manager.snapshot();await Promise.all([...pages].filter(p=>!p.isClosed()).map(p=>post(p,{type:'state',state,busy:false})));};
  const sessions=[{id:'11111111-1111-1111-1111-111111111111',title:'Explore the repository',updatedAt:Date.now()}];
  async function createPage(isSettings){
   const page=await context.newPage();pages.add(page);page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
   await page.exposeFunction('bridge',async raw=>{const m=parseRequest(raw);const ok=(message,providerId)=>post(page,{type:'result',requestId:m.requestId,ok:true,message,providerId});try{switch(m.type){
    case 'approvePlan':case 'reviewStep':case 'resumePlan':case 'revisePlan':planReplies.push(m);await ok();return;
    case 'respondDialog':dialogReplies.push(m);if(rejectDialog){rejectDialog=false;await post(page,{type:'result',requestId:m.requestId,ok:false,message:'Invalid image reference'});return;}await post(page,{type:'dialog',dialog:null});await ok();return;
    case 'respondInteraction':interactionReplies.push(m);if(rejectInteraction){rejectInteraction=false;await post(page,{type:'result',requestId:m.requestId,ok:false,message:'Please retry'});return;}if(m.decision!=='preview')await post(page,{type:'interaction',interaction:null});await ok();return;
    case 'attachContext':attachRequests++;await ok();return;
    case 'removeContext':removedContext=m.id;await ok();return;
    case 'openActivityOutput':openedActivity={sessionId:m.sessionId,activityId:m.activityId};await ok();return;
    case 'recoveryInfo':await post(page,{type:'recoveryInfo',items:[]});return;
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
    case 'testTools':await post(page,{type:'toolsTestResult',requestId:m.requestId,model:m.model,result:{chat:'validated',streaming:'unverified',tools:'validated',protocol:'native',timestamp:Date.now(),elapsed:25,message:'Tool request, correlated result and final response validated.'}});return;
    case 'storageInfo':await post(page,{type:'storageInfo',bytes:1024,sessions:sessions.length,retentionDays:manager.preferences().storage.retentionDays});return;
    case 'setStorage':await manager.setStorage(m.retentionDays);break;
    case 'cleanupStorage':await ok();return;
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
    case 'start':startCount++;await post(page,{type:'accepted',requestId:m.requestId});await post(page,{type:'event',event:{role:'user',text:m.prompt}});await post(page,{type:'checklist',items:[{id:'one',text:'Inspect code',status:'completed'},{id:'two',text:'Implement tests',status:'pending'}]});await post(page,{type:'context',used:2048,budget:16384,removed:2,source:'fallback'});await post(page,{type:'event',event:{role:'assistant',text:'## Result\n- [x] Inspected\n\n```js\nconst safe = true;\n```\n<script>alert(1)</script> [bad](javascript:alert(1))'}});await post(page,{type:'runEnd',requestId:m.requestId,status:'complete'});return;
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
  await chat.locator('#context-status').filter({hasText:'8.2K'}).waitFor();
  await settings.locator('#context-source').selectOption('api');await settings.locator('#save-models').click();await chat.locator('#context-status').filter({hasText:'32.8K'}).waitFor();
  // API metadata arrives after the include_selection; the same model must update immediately.
  await manager.setContext({providerId:id,modelId:'chat-model'},'api',32768);
  manager.transport=async()=>new Response(JSON.stringify({context_length:262144}));
  await manager.inspect({providerId:id,modelId:'chat-model'});await broadcast();await chat.locator('#context-status').filter({hasText:'262.1K'}).waitFor();
  await settings.waitForFunction(()=>document.getElementById('context-tokens').value==='262144');
  assert.equal(await settings.locator('#context-tokens').inputValue(),'262144');
  await manager.setContext({providerId:id,modelId:'chat-model'},'api',262144);
  manager.transport=async()=>new Response(JSON.stringify({context_length:131072}));
  await manager.inspect({providerId:id,modelId:'chat-model'});await broadcast();
  await chat.locator('#context-status').filter({hasText:'131.1K'}).waitFor();await settings.waitForFunction(()=>document.getElementById('context-tokens').value==='131072');assert.equal(await settings.locator('#context-tokens').inputValue(),'131072');
  await post(chat,{type:'context',model:{providerId:id,modelId:'chat-model'},used:100,budget:65536,source:'api',removed:0});
  await chat.locator('#context-status').filter({hasText:'131.1K'}).waitFor();
  await post(chat,{type:'context',model:{providerId:id,modelId:'different-model'},used:1,budget:1024,source:'custom',removed:0});
  assert.ok((await chat.locator('#context-status').innerText()).includes('131.1K'));
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
  // Explicit truncation and storage failures remain understandable at narrow widths.
  await post(chat,{type:'history',events:[{role:'user',text:'Inspect output'},{role:'activity',text:'',activity:{sessionId:sessions[0].id,id:'activity-fixture',runId:'run',name:'read_file',status:'success',output:'preview',outputRef:'11111111-1111-1111-1111-111111111111',truncated:true,startedAt:1,endedAt:2}}],busy:false,status:'Ready'});
  await chat.locator('.activity-group > summary').click();await chat.locator('.activity > summary').click();await chat.getByRole('button',{name:'View full output'}).click();await chat.waitForTimeout(50);assert.deepEqual(openedActivity,{sessionId:sessions[0].id,activityId:'activity-fixture'});
  await post(chat,{type:'persistenceState',failed:true});assert.equal(await chat.getByRole('alert').filter({hasText:'Progress could not be saved'}).isVisible(),true);
  for(const width of [280,360,480]){await chat.setViewportSize({width,height:800});assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await chat.screenshot({path:path.join(output,`recovery-${width}.png`)});}
  await post(chat,{type:'persistenceState',failed:false});assert.equal(await chat.getByRole('alert').filter({hasText:'Progress could not be saved'}).isVisible(),false);
  // Representative conversation and functional message actions.
  const longMessage='Please improve the account screen.\n'.repeat(24);
  await post(chat,{type:'history',events:[{role:'user',text:longMessage,timestamp:Date.now()},{role:'activity',text:'read_file · account.ts · success\nRead 80 lines.'},{role:'activity',text:'edit_file · account.ts · denied\nApproval denied.'},{role:'assistant',text:'## Account screen\nThe edit was **not applied** because approval was declined.\n\n- Existing files are unchanged.\n- You can review the proposed implementation.\n\n```ts\nconst enabled = true;\n```',timestamp:Date.now()}],busy:false,status:'Ready'});
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
  assert.equal(await chat.locator('#permission-trigger use').first().getAttribute('href'),'#i-hand');
  await chat.locator('#permission-trigger').click();await chat.locator('.choice-option').filter({hasText:'Edit automatically'}).click();assert.equal(await chat.locator('#permission-trigger use').first().getAttribute('href'),'#i-bolt');
  assert.equal(await chat.locator('.permissions > svg').count(),0);
  await chat.setViewportSize({width:800,height:800});
  const modelBox=await chat.locator('#model-trigger').boundingBox();const toolbarBox=await chat.locator('.composer-toolbar').boundingBox();assert.ok(modelBox.width<toolbarBox.width/2,'Model hover must not stretch across unused space');
  await chat.locator('#model-trigger').hover();await chat.screenshot({path:path.join(output,'v3-wide-hover.png')});
  await post(chat,{type:'checklist',items:[]});
  await post(chat,{type:'history',events:[{role:'user',text:'oi'},{role:'assistant',text:'Oi! Como posso ajudar?'},{role:'user',text:'tudo bem?'},{role:'assistant',text:'Tudo bem! O que você quer construir?'}],busy:false,status:'Ready'});
  for(const width of [280,360,480,538]){
    await chat.setViewportSize({width,height:1030});await chat.locator('#prompt').fill('');
    await chat.evaluate(tokens=>{document.body.className='vscode-dark';for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [key,value]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+key,value);document.getElementById('timeline').scrollTop=0;},themes.dark);
    await chat.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const bounds=await chat.locator('.composer').boundingBox();assert.equal(Math.round(bounds.x),16);assert.equal(Math.round(width-bounds.x-bounds.width),16);const compact=await chat.locator('.composer').evaluate(el=>el.classList.contains('compact-controls'));assert.ok(bounds.height<=(compact?146:110),JSON.stringify({width,compact,height:bounds.height}));
    await chat.screenshot({path:path.join(output,`v5-spacing-${width}.png`)});
  }
  // Composer behavior: effective read-only status preserves the saved Agent policy.
  await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Answer questions'}).click();
  assert.equal(await chat.locator('#permission-trigger use').first().getAttribute('href'),'#i-eye');
  assert.equal(await chat.locator('#permission-trigger span').innerText(),'Read-only');
  assert.equal(await chat.locator('#permission').inputValue(),'autonomous');
  assert.equal(await chat.locator('#prompt').getAttribute('placeholder'),'Ask about the project…');
  await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Analyze and create'}).click();
  assert.equal(await chat.locator('#prompt').getAttribute('placeholder'),'What would you like to plan?');
  await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Explore and implement'}).click();
  assert.equal(await chat.locator('#permission-trigger use').first().getAttribute('href'),'#i-bolt');
  assert.equal(await chat.locator('#prompt').getAttribute('placeholder'),'Describe what you want to implement…');
  // Email addresses and pasted mentions must not interrupt typing.
  await chat.locator('#prompt').fill('person');await chat.locator('#prompt').pressSequentially('@example.com');assert.equal(attachRequests,0);
  await chat.locator('#prompt').fill('pasted @');assert.equal(attachRequests,0);
  await chat.locator('#prompt').fill('');await chat.locator('#prompt').pressSequentially('@');await chat.waitForFunction(()=>document.getElementById('prompt').value==='@');assert.equal(attachRequests,1);
  await chat.locator('#prompt').press('Escape');assert.equal(await chat.locator('#prompt').inputValue(),'@');
  await chat.locator('#prompt').fill('See ');await chat.locator('#prompt').pressSequentially('@');assert.equal(attachRequests,2);
  await chat.locator('#attach-context').click();assert.equal(attachRequests,3);
  // Attachments use distinct remove buttons and a keyboard-operable disclosure.
  const attachments=Array.from({length:5},(_,i)=>({id:'file-'+i,label:i===0?'src/'+('long-path/').repeat(8)+'component.ts':'file-'+i+'.ts',kind:'file',content:'example'}));
  await post(chat,{type:'attachments',items:attachments});assert.equal(await chat.locator('.context-chip').count(),2);
  await chat.locator('.context-more').focus();await chat.locator('.context-more').press('Enter');assert.equal(await chat.locator('.context-chip').count(),5);
  assert.equal(await chat.locator('.context-more').getAttribute('aria-expanded'),'true');
  await chat.locator('.context-remove').first().click();assert.equal(removedContext,'file-0');
  await post(chat,{type:'attachments',items:attachments.slice(1)});assert.equal(await chat.locator('.context-remove').first().evaluate(el=>el===document.activeElement),true);
  await chat.locator('.context-more').click();assert.equal(await chat.locator('.context-chip').count(),2);
  // Enter during execution keeps the next draft; no invisible queued request.
  await manager.setConversation({sendKey:'enter'});await broadcast();await post(chat,{type:'status',busy:true,text:'Waiting for model'});const sentBeforeDraft=startCount;
  await chat.locator('#prompt').fill('Next question');assert.equal(await chat.locator('#draft-hint').isVisible(),true);
  await chat.locator('#prompt').press('Enter');assert.equal(startCount,sentBeforeDraft);assert.equal(await chat.locator('#prompt').inputValue(),'Next question');
  assert.equal(await chat.locator('#stop').isVisible(),true);
  await chat.locator('#prompt').press('Shift+Enter');assert.equal(await chat.locator('#prompt').inputValue(),'Next question\n');await chat.locator('#prompt').fill('Next question');await chat.locator('#prompt').press('Control+Enter');assert.equal(startCount,sentBeforeDraft);
  await post(chat,{type:'status',busy:false,text:'Ready'});assert.equal(await chat.locator('#draft-hint').isVisible(),false);
  assert.equal(await chat.locator('#prompt').inputValue(),'Next question');assert.equal(await chat.locator('#send').isEnabled(),true);
  await chat.locator('#prompt').fill('');
  // Compact display retains exact values and output reserve in the tooltip.
  const currentModel=manager.preferences().selected;
  await post(chat,{type:'usage',model:currentModel,input:15000,output:0});
  assert.equal(await chat.locator('#context-status').getAttribute('data-pressure'),'high');
  assert.match(await chat.locator('#context-status').getAttribute('title'),/15000/);
  assert.ok(!(await chat.locator('#context-status').innerText()).includes('~'));
  await post(chat,{type:'context',model:currentModel,used:2048,budget:16384,removed:0,source:'fallback'});
  assert.equal(await chat.locator('#context-status').getAttribute('data-pressure'),null);
  assert.match(await chat.locator('#context-status').innerText(),/~2(?:\.0)?K/);
  // All themes, small sidebars and translated controls: visible targets never overlap.
  for(const lang of ['en','pt']){
    await manager.setConversation({uiLanguage:lang});await broadcast();
    assert.equal(await chat.locator('#prompt').getAttribute('placeholder'),lang==='pt'?'Descreva o que deseja implementar…':'Describe what you want to implement…');
    for(const width of [280,360,480])for(const [theme,tokens]of Object.entries(themes)){
      await chat.setViewportSize({width,height:800});
      await chat.evaluate(({theme,tokens})=>{document.body.className='vscode-'+(theme==='contrast'?'high-contrast':theme);for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+k,v);},{theme,tokens});
      await chat.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const controls=await chat.locator('#attach-context,#mode-trigger,#model-trigger,#permission-trigger,#send').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,'Composer controls overlap');}
      assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await chat.locator('footer').screenshot({path:path.join(output,`composer-${lang}-${theme}-${width}.png`)});
    }
  }
  await post(chat,{type:'attachments',items:[]});await manager.setConversation({uiLanguage:'en'});await broadcast();
  await chat.evaluate(tokens=>{document.body.className='vscode-dark';for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+k,v);},themes.dark);
  for(const width of [280,360,480]){await chat.setViewportSize({width,height:800});await chat.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await chat.locator('footer').screenshot({path:path.join(output,`composer-clean-${width}.png`)});}
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
  await post(chat,{type:'activityUpdate',activity:{runId:'rejected',id:'validation-1',name:'modelValidation',status:'recovered',output:'Invalid read arguments corrected.',startedAt:Date.now(),endedAt:Date.now()}});assert.equal(await chat.locator('[data-activity-id="validation-1"] .activity-label').innerText(),'Response corrected');
  await post(chat,{type:'status',busy:true,text:'Running command'});await post(chat,{type:'runProgress',progress:{runId:'live',phase:'tool',startedAt:Date.now(),phaseStartedAt:Date.now(),tool:{id:'cmd',name:'run_command'}}});await post(chat,{type:'commandOutput',runId:'stale',id:'cmd',stream:'stdout',text:'discard'});assert.equal(await chat.locator('.live-command').count(),0);await post(chat,{type:'commandOutput',runId:'live',id:'cmd',stream:'stdout',text:'Running tests…\n<script>never execute</script>'});await chat.locator('.live-command summary').click();assert.match(await chat.locator('.live-command pre').innerText(),/Running tests/);assert.equal(await chat.locator('.live-command script').count(),0);await chat.screenshot({path:path.join(output,'v080-live-command.png')});await post(chat,{type:'runEnd',requestId:'live',status:'complete'});assert.equal(await chat.locator('.live-command').count(),0);
  await settings.locator('#nav-models').click();await settings.locator('#output-limit').fill('0');assert.equal(await settings.locator('#output-limit').evaluate(el=>el.checkValidity()),false);await settings.locator('#output-limit').fill('8000');await settings.locator('#save-models').click();await settings.locator('#section-models-notice').filter({hasText:'Saved.'}).waitFor();assert.ok(Object.values(manager.preferences().outputTokens).includes(8000));await settings.locator('#test-tools').click();await settings.locator('#tools-test-result').filter({hasText:'Tools: validated'}).waitFor();await settings.locator('#test-tools').scrollIntoViewIfNeeded();await settings.screenshot({path:path.join(output,'v080-tools-test.png')});
  await settings.locator('#nav-diagnostics').click();await settings.locator('#storage-info').filter({hasText:'MiB'}).waitFor();assert.equal(await settings.locator('#retention-days').inputValue(),'0');await settings.screenshot({path:path.join(output,'v080-storage.png')});
  // Sidebar interactions are explicit, draft-safe and keyboard accessible.
  const approvalRequest={id:'approval-ui',runId:'r',kind:'approval',operation:'edit',path:'src/very/long/component/file.ts',preview:true,hunks:[{label:'1–3',diff:'-old\n+new'},{label:'20–23',diff:'-before\n+after'}]};
  await chat.locator('#prompt').fill('Keep this draft');await post(chat,{type:'status',busy:true,text:'Waiting for approval'});
  await post(chat,{type:'interaction',interaction:approvalRequest});
  await chat.locator('#interaction-heading').press('Enter');assert.equal(interactionReplies.length,0);
  await chat.locator('#interaction-preview').click();await chat.waitForFunction(()=>!document.getElementById('interaction-approve').disabled);assert.equal(await chat.locator('#interaction-card').isVisible(),true);
  await chat.locator('.interaction-hunks summary').click();await chat.locator('.interaction-hunk input').last().uncheck();
  await chat.locator('#interaction-approve').click();await chat.locator('#interaction-card').waitFor({state:'hidden'});assert.deepEqual(interactionReplies.at(-1).hunks,[0]);assert.equal(await chat.locator('#prompt').inputValue(),'Keep this draft');
  const questionRequest={id:'question-ui',runId:'r',kind:'question',question:'Which verification should I run? <script>not executable</script>',options:['Fast checks','Full suite']};
  await post(chat,{type:'interaction',interaction:questionRequest});assert.equal(await chat.locator('#interaction-approve').isDisabled(),true);assert.equal(await chat.locator('#interaction-card script').count(),0);
  await chat.locator('.interaction-option').last().click();assert.equal(await chat.locator('#interaction-answer').inputValue(),'');assert.equal(await chat.locator('.interaction-option').last().getAttribute('aria-checked'),'true');assert.equal(interactionReplies.length,2);
  await chat.locator('#interaction-answer').fill('Only the changed module');await post(chat,{type:'interaction',interaction:questionRequest});assert.equal(await chat.locator('#interaction-answer').inputValue(),'Only the changed module');
  await manager.setConversation({uiLanguage:'pt'});await broadcast();await chat.locator('#interaction-heading').filter({hasText:'Vortex precisa da sua resposta'}).waitFor();assert.equal(await chat.locator('#interaction-answer').inputValue(),'Only the changed module');
  rejectInteraction=true;await chat.locator('#interaction-approve').click();await chat.locator('#interaction-error').filter({hasText:'Please retry'}).waitFor();assert.equal(await chat.locator('#interaction-approve').isEnabled(),true);
  await chat.locator('#interaction-answer').press('Control+Enter');await chat.locator('#interaction-card').waitFor({state:'hidden'});assert.equal(interactionReplies.at(-1).answer,'Only the changed module');
  await manager.setSelection(currentModel);await broadcast();
  await post(chat,{type:'history',events:[{role:'user',text:'Corrija a função de soma.'}],busy:true,status:'Waiting for approval'});
  await post(chat,{type:'accepted',requestId:'visual-interaction'});
  await post(chat,{type:'sessionLoaded',mode:'agent',permission:'supervised',model:currentModel});
  approvalRequest.path='src/sum.ts';questionRequest.question='Which verification should I run?';
  for(const lang of ['en','pt'])for(const width of [280,360,480])for(const [theme,tokens]of Object.entries(themes)){
    await manager.setConversation({uiLanguage:lang});await broadcast();await chat.setViewportSize({width,height:800});
    await chat.evaluate(tokens=>{document.body.className='';for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+k,v);},tokens);
    questionRequest.question=lang==='pt'?'Quais verificações devo executar?':'Which verification should I run?';questionRequest.options=lang==='pt'?['Testes do módulo alterado','Suíte completa']:['Changed module tests','Full suite'];
    for(const item of [approvalRequest,questionRequest]){
      await post(chat,{type:'status',busy:true,text:item.kind==='question'?'Waiting for your answer':'Waiting for approval'});
      await post(chat,{type:'interaction',interaction:item});await chat.locator('#interaction-card').waitFor();
      assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const card=await chat.locator('#interaction-card').boundingBox(),footer=await chat.locator('footer').boundingBox();if(item.kind==='approval')assert.ok(card.y+card.height<=footer.y);else{const composer=await chat.locator('.composer').boundingBox();assert.ok(card.y>=composer.y&&card.y+card.height<=composer.y+composer.height);assert.equal(await chat.locator('#prompt').isVisible(),false);}
      await chat.screenshot({path:path.join(output,`interaction-${item.kind}-${lang}-${theme}-${width}.png`)});
    }
  }
  await chat.locator('#interaction-reject').click();assert.equal(interactionReplies.at(-1).decision,'reject');await post(chat,{type:'status',busy:false,text:'Ready'});
  // Shared dialogs in chat and settings: filtering, cancellation, focus, errors and drafts.
  await manager.setConversation({uiLanguage:'en'});await broadcast();
  await chat.locator('#prompt').fill('Dialog-safe draft');
  for(const page of [chat,settings]){
    await post(page,{type:'dialog',dialog:{id:'confirm-'+page.url(),kind:'confirm',title:'Delete this session and its saved results?',detail:'Workspace files are preserved.',accept:'Delete'}});
    await page.locator('#vortex-dialog-title').press('Enter');assert.equal(dialogReplies.length,0);
    await page.locator('#vortex-dialog').press('Escape');assert.equal(dialogReplies.at(-1).value,null);dialogReplies.length=0;
    await post(page,{type:'dialog',dialog:{id:'pick',kind:'pick',title:'Select file',choices:[{id:'a',label:'src/app.ts'},{id:'b',label:'README.md'}]}});
    await page.locator('#vortex-dialog-search').fill('readme');assert.equal(await page.locator('.vortex-dialog-choice').count(),1);
    await page.locator('#vortex-dialog-search').press('ArrowDown');await page.keyboard.press('Enter');assert.equal(dialogReplies.at(-1).value,'b');dialogReplies.length=0;
    await post(page,{type:'dialog',dialog:{id:'input',kind:'input',title:'Download sandbox image',value:'node:22',accept:'Continue'}});
    await page.locator('#vortex-dialog-input').fill('invalid value');rejectDialog=true;await page.locator('#vortex-dialog-accept').click();
    await page.locator('#vortex-dialog-error').filter({hasText:'Invalid image reference'}).waitFor();assert.equal(await page.locator('#vortex-dialog-input').inputValue(),'invalid value');
    await page.locator('#vortex-dialog-input').fill('node:22');await page.locator('#vortex-dialog-input').press('Enter');assert.equal(dialogReplies.at(-1).value,'node:22');dialogReplies.length=0;
  }
  assert.equal(await chat.locator('#prompt').inputValue(),'Dialog-safe draft');
  for(const lang of ['en','pt'])for(const width of [280,360,480])for(const [theme,tokens] of Object.entries(themes)){
    await manager.setConversation({uiLanguage:lang});await broadcast();
    await chat.setViewportSize({width,height:800});
    await chat.evaluate(tokens=>{document.body.className='';for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+k,v);},tokens);
    await post(chat,{type:'dialog',dialog:{id:'visual-'+width+theme,kind:'pick',title:'Select file',choices:[{id:'a',label:'src/a-long-directory-name/another-directory/a-file-with-a-long-name.ts',description:'Modified'},{id:'b',label:'README.md'}]}});
    const bounds=await chat.locator('#vortex-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=800);
    await chat.screenshot({path:path.join(output,`dialog-${lang}-${theme}-${width}.png`)});await chat.locator('#vortex-dialog-cancel').click();
  }
  const {PlanController}=require('../dist/plan/plan');
  const controlledPlan=PlanController.propose({objective:'Improve the settings workflow',steps:[{id:'ui',title:'Review settings layout',objective:'Keep the interface readable at narrow widths',depends_on:[],criteria:[{id:'visual',description:'Labels remain readable and controls are reachable',verification:'human'}]}]},'Improve settings',undefined,2);
  controlledPlan.state.authorization={session_id:'s',workspace:'/fixture',plan_version:1,revision:1,steps:[{step_id:'ui',files:[{path:'settings.ts',operation:'edit'}],commands:[]}]};
  await manager.setConversation({uiLanguage:'en'});await broadcast();await post(chat,{type:'planState',sessionId:'s',plan:controlledPlan.state,legacy:false});
  assert.equal(await chat.locator('#plan-popover').isVisible(),false);await chat.locator('#plan-toggle').click();await chat.locator('#plan-approve').click();assert.equal(planReplies.at(-1).version,1);assert.equal(planReplies.at(-1).planId,controlledPlan.state.plan_id);assert.equal(await chat.locator('#prompt').inputValue(),'Dialog-safe draft');
  controlledPlan.approve(1,'supervised');controlledPlan.begin();controlledPlan.record({id:'ui-evidence',tool:'read_file',status:'success',timestamp:Date.now()});controlledPlan.validate({execution_id:controlledPlan.state.execution_id,plan_version:1,step_id:'ui',attempt:1,outcome:'completed',summary:'Ready for review',evidence:[{criterion_id:'visual',tool_call_ids:['ui-evidence']}],remaining_issues:[]},null);
  await post(chat,{type:'planState',sessionId:'s',plan:controlledPlan.state,legacy:false});await chat.locator('#plan-comment').fill('Keep this review comment');await chat.locator('#plan-confirm').click();assert.equal(planReplies.at(-1).decision,'confirm');assert.equal(planReplies.at(-1).comment,'Keep this review comment');assert.equal(await chat.locator('#plan-confirm').innerText(),'Confirm manual review');assert.match(await chat.locator('#plan-toggle').innerText(),/Manual review/);assert.equal(await chat.locator('#plan-approve').count(),0);
  for(const lang of ['en','pt'])for(const width of [280,360,480])for(const [theme,tokens] of Object.entries(themes)){
   await manager.setConversation({uiLanguage:lang});await broadcast();await chat.setViewportSize({width,height:800});
   await chat.evaluate(tokens=>{for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+k,v);},tokens);
   await post(chat,{type:'planState',sessionId:'s',plan:controlledPlan.state,legacy:false});await chat.locator('.plan-step > summary').click();
   assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await chat.locator('#plan-comment').inputValue(),'Keep this review comment');
   await chat.screenshot({path:path.join(output,`plan-${lang}-${theme}-${width}.png`)});
  }
  // The plan overlays the transcript, including long plans, without changing its geometry.
  await manager.setConversation({uiLanguage:'en',fontSize:20});await broadcast();await chat.setViewportSize({width:280,height:800});
  const longPlan=PlanController.propose({objective:'Large implementation',steps:Array.from({length:50},(_,i)=>({id:'s'+i,title:'Step '+(i+1)+' with a longer title',objective:'Read the current workspace',depends_on:[],criteria:[{id:'check',description:'Confirm result',verification:'human'}]}))},'Large implementation');
  await post(chat,{type:'planState',sessionId:'long',plan:longPlan.state,legacy:false});
  assert.equal(await chat.locator('#plan-popover').isVisible(),false);
  const geometry=()=>chat.locator('#timeline,.composer').evaluateAll(rows=>rows.map(row=>{const r=row.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scroll:row.scrollTop};}));
  const beforeOverlay=await geometry();await chat.locator('#plan-toggle').click();assert.deepEqual(await geometry(),beforeOverlay);
  const overlay=await chat.locator('#plan-popover').boundingBox();const composerBounds=await chat.locator('.composer').boundingBox();assert.ok(overlay.height<=360&&overlay.y+overlay.height<composerBounds.y);
  await chat.locator('.plan-step').last().locator('summary').click();assert.equal(await chat.locator('.plan-step').last().getAttribute('open'),'');
  await chat.keyboard.press('Escape');assert.equal(await chat.locator('#plan-popover').isVisible(),false);assert.equal(await chat.locator('#plan-toggle').evaluate(el=>el===document.activeElement),true);
  await chat.locator('#plan-toggle').click();await chat.locator('#mode-trigger').click();assert.equal(await chat.locator('#plan-popover').isVisible(),false);await chat.keyboard.press('Escape');
  // Input and answer drafts survive language changes and a complete webview recreation.
  await chat.locator('#prompt').fill('Retain the original message');
  const persistentQuestion={id:'persistent-question',runId:'r-draft',kind:'question',question:'Which validation should run?',options:['Focused tests','Full suite','Static analysis','Build only','Check the public API without changing existing consumers'],recommended_option:'Focused tests'};
  await post(chat,{type:'event',event:{role:'assistant',text:persistentQuestion.question,interactionId:persistentQuestion.id}});
  await chat.locator('#plan-toggle').click();await post(chat,{type:'interaction',interaction:persistentQuestion});assert.equal(await chat.locator('#plan-popover').isVisible(),false);
  assert.equal(await chat.locator('#timeline [data-interaction-id]:visible').count(),0);assert.equal(await chat.locator('.interaction-recommended').count(),1);assert.equal(await chat.locator('[role=radio][aria-checked=true]').count(),0);
  const submittedBefore=interactionReplies.length;await chat.locator('.interaction-option').first().focus();await chat.keyboard.press('ArrowDown');assert.equal(await chat.locator('.interaction-option').nth(1).getAttribute('aria-checked'),'true');assert.equal(interactionReplies.length,submittedBefore);
  await chat.locator('#interaction-answer').fill('Keep the API');assert.equal(await chat.locator('[role=radio][aria-checked=true]').count(),0);
  await chat.locator('#interaction-answer').press('Shift+Enter');await chat.locator('#interaction-answer').press('Enter');assert.equal(interactionReplies.length,submittedBefore);
  await manager.setConversation({uiLanguage:'pt'});await broadcast();await chat.waitForFunction(()=>document.activeElement?.id==='interaction-answer');assert.equal(await chat.locator('#interaction-answer').inputValue(),'Keep the API\n\n');
  await chat.reload();await chat.locator('#prompt').waitFor();await post(chat,{type:'interaction',interaction:persistentQuestion});assert.equal(await chat.locator('#interaction-answer').inputValue(),'Keep the API\n\n');assert.equal(await chat.locator('#prompt').inputValue(),'Retain the original message');
  // Malformed recommendations and an old response cannot change the active question.
  await post(chat,{type:'interaction',interaction:{...persistentQuestion,id:'bad',recommended_option:'Missing'}});assert.equal(await chat.locator('#interaction-card').getAttribute('data-id'),persistentQuestion.id);
  await post(chat,{type:'result',requestId:'old-response',ok:true});assert.equal(await chat.locator('#interaction-answer').inputValue(),'Keep the API\n\n');
  await chat.locator('#interaction-answer').press('Control+Enter');await chat.locator('#interaction-card').waitFor({state:'hidden'});assert.equal(interactionReplies.at(-1).answer,'Keep the API');assert.equal(await chat.locator('#prompt').inputValue(),'Retain the original message');
  // Capture the approved visual scenarios using the real components.
  await manager.setConversation({uiLanguage:'pt',fontSize:null});await broadcast();await chat.setViewportSize({width:360,height:800});
  await chat.evaluate(tokens=>{for(const key of [...document.documentElement.style])if(key.startsWith('--vscode-'))document.documentElement.style.removeProperty(key);for(const [k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--vscode-'+k,v);},themes.dark);
  await post(chat,{type:'history',events:[{role:'user',text:'Melhore a validação do formulário.'},{role:'assistant',text:'Vou ajustar as regras e conferir os testes.'}],busy:false,status:'Ready'});
  await chat.locator('#prompt').fill('');await chat.locator('#mode-trigger').click();await chat.locator('.choice-option').filter({hasText:'Agent'}).click();
  await chat.screenshot({path:path.join(output,'approved-input-icons.png')});
  const visualPlan=PlanController.propose({objective:'Ajustar validação',steps:['Analisar regras','Ajustar validação','Executar testes'].map((title,i)=>({id:'step'+i,title,objective:title,depends_on:[],criteria:[{id:'check',description:'Revisar o resultado',verification:'human'}]}))},'Melhore a validação do formulário');
  visualPlan.approve(1,'supervised');visualPlan.begin();visualPlan.record({id:'visual-evidence',tool:'read_file',status:'success',timestamp:Date.now()});visualPlan.validate({execution_id:visualPlan.state.execution_id,plan_version:1,step_id:'step0',attempt:1,outcome:'completed',summary:'Regras identificadas',evidence:[{criterion_id:visualPlan.definition.criteria[0].id,tool_call_ids:['visual-evidence']}],remaining_issues:[]},null);visualPlan.review('confirm','Conferido',null);visualPlan.begin();
  await post(chat,{type:'planState',sessionId:'visual',plan:visualPlan.state,legacy:false});await chat.screenshot({path:path.join(output,'approved-plan-collapsed.png')});await chat.locator('#plan-toggle').click();await chat.screenshot({path:path.join(output,'approved-plan-expanded.png')});
  await post(chat,{type:'interaction',interaction:{id:'visual-refined',runId:'r',kind:'question',question:'Como tratar campos opcionais?',options:['Ignorar quando vazios','Validar sempre'],recommended_option:'Ignorar quando vazios'}});
  await chat.locator('.interaction-option').first().click();await chat.screenshot({path:path.join(output,'approved-question-choice.png')});
  await chat.locator('#interaction-answer').fill('Ignore quando vazio; valide quando preenchido.');await chat.screenshot({path:path.join(output,'approved-question-written.png')});
  await chat.locator('#interaction-reject').click();
  assert.deepEqual(errors,[]);console.log('UI passed: two surfaces, modal BYOK, defaults, context, English/Portuguese, shortcuts, Markdown safety, checklist, sessions, close/reopen, Ask default/order, permission icons, bounded hover, responsive visual captures including 20px font and high contrast light, grouped activities, copy/reuse, recovered activity, live command output, response limits, storage, tool diagnosis, sidebar approvals and questions. Provider responses simulated.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
