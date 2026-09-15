const vscode=acquireVsCodeApi();
const $=id=>document.getElementById(id);
const saved=vscode.getState()||{};
const names={openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini',ollama:'Ollama',compatible:'OpenAI-compatible'};
let state={providers:[],preferences:{selected:null,favorites:[],manualModels:[],defaults:{ask:null,plan:null,agent:null},conversation:{language:'auto',uiLanguage:'en',fontSize:null,sendKey:'enter'}}};
let busy=false,starting=false,modeChanging=false,clearing=false,sequence=0;
const modelPicker=new window.ComposerPicker($('model-picker'),document.querySelector('.composer'));
const choicePicker=new window.ComposerPicker($('choice-menu'),document.querySelector('.composer'));
let contextUsage=null;
let sessionRows=[],sessionQueryId='',searchTimer;
const pending=new Map(),session='chat:'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const same=(a,b)=>!!a&&!!b&&a.providerId===b.providerId&&a.modelId===b.modelId;
const modelKey=m=>JSON.stringify([m.providerId,m.modelId]);
const create=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
function request(type,data={},context={}){const requestId=session+':'+(++sequence);if(!['ready','stop','listSessions','openLink'].includes(type))pending.set(requestId,{type,...context});vscode.postMessage({type,requestId,...data});return requestId;}
function persist(){vscode.setState({draft:$('prompt').value,mode:$('mode').value,permission:$('permission').value,initialized:true});}
function notice(id,text='',error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function autosize(){$('prompt').style.height='auto';$('prompt').style.height=Math.min($('prompt').scrollHeight,220,window.innerHeight*.35)+'px';}
function updatePermissions(){$('permission').hidden=true;$('permission-trigger').hidden=false;$('read-only').hidden=true;updateChoiceLabels();persist();}
function updateBusy(value,text){busy=value;if(text)$('run-status').textContent=text;$('send').hidden=value;$('stop').hidden=!value;$('stop').disabled=false;for(const id of ['mode','mode-trigger','permission','permission-trigger','model-trigger','new-task','close-chat'])$(id).disabled=value||starting||modeChanging||clearing;$('send').disabled=value||starting||modeChanging||clearing||!$('prompt').value.trim();}
function messageAction(icon,label,handler){
 const button=create('button','icon-button message-action');button.title=window.VortexUI.t(label);button.setAttribute('aria-label',window.VortexUI.t(label));
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+icon);svg.append(use);button.append(svg);button.onclick=handler;return button;
}
function addEvent(event) {
 const timeline=$('timeline'),follow=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<80;
 $('welcome')?.remove();$('close-chat').hidden=false;
 if(event.role==='user'&&!$('chat-heading').dataset.title){const title=event.text.replace(/\s+/g,' ').slice(0,90);$('chat-heading').dataset.title=title;$('chat-heading').querySelector('span').textContent=title;$('chat-heading').title=title;}
 if(event.role==='activity'){
   let group=timeline.lastElementChild;
   if(!group?.classList.contains('activity-group')){group=create('details','activity-group');group.append(create('summary'));group.dataset.count='0';timeline.append(group);}
   group.dataset.count=String(Number(group.dataset.count)+1);group.querySelector('summary').textContent=window.VortexUI.t('Activities')+' · '+group.dataset.count;
   const details=create('details','activity');const [title,...body]=event.text.split('\n');details.append(create('summary','',title),create('pre','',body.join('\n')));group.append(details);
 }else{
   const item=create('article',event.role);item.setAttribute('aria-label',event.role==='user'?window.VortexUI.t('You'):'Vortex');
   const bubble=create('div','message-content'),body=markdownBody(event.text,event.role);bubble.append(body);
   if(event.role==='user'&&(event.text.length>600||event.text.split('\n').length>10)){
     body.classList.add('message-collapsed');const expand=create('button','expand-message',window.VortexUI.t('Show more'));expand.setAttribute('aria-expanded','false');expand.onclick=()=>{const collapsed=body.classList.toggle('message-collapsed');expand.textContent=window.VortexUI.t(collapsed?'Show more':'Show less');expand.setAttribute('aria-expanded',String(!collapsed));};bubble.append(expand);
   }
   item.append(bubble);const actions=create('div','message-actions');
   if(Number.isFinite(event.timestamp)){const time=create('time','message-time',new Date(event.timestamp).toLocaleTimeString(window.VortexUI.language(),{hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(event.timestamp).toISOString();time.title=new Date(event.timestamp).toLocaleString();actions.append(time);}
   const copy=messageAction('copy','Copy message',()=>{copy.disabled=true;request('copyText',{text:event.text},{copyButton:copy});});actions.append(copy);
   if(event.role==='user')actions.append(messageAction('edit','Reuse message',()=>{if(busy||starting)return;if($('prompt').value.trim()&&$('prompt').value!==event.text){notice('chat-notice',window.VortexUI.t('Clear the current draft before reusing a message.'));return;}$('prompt').value=event.text;persist();autosize();updateBusy(busy);$('prompt').focus();}));
   item.append(actions);timeline.append(item);
 }
 if(follow||event.role==='user')timeline.scrollTop=timeline.scrollHeight;
}
function welcome(){delete $('chat-heading').dataset.title;$('chat-heading').title='';contextUsage=null;renderContext();$('close-chat').hidden=true;$('chat-heading').querySelector('span').textContent=window.VortexUI.t('Chats');$('timeline').replaceChildren();const el=create('div','welcome');el.id='welcome';const img=create('img','empty-symbol');img.src=document.querySelector('.brand img').src;img.alt='Vortex';el.append(img);$('timeline').append(el);renderRecent();}
function renderSelection() {
  const ref = state.preferences.selected;
  const provider = state.providers.find(p => p.id === ref?.providerId);
  $('selected-model').textContent = provider && ref ? ref.modelId : 'Selecionar modelo';
  $('model-trigger').title = provider && ref ? `${ref.modelId} · ${provider.name}` : 'Selecionar modelo';
  const connect = $('connect-welcome'); if(connect) connect.hidden = state.providers.length > 0;
}
function closePicker(focus = true) {modelPicker.close(focus);}
function openPicker() {
  if(busy || starting || modeChanging) return;
  $('model-search').value='';renderModels();modelPicker.open($('model-trigger'),$('model-search'));
}
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
      const choice = create('button', 'model-option', ref.modelId); choice.dataset.focus = 'pick:' + modelKey(ref) + ':' + subtitle;
      if(subtitle) choice.append(create('small', '', subtitle));
      choice.setAttribute('aria-label', `${ref.modelId}, ${subtitle || state.providers.find(p => p.id === ref.providerId)?.name}`);
      choice.onclick = () => { request('selectModel', {model:ref}); closePicker(); };
      const favorite = state.preferences.favorites.some(m => same(m, ref));
      const star = create('button', 'favorite-button' + (favorite ? ' active' : ''));star.append(choiceIcon('star'));
      star.dataset.focus = 'star:' + modelKey(ref) + ':' + subtitle; star.setAttribute('aria-pressed', String(favorite)); star.setAttribute('aria-label', `${favorite ? 'Desfavoritar' : 'Favoritar'} ${ref.modelId}`);
      star.onclick = () => request('favoriteModel', {model:ref, favorite:!favorite});
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
function renderState(next){window.VortexUI.setLanguage(next.preferences.conversation.uiLanguage);const previous=state.preferences.selected;state=next;if(previous&&!next.providers.some(p=>p.id===previous.providerId))notice('chat-notice','A conexão selecionada foi removida. Escolha outro modelo.');renderSelection();renderModels();if(!same(previous,state.preferences.selected))contextUsage=null;renderContext();const size=state.preferences.conversation.fontSize;if(size===null)document.documentElement.style.removeProperty('--vortex-chat-font-size');else document.documentElement.style.setProperty('--vortex-chat-font-size',size+'px');$('send').title=state.preferences.conversation.sendKey==='enter'?'Enviar mensagem (Enter)':'Enviar mensagem (Ctrl/Cmd+Enter)';autosize();}
function changeMode(){updatePermissions();modeChanging=true;request('applyMode',{mode:$('mode').value});updateBusy(busy);}
function submit(){if(busy||starting||modeChanging||clearing)return;const prompt=$('prompt').value.trim();if(!prompt)return;const model=state.preferences.selected;if(!model||!state.providers.some(p=>p.id===model.providerId)){notice('chat-notice','Selecione um modelo para enviar sua mensagem.');openPicker();return;}notice('chat-notice');starting=true;request('start',{prompt,model,mode:$('mode').value,permission:$('permission').value},{draft:$('prompt').value});updateBusy(false,'Enviando…');}
$('open-settings').onclick=()=>request('openSettings');$('connect-welcome').onclick=()=>request('openSettings');$('manage-models').onclick=()=>{closePicker();request('openSettings',{section:'models'});};
$('mode').onchange=changeMode;$('permission').onchange=persist;
$('model-trigger').onclick=()=>{$('model-picker').hidden?openPicker():closePicker();};$('close-picker').onclick=()=>closePicker();$('model-search').oninput=renderModels;
$('send').onclick=submit;$('stop').onclick=()=>{request('stop');$('stop').disabled=true;$('run-status').textContent='Interrompendo…';};
function returnHome(){if(busy||starting||clearing)return;closePicker(false);closeChoices();clearing=true;$('mode').value='ask';updatePermissions();request('clear',{mode:'ask'});loadSessions('');updateBusy(busy);}
$('new-task').onclick=returnHome;$('close-chat').onclick=returnHome;
$('prompt').oninput=()=>{persist();autosize();updateBusy(busy);};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&(state.preferences.conversation.sendKey==='enter'||e.ctrlKey||e.metaKey)){e.preventDefault();submit();}};
window.addEventListener('resize',autosize);
window.addEventListener('message',({data:m})=>{
 if(m.type==='state'){renderState(m.state);updateBusy(m.busy);return;}
 if(m.type==='history'){for(const [id,context]of pending)if(context.type==='clear')pending.delete(id);delete $('chat-heading').dataset.title;loadSessions('');if(m.events.length){$('timeline').replaceChildren();m.events.forEach(addEvent);}else welcome();if(clearing){clearing=false;$('prompt').value='';persist();autosize();notice('chat-notice');}updateBusy(m.busy,m.status);return;}
 if(m.type==='sessions'){if(m.requestId!==sessionQueryId)return;sessionRows=m.sessions;renderRecent();renderSessionResults();return;}
 if(m.type==='checklist'){renderChecklist(m.items);return;}
 if(m.type==='context'){if(m.model&&!same(m.model,state.preferences.selected))return;contextUsage={...m,model:m.model||state.preferences.selected};renderContext();return;}
 if(m.type==='sessionLoaded'){for(const [id,context]of pending)if(context.type==='loadSession')pending.delete(id);$('mode').value=m.mode;$('permission').value=m.permission;updatePermissions();if(!busy&&!same(state.preferences.selected,m.model)){if(state.providers.some(p=>p.id===m.model.providerId))request('selectModel',{model:m.model});else request('selectModel',{model:null});}return;}
 if(m.type==='event'){addEvent(m.event);return;}
 if(m.type==='status'){updateBusy(m.busy,m.text);return;}
 if(m.type==='accepted'){const context=pending.get(m.requestId);if(!context)return;starting=false;if($('prompt').value===context.draft){$('prompt').value='';persist();autosize();}updateBusy(true,'Trabalhando');return;}
 if(m.type==='runEnd'){loadSessions('');const context=pending.get(m.requestId);pending.delete(m.requestId);if(m.status==='error'&&context&&!$('prompt').value){$('prompt').value=context.draft;persist();autosize();notice('chat-notice','Não foi possível concluir a tarefa. Sua mensagem foi restaurada.',true);}updateBusy(false);return;}
 if(m.type==='result'){const context=pending.get(m.requestId);pending.delete(m.requestId);if(!context)return;if(context.type==='copyText'){context.copyButton.disabled=false;context.copyButton.title=window.VortexUI.t(m.ok?'Copied':'Copy failed');if(!m.ok)notice('chat-notice',m.message||window.VortexUI.t('Copy failed'),true);return;}if(context.type==='applyMode')modeChanging=false;if(context.type==='refreshAllModels')$('refresh-models').disabled=false;if(context.type==='deleteSession')loadSessions($('session-search').value);if(context.type==='clear')clearing=false;if(context.type==='start'){starting=false;notice('chat-notice',m.message||'Não foi possível enviar.',true);updateBusy(false,'Falha ao enviar');return;}if(!m.ok)notice('chat-notice',m.message||'Não foi possível concluir.',true);updateBusy(busy);}
});
$('prompt').value=saved.draft||'';$('mode').value=['ask','plan','agent'].includes(saved.mode)?saved.mode:'ask';$('permission').value=saved.permission==='autonomous'||saved.mode==='autonomous'?'autonomous':'supervised';updatePermissions();updateBusy(false);autosize();request('ready',saved.provider&&saved.model?{legacySelection:{providerId:saved.provider,modelId:saved.model}}:{});

function markdownBody(text,role){const el=create('div','message-body');if(role==='assistant')el.innerHTML=window.VortexMarkdown.render(text);else el.textContent=text;el.querySelectorAll('li').forEach(li=>{const first=li.firstChild;if(first?.nodeType===Node.TEXT_NODE&&/^\[[ xX]\] /.test(first.textContent)){const done=/^\[[xX]\]/.test(first.textContent);first.textContent=first.textContent.slice(4);const mark=create('span','markdown-task',done?'☑':'☐');mark.setAttribute('aria-label',done?'Completed':'Pending');li.prepend(mark);}});el.querySelectorAll('a').forEach(link=>{link.setAttribute('rel','noopener noreferrer');link.addEventListener('click',event=>{event.preventDefault();request('openLink',{url:link.href});});});return el;}
function choiceIcon(name){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');
 const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);svg.append(use);return svg;
}
function updateChoiceLabels(){
 const t=window.VortexUI.t,mode=$('mode').value,autonomous=$('permission').value==='autonomous';
 $('mode-trigger').replaceChildren(choiceIcon(mode),create('span','',t({ask:'Ask',plan:'Plan',agent:'Agent'}[mode])));
 $('permission-trigger').querySelector('use').setAttribute('href',autonomous?'#i-bolt':'#i-hand');
 $('permission-trigger').querySelector('span').textContent=t(autonomous?'Autonomous':'Supervised');
}
function showChoices(kind){
 const menu=$('choice-menu');menu.replaceChildren();const source=$(kind==='mode'?'mode':'permission'),trigger=$(kind+'-trigger'),readOnly=$('mode').value!=='agent';
 const rows=kind==='mode'?[['ask','ask','Ask','Answer questions without changing files.'],['plan','plan','Plan','Analyze and create an implementation checklist.'],['agent','agent','Agent','Explore and implement changes.']]:[['supervised','hand','Supervised','Ask before editing files and running commands.'],['autonomous','bolt','Autonomous','Edit automatically; commands require approval.']];
 for(const [value,icon,label,description]of rows){
  const b=create('button','choice-option');b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(source.value===value));
  const heading=create('strong');heading.append(choiceIcon(icon),document.createTextNode(' '+window.VortexUI.t(label)));
  b.append(heading,create('small','',window.VortexUI.t(kind==='permission'&&readOnly?'Applies in Agent. This mode only reads files.':description)));
  b.onclick=()=>{source.value=value;source.dispatchEvent(new Event('change'));closeChoices();updateChoiceLabels();};menu.append(b);
 }
 choicePicker.open(trigger);
}
function closeChoices(){choicePicker.close();}
$('mode-trigger').onclick=()=>showChoices('mode');$('permission-trigger').onclick=()=>showChoices('permission');
$('permission').addEventListener('change',updateChoiceLabels);
$('refresh-models').onclick=()=>{$('refresh-models').disabled=true;request('refreshAllModels');};
$('context-status').onclick=()=>request('openSettings',{section:'models'});
function renderChecklist(items){$('checklist').hidden=!items.length;$('checklist-items').replaceChildren();for(const item of items){const li=create('li',item.status);li.append(create('span','',item.status==='done'?'✓':item.status==='running'?'●':'○'),create('span','',item.text));$('checklist-items').append(li);}$('checklist-progress').textContent=items.filter(i=>i.status==='done').length+'/'+items.length;}

