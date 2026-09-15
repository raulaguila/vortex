const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const names = {openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini',ollama:'Ollama',compatible:'OpenAI-compatible'};
const defaults = {openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta',ollama:'http://localhost:11434',compatible:''};
let state = {providers:[],preferences:{selected:null,favorites:[],manualModels:[],defaults:{ask:null,plan:null,agent:null},conversation:{language:'auto',uiLanguage:'en',fontSize:null,sendKey:'enter'}}};
let savedState, drafts={},savingSection;
let busy=false, editingId, formRevision=0, formPending=null, removeConfirm, section='providers', sequence=0;
const pending=new Map(), session='settings:'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const same=(a,b)=>!!a&&!!b&&a.providerId===b.providerId&&a.modelId===b.modelId;
const modelKey=m=>JSON.stringify([m.providerId,m.modelId]);
const create=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
function request(type,data={},context={}){
 if(!context.commit&&stage(type,data))return;
const requestId=session+':'+(++sequence);pending.set(requestId,{type,...context});vscode.postMessage({type,requestId,...data});return requestId;}
function notice(id,text='',error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function switchSection(next){notice('settings-notice');section=next;for(const name of ['providers','models','conversation','execution','diagnostics']){$('section-'+name).hidden=name!==next;const tab=$('nav-'+name);tab.setAttribute('aria-selected',String(name===next));tab.tabIndex=name===next?0:-1;}vscode.setState({section});if(next==='diagnostics')request('traceInfo');}
function updateBusy(value){busy=value;$('add-provider').disabled=value||!!formPending;$('provider-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=value||formPending?.kind==='save');if(!value&&formPending?.kind!=='save')$('provider-key').disabled=$('clear-key').checked;if(formPending)$(formPending.kind==='save'?'save-provider':'test-provider').disabled=true;renderConnections();timeoutFields();}
function catalogText(p) {
  const c = p.catalog;
  if(c.status === 'loading') return 'Consultando modelos…';
  if(c.status === 'error') return c.error || 'Catálogo indisponível.';
  if(c.status === 'ready') return c.models.length ? `${c.models.length} modelos no catálogo` : 'Catálogo vazio. Adicione um modelo manualmente.';
  return 'Catálogo ainda não consultado.';
}
function preserveFocus(container, render) {
  const focus = container.contains(document.activeElement) ? document.activeElement.dataset.focus : undefined;
  const scroll = container.scrollTop; render(); container.scrollTop = scroll;
  if(focus) container.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
}
function renderModels() {
  const container = $('model-options');
  preserveFocus(container, () => {
    container.replaceChildren();
    const query = $('model-search').value.trim().toLocaleLowerCase();
    let count = 0;
    function row(ref, subtitle) {
      const line = create('div', 'model-row'); line.classList.toggle('selected', same(state.preferences.selected, ref));
      const choice = create('span', 'model-name', ref.modelId); choice.dataset.focus = 'pick:' + modelKey(ref) + ':' + subtitle;
      if(subtitle) choice.append(create('small', '', subtitle));
      choice.setAttribute('aria-label', `${ref.modelId}, ${subtitle || state.providers.find(p => p.id === ref.providerId)?.name}`);

      const favorite = state.preferences.favorites.some(m => same(m, ref));
      const star = create('button', 'favorite-button' + (favorite ? ' active' : ''), favorite ? '★' : '☆');
      star.dataset.focus = 'star:' + modelKey(ref) + ':' + subtitle; star.setAttribute('aria-pressed', String(favorite)); star.setAttribute('aria-label', `${favorite ? 'Desfavoritar' : 'Favoritar'} ${ref.modelId}`);
      star.onclick = () => request('favoriteModel', {model:ref, favorite:!favorite});
      const protocol=create('select','tool-protocol');protocol.setAttribute('aria-label','Tool protocol · '+ref.modelId);protocol.dataset.focus='protocol:'+modelKey(ref)+':'+subtitle;
      for(const [value,label] of [['auto','Auto'],['native','Native tools'],['compatibility','Compatibility']]){const option=create('option','',label);option.value=value;protocol.append(option);}
      protocol.value=state.preferences.toolProtocols?.[modelKey(ref)]||'auto';protocol.title='Effective protocol: '+(state.effectiveProtocols?.[modelKey(ref)]||'compatibility');protocol.disabled=busy;protocol.onchange=()=>request('setToolProtocol',{model:ref,protocol:protocol.value});
      line.append(choice, star); container.append(line); count++;
    }
    const favorites = state.preferences.favorites.filter(ref => { const p = state.providers.find(p => p.id === ref.providerId); return p && `${ref.modelId} ${p.name}`.toLocaleLowerCase().includes(query); });
    if(favorites.length) { container.append(create('h3', 'model-group', 'Favoritos')); favorites.forEach(ref => row(ref, state.providers.find(p => p.id === ref.providerId).name)); }
    for(const p of state.providers) {
      const ids = [...new Set([...p.catalog.models, ...state.preferences.manualModels.filter(m => m.providerId === p.id).map(m => m.modelId)])].sort();
      const matches = ids.filter(id => `${id} ${p.name} ${names[p.kind]}`.toLocaleLowerCase().includes(query));
      if(!matches.length && query && !`${p.name} ${names[p.kind]}`.toLocaleLowerCase().includes(query)) continue;
      container.append(create('h3', 'model-group', `${p.name} · ${names[p.kind]}`));
      matches.forEach(modelId => row({providerId:p.id, modelId}, ''));
      if(p.catalog.status !== 'ready' || !ids.length) container.append(create('p', 'picker-empty', catalogText(p)));
    }
    if(!state.providers.length) container.append(create('p', 'picker-empty', 'Conecte um provedor para escolher seus modelos.'));
    else if(query && !count) container.append(create('p', 'picker-empty', 'Nenhum modelo encontrado. Você pode adicionar um ID nas configurações.'));
  });
}
function actionButton(text, onClick, disabled, focus) { const b = create('button', '', text); b.type = 'button'; b.disabled = !!disabled; b.onclick = onClick; b.dataset.focus = focus; return b; }
function renderConnections() {
  preserveFocus($('connections'), () => {
    $('connections').replaceChildren();
    if(!state.providers.length) $('connections').append(create('p', 'picker-empty', 'Nenhum provedor conectado. Adicione sua primeira conexão para começar.'));
    for(const p of state.providers) {
      const card = create('div', 'connection');
      const heading = create('div', 'connection-heading'); const title = create('div');
      const icon=create('span','provider-icon provider-'+p.kind,{openai:'◎',anthropic:'A',gemini:'✦',ollama:'◉',compatible:'‹›'}[p.kind]);icon.setAttribute('aria-label',names[p.kind]);heading.append(icon);title.append(create('h3', '', p.name), create('span', 'connection-kind', names[p.kind] + (p.hasKey ? ' · Chave salva' : ' · Sem chave'))); heading.append(title);
      card.append(heading, create('div', 'connection-url', p.baseUrl));
      const status = create('div', 'connection-status' + (p.catalog.status === 'error' ? ' error' : ''), catalogText(p)); status.setAttribute('role', 'status'); card.append(status);
      const actions = create('div', 'connection-actions');
      actions.append(actionButton('Editar', () => openForm(p), busy || !!formPending, 'edit:'+p.id), actionButton('Atualizar modelos', () => request('refreshModels', {id:p.id}), p.catalog.status === 'loading', 'refresh:'+p.id), actionButton('Remover', () => {removeConfirm=p.id;renderConnections();$('connections').querySelector(`[data-focus="confirm:${CSS.escape(p.id)}"]`)?.focus();}, busy || !!formPending, 'remove:'+p.id)); card.append(actions);
      if(removeConfirm === p.id) {
        const confirmation = create('div', 'remove-confirm', 'Remover esta conexão e sua chave salva?');
        const controls = create('div', 'connection-actions');
        controls.append(actionButton('Remover conexão', () => {request('removeProvider', {id:p.id}, {id:p.id});removeConfirm=undefined;}, busy, 'confirm:'+p.id), actionButton('Cancelar', () => {removeConfirm=undefined;renderConnections();}, false, 'cancel:'+p.id)); confirmation.append(controls);card.append(confirmation);
      }
      $('connections').append(card);
    }
  });
}
function renderManual() {
  $('manual-section').hidden = !state.providers.length;
  const previous = $('manual-provider').value; $('manual-provider').replaceChildren();
  state.providers.forEach(p => {const option = create('option', '', p.name);option.value=p.id;$('manual-provider').append(option);});
  if(state.providers.some(p => p.id === previous)) $('manual-provider').value = previous;
  preserveFocus($('manual-list'), () => {
    $('manual-list').replaceChildren();
    state.preferences.manualModels.forEach(model => {const p=state.providers.find(p=>p.id===model.providerId);if(!p)return;const row=create('div','manual-row');const label=create('span','',model.modelId);label.append(create('small','',p.name));row.append(label,actionButton('Remover',()=>request('manualModel',{model,remove:true}),false,'manual:'+modelKey(model)));$('manual-list').append(row);});
  });
}
function renderDefaults(){
 const refs=new Map();for(const p of state.providers){for(const modelId of p.catalog.models){const ref={providerId:p.id,modelId};refs.set(modelKey(ref),ref);}}
 for(const ref of [...state.preferences.manualModels,...state.preferences.favorites,...Object.values(state.preferences.defaults).filter(Boolean)])if(state.providers.some(p=>p.id===ref.providerId))refs.set(modelKey(ref),ref);
 for(const mode of ['ask','plan','agent']){const select=$('default-'+mode);select.replaceChildren();const empty=create('option','','Sem padrão — manter seleção');empty.value='';select.append(empty);for(const ref of refs.values()){const p=state.providers.find(p=>p.id===ref.providerId);const option=create('option','',ref.modelId+' · '+p.name);option.value=modelKey(ref);select.append(option);}select.value=state.preferences.defaults[mode]?modelKey(state.preferences.defaults[mode]):'';}
}
function renderState(next){savedState=structuredClone(next);state=structuredClone(next);for(const [name,value]of Object.entries(drafts)){if(name==='models')Object.assign(state.preferences,value);else state.preferences[name]=value;}window.VortexUI.setLanguage(next.preferences.conversation.uiLanguage);$('ui-language').value=state.preferences.conversation.uiLanguage;renderConnections();renderModels();renderManual();renderDefaults();renderContextOptions();$('language').value=state.preferences.conversation.language;$('font-size').value=state.preferences.conversation.fontSize??'';$('send-key').value=state.preferences.conversation.sendKey;if(editingId&&!state.providers.some(p=>p.id===editingId))closeForm();}
function formChanged() { formRevision++; notice('form-notice'); if(formPending?.kind==='test') {formPending=null; $('test-provider').disabled=busy; $('test-provider').textContent='Testar conexão';} }
function keyHelp() {
  const p=state.providers.find(p=>p.id===editingId);const optional=['ollama','compatible'].includes($('provider-kind').value);
  $('tls-setting').hidden=$('provider-kind').value!=='compatible';
  $('tls-setting').hidden=$('provider-kind').value!=='compatible';
  $('clear-key-label').hidden=!(optional&&p?.hasKey);if($('clear-key-label').hidden)$('clear-key').checked=false;
  $('key-status').textContent=p?.hasKey?'Chave salva':optional?'Opcional':'';
  $('provider-key').placeholder=p?.hasKey?'Deixe vazio para manter a chave':'Cole sua chave';
  $('key-hint').textContent=p?.hasKey?'Campo vazio mantém a chave atual. Cole outra para substituí-la.':optional?'Pode ficar vazio se o servidor não exigir autenticação.':'Sua chave nunca é exibida após ser salva.';
  $('provider-key').disabled=busy||$('clear-key').checked||formPending?.kind==='save';
}
function openForm(provider) {
  editingId=provider?.id; formPending=null; formRevision++; $('provider-form').hidden=false;
  $('form-title').textContent=provider?'Editar conexão':'Nova conexão';
  $('provider-kind').value=provider?.kind||'openai';$('provider-name').value=provider?.name||'OpenAI';$('provider-url').value=provider?.baseUrl||defaults.openai;$('provider-key').value='';$('clear-key').checked=false;$('tls-insecure').checked=!!provider?.tlsInsecure;$('inherit-timeouts').checked=!provider?.timeouts;$('provider-first-timeout').value=provider?.timeouts?.firstResponseTimeout||state.preferences.execution?.firstResponseTimeout||120;$('provider-idle-timeout').value=provider?.timeouts?.idleTimeout||state.preferences.execution?.idleTimeout||120;timeoutFields();
  notice('form-notice');$('test-provider').textContent='Testar conexão';$('save-provider').textContent='Salvar';keyHelp();updateBusy(busy);
  if(!$('provider-dialog').open)$('provider-dialog').showModal();$('provider-name').focus();
}
function closeForm() { $('provider-dialog').close(); $('provider-key').value=''; $('provider-form').hidden=true;editingId=undefined;formRevision++;formPending=null; }
function inputProvider() { return {id:editingId, name:$('provider-name').value.trim(),kind:$('provider-kind').value,baseUrl:$('provider-url').value.trim(),key:$('provider-key').value,clearKey:$('clear-key').checked,timeouts:$('inherit-timeouts').checked?null:{firstResponseTimeout:Number($('provider-first-timeout').value),idleTimeout:Number($('provider-idle-timeout').value)},tlsInsecure:$('provider-kind').value==='compatible'&&$('tls-insecure').checked}; }
function submitProvider(kind) {
  if(busy||formPending?.kind==='save'||!$('provider-form').reportValidity())return;
  const provider=inputProvider();const revision=formRevision;
  const id=request(kind==='save'?'saveProvider':'testProvider',{provider},{revision,kind});
  formPending={id,kind};notice('form-notice',kind==='save'?'Salvando conexão…':'Consultando o catálogo…');
  $(kind==='save'?'save-provider':'test-provider').textContent=kind==='save'?'Salvando…':'Testando…';updateBusy(busy);
}

$('add-provider').onclick=()=>openForm();$('cancel-form').onclick=closeForm;
$('provider-form').onsubmit=e=>{e.preventDefault();submitProvider('save');};$('test-provider').onclick=()=>submitProvider('test');
$('provider-form').addEventListener('input',formChanged);
$('provider-kind').onchange=()=>{const kind=$('provider-kind').value;if(Object.values(names).includes($('provider-name').value))$('provider-name').value=names[kind];$('provider-url').value=defaults[kind];$('clear-key').checked=false;formChanged();keyHelp();};
$('clear-key').onchange=()=>{if($('clear-key').checked)$('provider-key').value='';formChanged();keyHelp();};
$('manual-form').onsubmit=e=>{e.preventDefault();const model={providerId:$('manual-provider').value,modelId:$('manual-id').value.trim()};if(model.modelId)request('manualModel',{model,remove:false},{manualValue:$('manual-id').value});};
$('model-search').oninput=renderModels;
for(const tab of document.querySelectorAll('[data-section]'))tab.onclick=()=>switchSection(tab.dataset.section);
document.querySelector('.settings-nav').onkeydown=e=>{if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-section]')];const i=tabs.indexOf(document.activeElement);const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(['ArrowRight','ArrowDown'].includes(e.key)?1:tabs.length-1))%tabs.length;tabs[next].focus();switchSection(tabs[next].dataset.section);};
for(const select of document.querySelectorAll('[data-default]'))select.onchange=()=>{const value=select.value?JSON.parse(select.value):null;request('setDefaultModel',{mode:select.dataset.default,model:value?{providerId:value[0],modelId:value[1]}:null});};
$('ui-language').onchange=()=>request('setConversation',{patch:{uiLanguage:$('ui-language').value}});
$('language').onchange=()=>request('setConversation',{patch:{language:$('language').value}});
$('font-size').onchange=()=>request('setConversation',{patch:{fontSize:$('font-size').value?Number($('font-size').value):null}});
$('send-key').onchange=()=>request('setConversation',{patch:{sendKey:$('send-key').value}});
window.addEventListener('pagehide',()=>{$('provider-key').value='';});
window.addEventListener('message',({data:m})=>{
 if(m.type==='state'){renderState(m.state);updateBusy(m.busy);return;}
 if(m.type==='status'){updateBusy(m.busy);return;}
 if(m.type==='settingsSection'){switchSection(m.section);return;}
 if(m.type==='traceInfo'){$('trace-location').textContent=m.path;$('trace-size').textContent=m.exists?(m.bytes/1024).toFixed(1)+' KB':window.VortexUI.t('No saved flow yet.');$('open-trace').disabled=$('export-trace').disabled=!m.exists;return;}
 if(m.type==='chatTestResult'){testChatPending=false;$('test-chat').disabled=busy;$('cancel-chat-test').hidden=true;notice('chat-test-result',(m.ok?'OK · ':'')+m.elapsed+' ms · '+m.protocol+' · '+m.message,!m.ok);pending.delete(m.requestId);return;}
 if(m.type!=='result')return;const context=pending.get(m.requestId);pending.delete(m.requestId);if(!context)return;
 if(context.section){savingSection=undefined;if(m.ok){delete drafts[context.section];renderState(savedState);}sectionState(context.section,m.ok?'Saved.':m.message,!m.ok);return;}
 if(context.type==='setExecution'){executionPending=false;saveExecution.disabled=false;executionForm.querySelectorAll('input').forEach(input=>input.disabled=false);if(m.ok)executionDirty=false;notice('execution-notice',m.ok?window.VortexUI.t('Execution limits saved.'):m.message||window.VortexUI.t('Could not save execution limits.'),!m.ok);return;}
 if(['saveProvider','testProvider'].includes(context.type)){
  if(context.revision!==formRevision||formPending?.id!==m.requestId)return;formPending=null;$('test-provider').textContent='Testar conexão';$('save-provider').textContent='Salvar';
  if(m.ok&&context.type==='saveProvider'){editingId=m.providerId;$('form-title').textContent='Editar conexão';$('provider-key').value='';$('clear-key').checked=false;keyHelp();}
  notice('form-notice',m.message,!m.ok);updateBusy(busy);return;
 }
 if(context.type==='manualModel'&&m.ok&&context.manualValue===$('manual-id').value)$('manual-id').value='';
 if(context.type==='removeProvider'&&m.ok&&context.id===editingId)closeForm();
 notice('settings-notice',m.message||(m.ok?'Salvo.':'Não foi possível salvar.'),!m.ok);
 if(!m.ok)request('ready');
});
switchSection('providers');request('ready');

$('provider-dialog').addEventListener('cancel',e=>{if(formPending?.kind==='save')e.preventDefault();else closeForm();});
let contextViewKey='';
function contextRef(){try{const v=JSON.parse($('context-model').value);return {providerId:v[0],modelId:v[1]};}catch{return null;}}
function renderContextOptions(){const prior=$('context-model').value;const select=$('context-model');select.replaceChildren();for(const option of $('default-agent').options)if(option.value)select.append(option.cloneNode(true));if([...select.options].some(o=>o.value===prior))select.value=prior;else if(state.preferences.selected){const key=modelKey(state.preferences.selected);if([...select.options].some(o=>o.value===key))select.value=key;}renderContext();}
function renderContext(force=false){
 const model=contextRef();if(!model){$('context-limit').textContent=window.VortexUI.t('Select model');return;}
 $('advanced-protocol').value=state.preferences.toolProtocols?.[modelKey(model)]||'auto';const key=modelKey(model),limit=state.limits?.[key],config=state.preferences.context?.[key];
 $('context-limit').textContent=limit?.input?(window.VortexUI.language()==='pt'?'Limite informado pela API: ':'API reported limit: ')+limit.input.toLocaleString()+' tokens':(window.VortexUI.language()==='pt'?'Limite da API desconhecido. Padrão conservador: 16.384 tokens.':'API limit unknown. Conservative default: 16,384 tokens.');
 $('context-source').options[0].disabled=!limit?.input;$('context-tokens').max=limit?.input||10000000;
 const version=key+JSON.stringify(config)+JSON.stringify(limit);if(force||version!==contextViewKey){contextViewKey=version;$('context-source').value=config?.source||(limit?.input?'api':'custom');$('context-tokens').value=state.contextBudgets?.[key]?.tokens||($('context-source').value==='api'?limit?.input||16384:Math.min(config?.tokens||limit?.input||16384,limit?.input||Infinity));}
 $('context-tokens').disabled=$('context-source').value==='api';
}
$('context-model').onchange=()=>{renderContext(true);const model=contextRef();if(model)request('modelInfo',{model});};
$('inspect-context').onclick=()=>{const model=contextRef();if(model)request('modelInfo',{model});};
$('context-source').onchange=()=>{const api=$('context-source').value==='api';$('context-tokens').disabled=api;if(api){const ref=contextRef();$('context-tokens').value=state.limits?.[ref?modelKey(ref):'']?.input||16384;}};
$('save-context').onclick=()=>{const model=contextRef();if(!model||!$('context-tokens').reportValidity())return;request('setContext',{model,source:$('context-source').value,tokens:Number($('context-tokens').value)});request('setToolProtocol',{model,protocol:$('advanced-protocol').value});};

let executionDirty=false,executionPending=false;
const executionForm=create('form','execution-settings');executionForm.append(create('h2','','Execution limits'),create('p','section-description','Control how long each task can run. Save changes below.'));
for(const [name,label,value,min,max] of [['maxRounds','Work rounds per turn',20,1,200],['maxToolCalls','Tool calls per turn',20,1,200],['firstResponseTimeout','First response timeout (seconds)',120,1,3600],['idleTimeout','Response inactivity timeout (seconds)',120,1,3600],['commandTimeout','Command timeout (seconds)',60,1,3600],['taskTimeout','Task timeout (seconds)',1800,1,86400],['tokenBudget','Token budget (empty = unlimited)','',1024,100000000]]){
 const row=create('div','preference-row'),labelEl=create('label','',label),input=create('input');input.type='number';input.min=min;input.max=max;input.step='1';input.value=value;input.name=name;input.id='execution-'+name;labelEl.htmlFor=input.id;if(name!=='tokenBudget')input.required=true;row.append(labelEl,input);executionForm.append(row);
}
executionForm.append(create('p','','Time limits apply to the next task. Active streaming resets the inactivity timer. The total task limit includes approval waits.'));
const saveExecution=create('button','primary-button','Save execution limits');saveExecution.type='submit';const executionActions=create('div','execution-actions'),executionNotice=create('p','');executionNotice.id='execution-notice';executionNotice.setAttribute('role','status');executionNotice.setAttribute('aria-live','polite');executionActions.append(saveExecution,executionNotice);executionForm.append(executionActions);$('section-execution').append(executionForm);
executionForm.oninput=()=>{executionDirty=true;notice('execution-notice',window.VortexUI.t('Unsaved changes.'));};
executionForm.onsubmit=e=>{e.preventDefault();if(executionPending)return;const values=Object.fromEntries([...executionForm.elements].filter(e=>e.name).map(e=>[e.name,e.value===''?null:Number(e.value)]));executionPending=true;saveExecution.disabled=true;executionForm.querySelectorAll('input').forEach(input=>input.disabled=true);notice('execution-notice',window.VortexUI.t('Saving…'));request('setExecution',{execution:values},{commit:true});};
window.addEventListener('message',({data:m})=>{if(m.type==='state'&&m.state.preferences.execution&&!executionDirty&&!executionPending&&!executionForm.contains(document.activeElement))for(const [name,value]of Object.entries(m.state.preferences.execution))if(executionForm.elements.namedItem(name))executionForm.elements.namedItem(name).value=value??'';});

const sandboxSection=create('section','execution-settings');sandboxSection.append(create('h2','','Isolated commands'),create('p','','Autonomous commands use a local Docker container. Without Docker, commands require host approval. Network is off by default.'));
const setupSandbox=create('button','secondary-button','Download sandbox image');setupSandbox.onclick=()=>request('setupSandbox');sandboxSection.append(setupSandbox);$('section-execution').append(sandboxSection);

function timeoutFields(){for(const id of ['provider-first-timeout','provider-idle-timeout'])$(id).disabled=$('inherit-timeouts').checked||busy||formPending?.kind==='save';}
$('inherit-timeouts').onchange=timeoutFields;
function sectionState(name,text='Unsaved changes.',error=false){for(const key of ['models','conversation']){const fields=$('fields-'+key);if(fields)fields.disabled=savingSection===key;const save=$('save-'+key),discard=$('discard-'+key);if(save)save.disabled=!drafts[key]||!!savingSection;if(discard)discard.disabled=!drafts[key]||!!savingSection;}const n=$('section-'+name+'-notice');if(n){n.textContent=window.VortexUI.t(text);n.classList.toggle('error',error);}}
function stage(type,data){
 if(['setConversation','favoriteModel','manualModel','setDefaultModel','setToolProtocol','setContext'].includes(type))notice('settings-notice');
 const modelTypes=['favoriteModel','manualModel','setDefaultModel','setToolProtocol','setContext'];
 if(type==='setConversation'){drafts.conversation={...(drafts.conversation||state.preferences.conversation),...data.patch};sectionState('conversation');return true;}
 if(!modelTypes.includes(type))return false;
 const p=drafts.models||structuredClone(Object.fromEntries(['defaults','favorites','manualModels','toolProtocols','context'].map(k=>[k,state.preferences[k]||{}])));
 if(type==='favoriteModel'){p.favorites=p.favorites.filter(r=>!same(r,data.model));if(data.favorite)p.favorites.push(data.model);}
 if(type==='manualModel'){p.manualModels=p.manualModels.filter(r=>!same(r,data.model));if(!data.remove)p.manualModels.push(data.model);$('manual-id').value='';}
 if(type==='setDefaultModel')p.defaults[data.mode]=data.model;
 if(type==='setToolProtocol')p.toolProtocols[modelKey(data.model)]=data.protocol;
 if(type==='setContext')p.context[modelKey(data.model)]={source:data.source,tokens:data.tokens};
 drafts.models=p;Object.assign(state.preferences,p);sectionState('models');renderModels();renderManual();renderDefaults();return true;
}
for(const name of ['models','conversation']){
 const bar=create('div','section-save'),save=create('button','primary-button','Save'),discard=create('button','secondary-button','Discard'),noticeEl=create('p','');save.id='save-'+name;discard.id='discard-'+name;noticeEl.id='section-'+name+'-notice';noticeEl.setAttribute('role','status');bar.append(save,discard,noticeEl,create('small','','Unsaved changes are discarded when this tab closes.'));const fields=create('fieldset','section-fields');fields.id='fields-'+name;const sectionEl=$('section-'+name);while(sectionEl.firstChild)fields.append(sectionEl.firstChild);sectionEl.append(fields,bar);
 save.onclick=()=>{if(!drafts[name]||savingSection)return;if(name==='models'&&!$('context-tokens').reportValidity())return;savingSection=name;sectionState(name,'Saving…');request(name==='models'?'saveModels':'setConversation',name==='models'?{settings:drafts[name]}:{patch:drafts[name]},{commit:true,section:name});};
 discard.onclick=()=>{if(savingSection)return;delete drafts[name];renderState(savedState);sectionState(name,'Changes discarded.');};sectionState(name,'');
}
const resetConversation=create('button','text-button','Restore defaults');resetConversation.onclick=()=>{if(savingSection)return;drafts.conversation={language:'auto',uiLanguage:'en',fontSize:null,sendKey:'enter'};renderState(savedState);sectionState('conversation');};$('section-conversation').append(resetConversation);
const discardExecution=create('button','secondary-button','Discard'),resetExecution=create('button','text-button','Restore defaults');discardExecution.type=resetExecution.type='button';executionActions.append(discardExecution,resetExecution);
function fillExecution(values){for(const [key,value]of Object.entries(values))if(executionForm.elements.namedItem(key))executionForm.elements.namedItem(key).value=value??'';}
discardExecution.onclick=()=>{if(executionPending)return;fillExecution(savedState.preferences.execution);executionDirty=false;notice('execution-notice','Changes discarded.');};resetExecution.onclick=()=>{if(executionPending)return;fillExecution({maxRounds:20,maxToolCalls:20,firstResponseTimeout:120,idleTimeout:120,commandTimeout:60,taskTimeout:1800,tokenBudget:null});executionDirty=true;notice('execution-notice','Unsaved changes.');};
$('reset-model').onclick=()=>{const ref=contextRef();if(!ref)return;$('context-source').value=state.limits?.[modelKey(ref)]?.input?'api':'custom';$('context-tokens').value=state.limits?.[modelKey(ref)]?.input||16384;$('advanced-protocol').value='auto';$('save-context').click();};
let testChatPending=false;const testArea=create('section','defaults-card chat-test');const testButton=create('button','secondary-button','Test chat'),cancelTest=create('button','text-button','Cancel');testButton.id='test-chat';cancelTest.id='cancel-chat-test';cancelTest.hidden=true;const testResult=create('p','notice');testResult.id='chat-test-result';testResult.setAttribute('role','status');testArea.append(create('h3','','Chat connection test'),create('p','','Uses the selected model above. No workspace context or tools are sent.'),testButton,cancelTest,testResult);document.querySelector('.context-settings').after(testArea);
 testButton.onclick=()=>{const model=contextRef();if(!model||busy||testChatPending)return;testChatPending=true;testButton.disabled=true;cancelTest.hidden=false;notice('chat-test-result','Testing…');request('testChat',{model});};cancelTest.onclick=()=>request('cancelTestChat');
$('open-trace').onclick=()=>request('openTrace');$('export-trace').onclick=()=>request('exportTrace');$('clear-trace').onclick=()=>request('clearTrace');
window.addEventListener('message',({data:m})=>{if(m.type==='status'||m.type==='state'){$('clear-trace').disabled=!!m.busy;testButton.disabled=!!m.busy||testChatPending;}});

$('save-context').hidden=true;
const stageContext=()=>{const model=contextRef();if(!model||!$('context-tokens').checkValidity())return;request('setContext',{model,source:$('context-source').value,tokens:Number($('context-tokens').value)});};
$('context-source').addEventListener('change',stageContext);$('context-tokens').addEventListener('input',stageContext);$('advanced-protocol').onchange=()=>{const model=contextRef();if(model)request('setToolProtocol',{model,protocol:$('advanced-protocol').value});};
