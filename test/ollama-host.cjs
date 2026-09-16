// Opt-in real Ollama + real VS Code + real temporary files. Never runs in normal CI.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {verifySum}=require('../scripts/eval-math.cjs');
const root=path.resolve(__dirname,'..');

(async()=>{
  const baseUrl=process.env.VORTEX_EVAL_URL,model=process.env.VORTEX_EVAL_MODEL;
  if(!baseUrl||!model)throw new Error('Set VORTEX_EVAL_URL and VORTEX_EVAL_MODEL.');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-ollama-host-'));
  const workspace=path.join(temp,'workspace'),output=path.join(root,'test-results','ollama-host',(process.env.VORTEX_EVAL_LABEL||'matrix').replace(/[^a-z0-9_-]/gi,'_'));
  await fs.mkdir(workspace);await fs.mkdir(output,{recursive:true});await fs.mkdir(path.join(temp,'profile','User'),{recursive:true});
  await fs.writeFile(path.join(temp,'profile','User','settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'vortex.sandbox.image':'vortex-test:absent','workbench.startupEditor':'none','telemetry.telemetryLevel':'off','extensions.autoUpdate':false,'window.restoreWindows':'none','window.dialogStyle':'custom','workbench.colorTheme':'Default Dark Modern'}));
  const variants=['export const sum = (a, b) => a - b;\n','export function sum(a, b) { return a - b; }\n','const sum = (a, b) => a - b;\nexport { sum };\n','export const sum = (left, right) => left - right;\n','export function sum(left, right) { const result = left - right; return result; }\n'];
  const original=variants[(Number(process.env.VORTEX_EVAL_REPEAT)||0)%variants.length];
  await fs.writeFile(path.join(workspace,'README.md'),'Arithmetic fixture. sum.js should add its two arguments. The implementation currently subtracts.');
  await fs.writeFile(path.join(workspace,'sum.js'),original);
  const packageText=JSON.stringify({type:'module',scripts:{test:'node --test sum.test.mjs'}});
  const testText="import {test} from 'node:test'; import assert from 'node:assert/strict'; import {sum} from './sum.js'; test('addition',()=>{assert.equal(sum(2,3),5);assert.equal(sum(-2,5),3);assert.equal(sum(1.5,2.5),4);});";
  await fs.writeFile(path.join(workspace,'package.json'),packageText);await fs.writeFile(path.join(workspace,'sum.test.mjs'),testText);
  const report={model,simulated:false,environment:'Real VS Code and temporary files; approval buttons driven by test; only allowlisted fixture test commands can be approved',workspace,results:[]};
  let app,window,frame;
  async function save(){await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  async function retainTrace(name){
    const storage=path.join(temp,'profile','User','workspaceStorage');
    for(const entry of await fs.readdir(storage).catch(()=>[])){
      const source=path.join(storage,entry,'vortex-local.vortex-agent','last-flow.json');
      try{await fs.copyFile(source,path.join(output,name+'-flow.json'));return name+'-flow.json';}catch{}
    }
  }
  try{
    const executablePath=await require('./runtime-paths.cjs').vscodePath();
    if(process.env.VORTEX_VSIX_PATH){const {execFile}=require('node:child_process');const [cli,...args]=require('@vscode/test-electron').resolveCliArgsFromVSCodeExecutablePath(executablePath,{reuseMachineInstall:true});await new Promise((resolve,reject)=>execFile(cli,[...args,'--user-data-dir='+path.join(temp,'profile'),'--extensions-dir='+path.join(temp,'extensions'),'--install-extension',process.env.VORTEX_VSIX_PATH,'--force'],{timeout:60000,shell:process.platform==='win32'},(e,out,err)=>e?reject(new Error(String(err))):resolve(out)));}
    app=await _electron.launch({executablePath:await require('./runtime-paths.cjs').vscodePath(),env:{...process.env,DOCKER_HOST:'tcp://127.0.0.1:1',DOCKER_CONTEXT:''},args:['--no-sandbox','--skip-welcome','--skip-release-notes','--disable-updates','--user-data-dir='+path.join(temp,'profile'),'--extensions-dir='+path.join(temp,'extensions'),...(process.env.VORTEX_VSIX_PATH?[]:['--extensionDevelopmentPath='+root]),workspace],timeout:30000});
    window=await app.firstWindow();window.setDefaultTimeout(20000);await window.locator('.activitybar [aria-label^="Vortex"]').first().waitFor();
    await window.keyboard.press('F1');await window.locator('.quick-input-widget input[type="text"]').fill('>Vortex: Abrir agente');await window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Vortex: Abrir agente'}).first().click();
    async function findFrame(selector){for(let i=0;i<150;i++){for(const page of app.context().pages())for(const candidate of page.frames()){try{if(await candidate.locator(selector).count()&&await candidate.evaluate(()=>document.readyState==='complete'))return candidate;}catch{}}await new Promise(r=>setTimeout(r,100));}throw new Error('Webview not found: '+selector);}
    frame=await findFrame('#prompt');
    await frame.evaluate(()=>{window.testEvents=[];window.addEventListener('message',e=>window.testEvents.push(e.data));});
    await frame.locator('#open-settings').click();const settings=await findFrame('#nav-providers');
    await settings.locator('#add-provider').click();await settings.locator('#provider-kind').selectOption('ollama');await settings.locator('#provider-name').fill('Real Ollama test');await settings.locator('#provider-url').fill(baseUrl);
    await settings.locator('#test-provider').click();await settings.locator('#form-notice').filter({hasText:'Connection tested'}).waitFor();await settings.locator('#save-provider').click();await settings.locator('.connection-status').filter({hasText:'models'}).waitFor();await settings.locator('#cancel-form').click();
    await settings.locator('#nav-execution').click();await settings.locator('[name="firstResponseTimeout"]').fill('300');await settings.locator('.execution-settings button[type="submit"]').click();
    await frame.locator('#model-trigger').click();await frame.locator('#model-search').fill(model);await frame.locator('.model-option').filter({hasText:model}).first().click();
    await frame.waitForFunction(model=>document.getElementById('selected-model').textContent===model,model);
    async function choose(kind,description){await frame.locator('#'+kind+'-trigger').click();await frame.locator('.choice-option').filter({hasText:description}).click();}
    let scenarios=[];
    for(const permission of ['supervised','autonomous'])for(const mode of ['ask','plan','agent'])scenarios.push({name:mode+'-'+permission,mode,permission});
    scenarios.push({name:'denied-edit',mode:'agent',permission:'supervised',deny:true},{name:'plan-to-agent',mode:'plan',permission:'supervised',transition:true},{name:'blocked-resume',mode:'plan',permission:'supervised',transition:true,blockOnce:true},{name:'stop',mode:'ask',permission:'supervised',stop:true});
    if(process.env.VORTEX_EVAL_MATRIX)scenarios=[{name:'greeting',mode:'ask',permission:'supervised',greeting:true},{name:'project-followup',mode:'ask',permission:'supervised',project:true},{name:'ask-diagnosis',mode:'ask',permission:'supervised'},{name:'plan-proposal',mode:'plan',permission:'supervised'},{name:'agent-fix',mode:'agent',permission:'supervised'},{name:'plan-execution',mode:'plan',permission:'supervised',transition:true}];
    if(process.env.VORTEX_EVAL_CASES)scenarios=scenarios.filter(s=>process.env.VORTEX_EVAL_CASES.split(',').includes(s.name));
    if(!scenarios.length)throw new Error('No matching scenarios.');
    for(const scenario of scenarios){
      console.log('Starting real Extension Host:',scenario.name);
      const caseStarted=Date.now();
      try{
      await frame.locator('#new-task').click();await frame.locator('#welcome').waitFor();await fs.writeFile(path.join(workspace,'sum.js'),original);await fs.writeFile(path.join(workspace,'README.md'),'Arithmetic fixture. sum.js should add its arguments.');await fs.writeFile(path.join(workspace,'package.json'),packageText);await fs.writeFile(path.join(workspace,'sum.test.mjs'),testText);
      // Resetting disk externally must not leave the preceding case's editor
      // buffers alive. A fresh window isolates fixtures without changing policy.
      if(report.results.length){
        await window.keyboard.press('F1');await window.locator('.quick-input-widget input[type="text"]').fill('>Developer: Reload Window');
        await Promise.all([window.waitForEvent('domcontentloaded'),window.locator('.quick-input-list .monaco-list-row').filter({hasText:'Developer: Reload Window'}).first().click()]);
        await window.locator('.monaco-workbench').waitFor();frame=await findFrame('#prompt');
        await frame.evaluate(()=>{window.testEvents=[];window.addEventListener('message',e=>window.testEvents.push(e.data));});
      }
      await choose('mode','Explore and implement');await choose('permission',scenario.permission==='supervised'?'Ask before editing':'Edit automatically');
      if(scenario.mode!=='agent')await choose('mode',scenario.mode==='ask'?'Answer questions':'Analyze and create');
      assert.equal(await frame.locator('#permission').inputValue(),scenario.permission);
      const prompt=scenario.greeting?'oi':scenario.project?'O que pode me dizer sobre o projeto atual?':scenario.transition?'Corrija a função sum e atualize o README com exemplos de soma de números positivos e negativos. Verifique também os testes existentes.':scenario.stop?'Explique closures usando 100 exemplos detalhados.':'A função sum retorna -1 para sum(2, 3), mas deveria retornar 5. Corrija esse problema.';
      const started=Date.now();let approvals=0,commandApprovals=0,unexpectedDialogs=0,ended=false,events=[],initialPlan=[],deniedOnce=false,manualReviews=0;
      const verifyDocumentation=text=>/sum\s*\(\s*\d+(?:\.\d+)?\s*,\s*\d+/.test(text)&&/sum\s*\([^)]*-\d/.test(text);
      async function functionalResult(){return await verifySum(await fs.readFile(path.join(workspace,'sum.js'),'utf8'))&&(!scenario.transition||verifyDocumentation(await fs.readFile(path.join(workspace,'README.md'),'utf8')));}
      async function turn(message,mode,trigger){
        await frame.evaluate(()=>window.testEvents=[]);if(trigger)await trigger();else{await frame.locator('#prompt').fill(message);await frame.waitForFunction(()=>!document.getElementById('send').disabled);await frame.locator('#send').click();}
        const turnStarted=Date.now();ended=false;let stopSent=false;
        while(Date.now()-turnStarted<600000){
          if(scenario.stop&&!stopSent&&await frame.locator('#stop').isVisible()){await frame.locator('#prompt').fill('Keep this next draft');await frame.locator('#draft-hint').waitFor();await frame.locator('#stop').click();stopSent=true;}
          const card=frame.locator('#interaction-card');
          if(await card.isVisible()){
            const operation=await card.getAttribute('data-operation');
            if(process.env.VORTEX_EVAL_MATRIX&&scenario.transition){unexpectedDialogs++;await frame.locator('#interaction-reject').click();continue;}
            const target=await card.locator('.interaction-path').textContent().catch(()=>null);
            if(mode==='agent'&&scenario.permission==='supervised'&&operation==='edit'&&['sum.js',...(scenario.transition?['README.md']:[])].includes(target)){
              approvals++;if(target==='sum.js'&&approvals===1)assert.equal(await fs.readFile(path.join(workspace,'sum.js'),'utf8'),original,'Edited before approval');
              const deny=scenario.deny||(scenario.blockOnce&&!deniedOnce);if(deny)deniedOnce=true;await frame.locator(deny?'#interaction-reject':'#interaction-approve').click();
            }else if(mode==='agent'&&!scenario.deny&&operation==='command'&&target===workspace){
              const command=(await card.locator('.interaction-detail').innerText()).trim();
              if(!['npm test','npm run test','node --test','node --test sum.test.mjs','node sum.test.mjs',"grep -q 'a + b' sum.js","grep -q 'sum(-2, 5)' README.md && grep -q 'sum(-1, -4)' README.md"].includes(command)){unexpectedDialogs++;await frame.locator('#interaction-reject').click();continue;}
              assert.equal(await fs.readFile(path.join(workspace,'package.json'),'utf8'),packageText);assert.equal(await fs.readFile(path.join(workspace,'sum.test.mjs'),'utf8'),testText);
              commandApprovals++;await frame.locator('#interaction-approve').click();
            }else{unexpectedDialogs++;await frame.locator('#interaction-reject').click();}
          }
          ended=await frame.evaluate(()=>window.testEvents.some(e=>e.type==='runEnd'));
          if(ended||trigger&&await frame.evaluate(()=>window.testEvents.findLast(e=>e.type==='planState')?.plan?.status==='completed')){ended=true;break;}
          await new Promise(r=>setTimeout(r,200));
        }
        if(!ended){await frame.locator('#stop').click();await frame.waitForFunction(()=>window.testEvents.some(e=>e.type==='runEnd'),null,{timeout:15000});}
        const next=await frame.evaluate(()=>window.testEvents);events.push(...next);return next;
      }
      if(scenario.project){await turn('oi',scenario.mode);assert.equal(events.filter(e=>e.type==='event'&&e.event.activity).length,0);}
      const first=await turn(prompt,scenario.mode);
      if(scenario.transition&&ended&&await frame.locator('#plan-toggle').isVisible()&&await frame.locator('#plan-toggle').getAttribute('aria-expanded')!=='true')await frame.locator('#plan-toggle').click();
      if(scenario.transition&&ended&&await frame.locator('#plan-approve').isVisible()){
        const offered=first.findLast(e=>e.type==='planState')?.plan;
        if(process.env.VORTEX_EVAL_MATRIX){
          const allowedCommands=['npm test','npm run test','node --test','node --test sum.test.mjs','node sum.test.mjs'];
          for(const scope of offered.authorization.steps){
            assert.ok(scope.files.every(f=>['sum.js','README.md'].includes(f.path)&&f.operation==='edit'),'Plan requests unexpected file authorization');
            assert.ok(scope.commands.every(c=>allowedCommands.includes(c.command)&&c.cwd==='.'&&c.execution_location==='host'&&!c.request_network),'Plan requests an unapproved command');
          }
        }
        initialPlan=first.findLast(e=>e.type==='planState')?.plan?.executions||[];
        assert.equal(await fs.readFile(path.join(workspace,'sum.js'),'utf8'),original);
        await turn('', 'agent',()=>frame.locator('#plan-approve').click());
        for(let review=0;review<10;review++){
          if(await frame.locator('#plan-toggle').isVisible()&&await frame.locator('#plan-toggle').getAttribute('aria-expanded')!=='true')await frame.locator('#plan-toggle').click();
          if(await frame.locator('#plan-resume').isVisible()&&scenario.blockOnce&&deniedOnce){await turn('','agent',()=>frame.locator('#plan-resume').click());continue;}
          if(await frame.locator('#plan-confirm').isVisible()){
            // This driver reviews only this arithmetic fixture, never arbitrary work.
            const data=events.findLast(e=>e.type==='planState')?.plan;
            const step=data?.steps.find(s=>s.id===data.active_step);
            const content=await fs.readFile(path.join(workspace,'sum.js'),'utf8');
            assert.ok(await verifySum(content),'Cannot confirm a broken implementation');
            if(/readme|doc|exemplo/i.test(JSON.stringify(step)))assert.ok(verifyDocumentation(await fs.readFile(path.join(workspace,'README.md'),'utf8')),'Positive and negative examples missing');
            manualReviews++;await turn('','agent',()=>frame.locator('#plan-confirm').click());continue;
          }
          break;
        }
      }
      const content=await fs.readFile(path.join(workspace,'sum.js'),'utf8');
      const activities=events.filter(e=>e.type==='event'&&e.event.activity).map(e=>e.event.activity);
      const end=events.findLast(e=>e.type==='runEnd'),planState=events.findLast(e=>e.type==='planState')?.plan,plan=planState?.executions||[];
      const read=activities.some(a=>['read_file','search_files'].includes(a.name)&&a.status==='success'); // Judge evidence, not a prescribed tool sequence.
      const functional=scenario.greeting?content===original&&activities.length===0&&events.some(e=>e.type==='event'&&e.event.role==='assistant'&&e.event.text.trim()):scenario.project?content===original&&read&&events.some(e=>e.type==='event'&&e.event.role==='assistant'&&/sum/i.test(e.event.text)):scenario.stop?content===original&&activities.length===0&&(await frame.locator('#prompt').inputValue())==='Keep this next draft':scenario.transition?(await functionalResult()&&planState?.status==='completed'):scenario.mode==='agent'?(scenario.deny?content===original&&approvals===1:await verifySum(content)&&approvals===(scenario.permission==='supervised'?1:0)):content===original&&read&&(scenario.mode!=='plan'||plan.length>0&&plan.every(i=>i.status==='pending'));
      const passed=ended&&functional&&(!scenario.transition||initialPlan.length>0&&initialPlan.every(i=>i.status==='pending'))&&unexpectedDialogs===0&&(scenario.stop?end?.status==='stopped':scenario.deny||scenario.transition&&planState?.status==='completed'||end?.status==='complete'||scenario.mode==='plan'&&planState?.status==='proposed');
      report.results.push({...scenario,passed,durationMs:Date.now()-started,approvals,commandApprovals,unexpectedDialogs,end,initialPlan,plan:planState,manualReviews,deniedOnce,activities,failures:events.filter(e=>e.type==='runFailure'),answers:events.filter(e=>e.type==='event'&&e.event.role==='assistant').map(e=>e.event.text),phases:[...new Set(events.filter(e=>e.type==='runProgress').map(e=>e.progress.phase))]});
      report.results.at(-1).trace_file=await retainTrace(scenario.name);
      await save();await window.screenshot({path:path.join(output,scenario.name+'.png')});console.log('Finished real Extension Host:',scenario.name,{passed,approvals,seconds:Math.round((Date.now()-started)/1000)});
      if(!ended)break;
      }catch(error){
        // A rejected scope or failed external assertion is a failed case, not
        // permission to widen the allowlist or omit the remaining scenarios.
        if(await frame.locator('#stop').isVisible().catch(()=>false)){await frame.locator('#stop').click();await frame.waitForFunction(()=>window.testEvents.some(e=>e.type==='runEnd'),null,{timeout:15000}).catch(()=>{});}
        const events=await frame.evaluate(()=>window.testEvents).catch(()=>[]);
        report.results.push({...scenario,passed:false,durationMs:Date.now()-caseStarted,error:error.message,events,trace_file:await retainTrace(scenario.name)});
        await save();await window.screenshot({path:path.join(output,scenario.name+'-failure.png')}).catch(()=>{});console.log('Finished real Extension Host:',scenario.name,{passed:false,error:error.message});
      }
    }
    report.accepted=report.results.length===scenarios.length&&report.results.every(r=>r.passed);await save();if(!report.accepted)process.exitCode=1;
  }catch(error){report.error=error.message;report.accepted=false;await save();if(window)await window.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
  finally{if(app)await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