function loadSessions(query){sessionQueryId=request('listSessions',{query});}
function sessionRow(session,canDelete=false){const row=create('div','session-row');const b=create('button','session-title',session.title);b.onclick=()=>{request('loadSession',{id:session.id});if($('sessions-dialog').open)$('sessions-dialog').close();};row.append(b,sessionTime(session.updatedAt));if(canDelete){const remove=create('button','icon-button');remove.append(choiceIcon('trash'));remove.title='Delete session';remove.onclick=()=>{if(remove.dataset.confirm==='yes')request('deleteSession',{id:session.id});else{remove.classList.remove('icon-button');remove.dataset.confirm='yes';remove.textContent=window.VortexUI.language()==='pt'?'Excluir?':'Delete?';}};row.append(remove);}return row;}
function renderRecent(){const welcome=$('welcome');if(!welcome)return;let recent=$('recent-sessions');if(!recent){recent=create('section');recent.id='recent-sessions';recent.setAttribute('aria-label',window.VortexUI.t('Recent sessions'));welcome.prepend(recent);}recent.replaceChildren();for(const session of sessionRows.slice(0,5))recent.append(sessionRow(session));}
function renderSessionResults(){$('sessions-results').replaceChildren();for(const s of sessionRows)$('sessions-results').append(sessionRow(s,true));}
function openSessions(){loadSessions('');$('session-search').value='';if(!$('sessions-dialog').open)$('sessions-dialog').showModal();$('session-search').focus();}
$('history-button').onclick=openSessions;$('close-sessions').onclick=()=>$('sessions-dialog').close();$('session-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadSessions($('session-search').value),150);};
window.addEventListener('message',({data:m})=>{if(m.type==='state')updateChoiceLabels();});

function renderContext(){
 const ref=state.preferences.selected;
 if(!ref){$('context-status').textContent=window.VortexUI.t('Context');return;}
 const current=state.selectedContext;
 const budget=current&&same(current.model,ref)?current:null;
 if(!budget){$('context-status').textContent='…';return;}
 const used=contextUsage&&same(contextUsage.model,ref)?contextUsage.used:0;
 $('context-status').textContent=(used?'~':'')+used.toLocaleString()+' / '+budget.tokens.toLocaleString();
 $('context-status').title=window.VortexUI.language()==='pt'?`Uso estimado · orçamento ${budget.source} · ${contextUsage?.removed||0} mensagens antigas omitidas`:`Estimated usage · ${budget.source} budget · ${contextUsage?.removed||0} older messages omitted`;
}
function sessionTime(timestamp){
 const elapsed=Math.max(0,Date.now()-timestamp);const unit=elapsed<3600000?'minute':elapsed<86400000?'hour':'day';
 const amount=Math.max(0,Math.floor(elapsed/({minute:60000,hour:3600000,day:86400000}[unit])));
 const el=create('small','',new Intl.RelativeTimeFormat(window.VortexUI.language(),{numeric:'auto',style:'narrow'}).format(-amount,unit));el.title=new Date(timestamp).toLocaleString();return el;
}
