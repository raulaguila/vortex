import {createViewState} from './state';
import {setupPlan} from './plan';
import {setupDialogs} from './dialogs';
import {setupComposer, localizedAttribute} from './composer';
import {setupInteractions} from './interaction';
import {onHostMessage} from './messages';
import type {SettingsState} from "../src/ui/protocol";
export {};
const vscode=acquireVsCodeApi();
const $=(id:string):any=>document.getElementById(id);
const viewState=createViewState(vscode);
const saved=viewState.read();
const names={openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini',ollama:'Ollama',compatible:'OpenAI-compatible'};
let state:SettingsState={limits:{},providers:[],preferences:{context:{},selected:null,favorites:[],manualModels:[],defaults:{ask:null,plan:null,agent:null},conversation:{language:'auto',uiLanguage:'en',fontSize:null,sendKey:'enter'}}};
let sessionReadOnly=false;
let busy=false,starting=false,modeChanging=false,clearing=false,sequence=0;
const modelPicker=new window.ComposerPicker($('model-picker'),document.querySelector('.composer'));
const choicePicker=new window.ComposerPicker($('choice-menu'),document.querySelector('.composer'));
let contextUsage=null;
let sessionRows=[],sessionQueryId='',searchTimer;
const pending=new Map(),session='chat:'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const same=(a,b)=>!!a&&!!b&&a.providerId===b.providerId&&a.modelId===b.modelId;
const modelKey=m=>JSON.stringify([m.providerId,m.modelId]);
const create=(tag:string,className?:string,text?:any):any=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
const runProgress=create('div','run-progress');runProgress.id='run-progress';runProgress.hidden=true;
const progressSpinner=create('span','progress-spinner');progressSpinner.setAttribute('aria-hidden','true');
const progressLabel=create('span','progress-label');progressLabel.setAttribute('role','status');progressLabel.setAttribute('aria-live','polite');
runProgress.append(progressSpinner,progressLabel);
const progressBar=create('div','progress-bar');const progressFill=create('div','progress-fill');progressBar.append(progressFill);runProgress.append(progressBar);
$('timeline').after(runProgress);
const composerUI=setupComposer(()=>request('attachContext'),id=>request('removeContext',{id}));
setupInteractions(reply=>request('respondInteraction',reply),viewState);
setupDialogs(reply=>request('respondDialog',reply));
setupPlan((type,data)=>request(type,data));
let progressText='Preparing request',runTiming;const phaseLabels={validating_step:'Validating step',preparing:'Preparing request',context:'Preparing context',waiting_model:'Waiting for model',receiving:'Receiving response',compacting:'Summarizing context',approval:'Waiting for approval',question:'Waiting for your answer',summarizing:'Summarizing progress',finishing:'Finishing task',recovering:'Requesting a complete response'};
const progressTranslations={'Validating step':'Validando etapa','Summarizing progress':'Resumindo progresso','Requesting a complete response':'Solicitando uma resposta completa','Waiting for your answer':'Aguardando sua resposta','Reading editor context':'Lendo contexto do editor','Reading tool output':'Lendo resultados','Inspecting symbols':'Consultando símbolos','Reading skill':'Lendo instruções do projeto','Preparing request':'Preparando solicitação','Preparing context':'Preparando contexto','Waiting for model':'Aguardando o modelo','Receiving response':'Recebendo resposta','Summarizing context':'Resumindo contexto','Waiting for approval':'Aguardando sua aprovação','Listing files':'Listando arquivos','Reading file':'Lendo arquivo','Searching files':'Pesquisando arquivos','Checking diagnostics':'Verificando diagnósticos','Updating plan':'Atualizando plano','Writing file':'Gravando arquivo','Editing file':'Editando arquivo','Removing file':'Removendo arquivo','Running command':'Executando comando','Running tool':'Executando ferramenta','Finishing task':'Finalizando tarefa','Enviando…':'Enviando…','Interrompendo…':'Interrompendo…','Trabalhando':'Preparando solicitação'};
const toolLiveLabels={read_file:'Reading file',list_files:'Listing files',search_files:'Searching files',get_diagnostics:'Checking diagnostics',edit_file:'Editing file',edit_file_batch:'Editing file',write_file:'Writing file',delete_file:'Removing file',run_command:'Running command',propose_plan:'Updating plan',ask_user:'Waiting for your answer',read_tool_output:'Reading tool output',get_editor_context:'Reading editor context',query_symbols:'Inspecting symbols',get_project_skill:'Reading skill'};
function showProgress(active,text){
 if(active&&runTiming){text=phaseLabels[runTiming.phase]||(runTiming.tool?(toolLiveLabels[runTiming.tool.name]||'Running tool')+(runTiming.tool.path?' · '+runTiming.tool.path:''):'Running tool');}if(text)progressText=text;runProgress.hidden=!active;
 const [label,...detail]=progressText.split(' · '),pt=window.VortexUI.language()==='pt';
 const localized=pt?(progressTranslations[label]||label):({'Enviando…':'Sending…','Interrompendo…':'Stopping…','Trabalhando':'Preparing request'}[label]||label);
 progressLabel.textContent=[localized,...detail].join(' · ');progressLabel.title=progressLabel.textContent;
 runProgress.classList.toggle('awaiting-approval',label==='Waiting for approval'||label==='Waiting for your answer');
 const phasePct={preparing:10,context:20,waiting_model:30,receiving:50,validating_step:70,approval:80,question:80,summarizing:90,finishing:95,compacting:85,recovering:60};
 const pct=active&&runTiming?phasePct[runTiming.phase]??40:0;progressFill.style.width=pct+'%';
}
function request(type,data={},context={}){const requestId=session+':'+(++sequence);if(!['ready','stop','listSessions','openLink'].includes(type))pending.set(requestId,{type,...context});vscode.postMessage({type,requestId,...data});return requestId;}
function persist(){viewState.patch({draft:$('prompt').value,mode:$('mode').value,permission:$('permission').value,initialized:true});}
function notice(id,text='',error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function autosize(){$('prompt').style.height='auto';$('prompt').style.height=Math.min($('prompt').scrollHeight,220,window.innerHeight*.35)+'px';}
function updatePermissions(){$('permission').hidden=true;$('permission-trigger').hidden=false;$('read-only').hidden=true;updateChoiceLabels();persist();}
function updateBusy(value,text?:string){busy=value;showProgress(value||starting,text);if(text)$('run-status').textContent=value?progressLabel.textContent:text;$('send').hidden=value;$('stop').hidden=!value;$('stop').disabled=false;for(const id of ['mode','mode-trigger','permission','permission-trigger','model-trigger','new-task','close-chat'])$(id).disabled=value||starting||modeChanging||clearing;$('send').disabled=value||starting||modeChanging||clearing||!$('prompt').value.trim();$('prompt').readOnly=sessionReadOnly;if(sessionReadOnly)for(const id of ['send','mode-trigger','permission-trigger','model-trigger'])$(id).disabled=true;composerUI.refresh($('mode').value,value||starting,sessionReadOnly);}
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
   group.dataset.count=String(Number(group.dataset.count)+1);
   group.querySelector('summary').textContent=(window.VortexUI.language()==='pt'?'Trabalho realizado':'Work details')+' · '+group.dataset.count;
   const row=activityRow(event);
   const body=row.querySelector('.activity-card-body');if(body)body.hidden=false;
   group.append(row);
 }else{
   const item=create('article',event.role);if(event.interactionId){item.dataset.interactionId=event.interactionId;item.hidden=document.body.dataset.questionId===event.interactionId;}item.setAttribute('aria-label',event.role==='user'?window.VortexUI.t('You'):'Vortex');
   const bubble=create('div','message-content'),body=markdownBody(event.failureCode?window.VortexUI.failure(event.failureCode,event.text):event.text,event.role);bubble.append(body);
   const header=create('div','message-header');header.append(create('span','message-role',event.role==='user'?'Você':'Vortex'));item.append(header);
   if(event.role==='user'&&(event.text.length>600||event.text.split('\n').length>10)){
     body.classList.add('message-collapsed');const expand=create('button','expand-message',window.VortexUI.t('Show more'));expand.setAttribute('aria-expanded','false');expand.onclick=()=>{const collapsed=body.classList.toggle('message-collapsed');expand.textContent=window.VortexUI.t(collapsed?'Show more':'Show less');expand.setAttribute('aria-expanded',String(!collapsed));};bubble.append(expand);
   }
   item.append(bubble);const actions=create('div','message-actions');
   if(Number.isFinite(event.timestamp)){const time=create('time','message-time',new Date(event.timestamp).toLocaleTimeString(window.VortexUI.language(),{hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(event.timestamp).toISOString();time.title=new Date(event.timestamp).toLocaleString();actions.append(time);}
   const copy=messageAction('copy','Copy message',()=>{copy.disabled=true;request('copyText',{text:event.text},{copyButton:copy});});actions.append(copy);
   if(event.role==='user')actions.append(messageAction('edit','Reuse message',()=>{if(busy||starting)return;if($('prompt').value.trim()&&$('prompt').value!==event.text){notice('chat-notice',window.VortexUI.t('Clear the current draft before reusing a message.'));return;}$('prompt').value=event.text;persist();autosize();updateBusy(busy);$('prompt').focus();}));
   if(event.incomplete){item.classList.add('streaming','incomplete');item.append(create('p','partial-label',window.VortexUI.t('Incomplete response')));}item.append(actions);timeline.append(item);
 }
 if(follow||event.role==='user')timeline.scrollTop=timeline.scrollHeight;
}
function activityRow(event){
 const pt=window.VortexUI.language()==='pt',card=create('div','activity-card');
 const [raw,...legacyLines]=event.text.split('\n'),parts=raw.split(' · '),tool=event.activity?.name||parts[0],status=event.activity?.status||(['success','error','denied'].includes(parts.at(-1))?parts.pop():null),lines=event.activity?event.activity.output.split('\n'):legacyLines;
 const labels={modelValidation:['Model response rejected','Resposta do modelo rejeitada','ask'],edit_file_batch:['Edited file','Alterou arquivo','edit'],get_editor_context:['Read editor context','Leu contexto do editor','eye'],ask_user:['Asked for clarification','Solicitou esclarecimento','ask'],read_tool_output:['Read more output','Leu mais resultados','eye'],query_symbols:['Inspected symbols','Consultou símbolos','search'],get_project_skill:['Read project skill','Leu instruções do projeto','eye'],list_files:['Listed project files','Listou arquivos do projeto','plan'],read_file:['Read file','Leu arquivo','eye'],search_files:['Searched the project','Pesquisou no projeto','search'],get_diagnostics:['Checked diagnostics','Verificou diagnósticos','search'],propose_plan:['Updated the plan','Atualizou o plano','plan'],write_file:['Wrote file','Gravou arquivo','edit'],edit_file:['Edited file','Alterou arquivo','edit'],delete_file:['Removed file','Removeu arquivo','trash'],run_command:['Ran command','Executou comando','agent']};
 card.dataset.activityId=event.activity?.id||'';
 const known=labels[tool],header=create('div','activity-card-header'),copy=create('span','activity-description');header.append(choiceIcon(known?.[2]||'plan'));
 const label=status==='uncertain'?(pt?'Resultado precisa de revisão':'Outcome needs review'):status==='cancelled'?(pt?'Ação interrompida':'Action interrupted'):status==='recovered'?(pt?'Resposta corrigida':'Response corrected'):tool==='modelValidation'?known[pt?1:0]:status==='denied'?(pt?'Ação não autorizada':'Action declined'):status==='error'?(pt?'Falha na ação':'Action failed'):known?.[pt?1:0]||raw;
 copy.append(create('span','activity-label',label));
 const detail=known&&tool!=='modelValidation'?(event.activity?.path||parts.slice(1).join(' · ')||((status==='denied'||status==='error')?known[pt?1:0]:'')):'';
 if(detail)copy.append(create('span','activity-path',detail));header.append(copy);
 if(status==='error'||status==='denied'||status==='uncertain'){card.dataset.status=status;header.append(create('span','activity-result',status==='error'?'!':'−'));}
 if(Number.isFinite(event.durationMs)&&event.durationMs>=0){const seconds=event.durationMs/1000;header.append(create('span','activity-duration',(seconds<1?'<1':Math.round(seconds))+'s'));}
 card.append(header);
 const body=create('div','activity-card-body');body.hidden=true;
 if(tool==='list_files'&&status==='success'){
   const files=create('ul','activity-files');for(const line of lines.filter(Boolean)){const li=create('li');li.append(create('span','',line));files.append(li);}body.append(files);
 }else body.append(create('pre','',lines.join('\n')));
 if(event.activity?.truncated){
  body.append(create('p','',pt?'Exibindo parte do resultado.':'Showing part of the result.'));
  if(event.activity.sessionId&&event.activity.outputRef){
   const full=create('button','text-button',pt?'Ver resultado completo':'View full output');
   full.onclick=()=>request('openActivityOutput',{sessionId:event.activity.sessionId,activityId:event.activity.id});body.append(full);
  }else body.append(create('p','',pt?'O resultado completo não foi retido.':'Full output was not retained.'));
 }
 header.onclick=()=>{body.hidden=!body.hidden;};
 card.append(body);return card;
}
function welcome(){delete $('chat-heading').dataset.title;$('chat-heading').title='';contextUsage=null;renderContext();$('close-chat').hidden=true;$('chat-heading').querySelector('span').textContent=window.VortexUI.t('Chats');$('timeline').replaceChildren();const el=create('div','welcome');el.id='welcome';const img=create('img','empty-symbol');img.src=document.querySelector<HTMLImageElement>('.brand img').src;img.alt='Vortex';el.append(img);const suggestions=create('div','welcome-suggestions');suggestions.id='welcome-suggestions';el.append(suggestions);$('timeline').append(el);renderRecent();renderSuggestions();}
function renderSelection() {
  const ref = state.preferences.selected;
  const provider = state.providers.find(p => p.id === ref?.providerId);
  $('selected-model').textContent = provider && ref ? ref.modelId : 'Selecionar modelo';
  localizedAttribute($('model-trigger'),'title',provider && ref ? `${ref.modelId} · ${provider.name}` : 'Selecionar modelo');
  const connect = $('connect-welcome'); if(connect) connect.hidden = state.providers.length > 0;
  updateTaskContext();
}
function updateTaskContext() {
  const tc = $('task-context'); if(!tc) return;
  const mode = $('mode')?.value || 'ask';
  const ref = state.preferences.selected;
  const provider = state.providers.find(p => p.id === ref?.providerId);
  const modelName = provider && ref ? ref.modelId : '';
  if(!modelName && mode === 'ask') { tc.hidden = true; return; }
  tc.hidden = false;
  tc.replaceChildren();
  const modeBadge = create('span', 'task-mode');
  modeBadge.append(choiceIcon(mode), create('span', '', window.VortexUI.t({ask:'Ask',plan:'Plan',agent:'Agent'}[mode])));
  tc.append(modeBadge);
  if(modelName) { const modelSpan = create('span', 'task-model', modelName); tc.append(modelSpan); }
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
  const focus = container.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focus : undefined;
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
$('send').onclick=submit;$('stop').onclick=()=>{request('stop');$('stop').disabled=true;showProgress(true,'Interrompendo…');$('run-status').textContent=progressLabel.textContent;};
function returnHome(){if(busy||starting||clearing)return;closePicker(false);closeChoices();clearing=true;$('mode').value='ask';updatePermissions();request('clear',{mode:'ask'});loadSessions('');updateBusy(busy);}
$('new-task').onclick=returnHome;$('close-chat').onclick=returnHome;
$('prompt').oninput=()=>{persist();autosize();updateBusy(busy);};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&(state.preferences.conversation.sendKey==='enter'||e.ctrlKey||e.metaKey)){e.preventDefault();submit();}};
window.addEventListener('resize',autosize);
onHostMessage(m=>{
 if(m.type==='state'){renderState(m.state);updateBusy(m.busy);if($('welcome')&&!$('welcome').hidden)renderSuggestions();return;}
 if(m.type==='history'){for(const [id,context]of pending)if(context.type==='clear')pending.delete(id);delete $('chat-heading').dataset.title;loadSessions('');if(m.events.length){$('timeline').replaceChildren();m.events.forEach(addEvent);}else welcome();if(clearing){clearing=false;$('prompt').value='';persist();autosize();notice('chat-notice');}updateBusy(m.busy,m.status);return;}
 if(m.type==='sessions'){if(m.requestId!==sessionQueryId)return;sessionRows=m.offset?[...sessionRows,...m.sessions]:m.sessions;renderRecent();renderSessionResults();if(m.hasMore){const more=create('button','',window.VortexUI.language()==='pt'?'Carregar mais':'Load more');more.onclick=()=>{sessionQueryId=request('listSessions',{query:$('session-search').value,offset:sessionRows.length});};$('sessions-results').append(more);}return;}
 if(m.type==='checklist'){renderChecklist(m.items);return;}
 if(m.type==='usage'){if(same(m.model,state.preferences.selected)){contextUsage={model:m.model,used:m.input,reported:true,removed:contextUsage?.removed||0};renderContext();}return;}
 if(m.type==='context'){if(m.model&&!same(m.model,state.preferences.selected))return;contextUsage={...m,model:m.model||state.preferences.selected};renderContext();return;}
 if(m.type==='sessionLoaded'){for(const [id,context]of pending)if(context.type==='loadSession')pending.delete(id);$('mode').value=m.mode;$('permission').value=m.permission;updatePermissions();if(!busy&&!same(state.preferences.selected,m.model)){if(state.providers.some(p=>p.id===m.model.providerId))request('selectModel',{model:m.model});else request('selectModel',{model:null});}return;}
 if(m.type==='event'){addEvent(m.event);return;}
 if(m.type==='status'){updateBusy(m.busy,m.text);return;}
 if(m.type==='accepted'){const context=pending.get(m.requestId);if(!context)return;starting=false;if($('prompt').value===context.draft){$('prompt').value='';persist();autosize();}updateBusy(true,'Trabalhando');return;}
 if(m.type==='runEnd'){loadSessions('');const context=pending.get(m.requestId);pending.delete(m.requestId);if(m.status==='error'&&context?.draft&&!$('prompt').value){$('prompt').value=context.draft;persist();autosize();notice('chat-notice','Não foi possível concluir a tarefa. Sua mensagem foi restaurada.',true);}updateBusy(false);return;}
 if(m.type==='result'){const context=pending.get(m.requestId);pending.delete(m.requestId);if(!context)return;if(['respondInteraction','respondDialog','approvePlan','reviewStep','resumePlan','revisePlan','structureLegacyPlan'].includes(context.type))return;if(context.type==='copyText'){context.copyButton.disabled=false;context.copyButton.title=window.VortexUI.t(m.ok?'Copied':'Copy failed');if(!m.ok)notice('chat-notice',m.message||window.VortexUI.t('Copy failed'),true);return;}if(context.type==='applyMode')modeChanging=false;if(context.type==='refreshAllModels')$('refresh-models').disabled=false;if(context.type==='deleteSession')loadSessions($('sessions-dialog').open?$('session-search').value:'');if(context.type==='clear')clearing=false;if(context.type==='start'){starting=false;notice('chat-notice',m.message||'Não foi possível enviar.',true);updateBusy(false,'Falha ao enviar');return;}if(!m.ok)notice('chat-notice',m.message||'Não foi possível concluir.',true);updateBusy(busy);}
});
$('prompt').value=saved.draft||'';$('mode').value=['ask','plan','agent'].includes(saved.mode)?saved.mode:'ask';$('permission').value=saved.permission==='autonomous'||saved.mode==='autonomous'?'autonomous':'supervised';updatePermissions();updateBusy(false);autosize();request('ready',saved.provider&&saved.model?{legacySelection:{providerId:saved.provider,modelId:saved.model}}:{});

function markdownBody(text,role){const el=create('div','message-body');if(role==='assistant')el.innerHTML=window.VortexMarkdown.render(text);else el.textContent=text;el.querySelectorAll('li').forEach(li=>{const first=li.firstChild;if(first?.nodeType===Node.TEXT_NODE&&/^\[[ xX]\] /.test(first.textContent)){const done=/^\[[xX]\]/.test(first.textContent);first.textContent=first.textContent.slice(4);const mark=create('span','markdown-task',done?'☑':'☐');mark.setAttribute('aria-label',done?'Completed':'Pending');li.prepend(mark);}});el.querySelectorAll('a').forEach(link=>{link.setAttribute('rel','noopener noreferrer');link.addEventListener('click',event=>{event.preventDefault();request('openLink',{url:link.href});});});return el;}
function choiceIcon(name){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');
 const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);svg.append(use);return svg;
}
function updateChoiceLabels(){
 const t=window.VortexUI.t,mode=$('mode').value,autonomous=$('permission').value==='autonomous',readOnly=mode!=='agent';
 $('mode-trigger').replaceChildren(choiceIcon(mode),create('span','sr-only',t({ask:'Ask',plan:'Plan',agent:'Agent'}[mode])),choiceIcon('chevron'));
 $('permission-trigger').querySelector('use').setAttribute('href',readOnly?'#i-eye':autonomous?'#i-bolt':'#i-hand');
 $('permission-trigger').querySelector('span').className='sr-only';
 $('permission-trigger').querySelector('span').textContent=t(readOnly?'Read-only':autonomous?'Autonomous':'Supervised');
 localizedAttribute($('permission-trigger'),'title',readOnly?'Applies in Agent. This mode only reads files.':autonomous?'Edit automatically; isolated commands run automatically. Host and network access require approval.':'Ask before editing files and running commands.');
 const descriptions={ask:'Answer questions without changing files.',plan:'Analyze and create an implementation checklist.',agent:'Explore and implement changes.'};
 const modeLabel=t({ask:'Ask',plan:'Plan',agent:'Agent'}[mode]);
 localizedAttribute($('mode-trigger'),'title',modeLabel+' — '+t(descriptions[mode]));
 localizedAttribute($('mode-trigger'),'aria-label',modeLabel+' — '+t(descriptions[mode]));
 const permissionLabel=$('permission-trigger').querySelector('span').textContent;
 localizedAttribute($('permission-trigger'),'aria-label',permissionLabel+' — '+$('permission-trigger').title);
 $('mode-trigger').dataset.tooltip=$('mode-trigger').getAttribute('aria-label');$('permission-trigger').dataset.tooltip=$('permission-trigger').getAttribute('aria-label');
 composerUI.refresh(mode,busy||starting,sessionReadOnly);
 updateTaskContext();
}
function showChoices(kind){
 const menu=$('choice-menu');menu.replaceChildren();const source=$(kind==='mode'?'mode':'permission'),trigger=$(kind+'-trigger'),readOnly=$('mode').value!=='agent';
 const rows=kind==='mode'?[['ask','ask','Ask','Answer questions without changing files.'],['plan','plan','Plan','Analyze and create an implementation checklist.'],['agent','agent','Agent','Explore and implement changes.']]:[['supervised','hand','Supervised','Ask before editing files and running commands.'],['autonomous','bolt','Autonomous','Edit automatically; isolated commands run automatically. Host and network access require approval.']];
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
function renderChecklist(items){const implement=document.querySelector<HTMLElement>('[data-task-action=implementPlan]');if(implement)implement.hidden=!items.length;$('checklist').hidden=true;$('checklist-items').replaceChildren();for(const item of items){const li=create('li',item.status);li.append(create('span','',item.status==='completed'?'✓':item.status==='in_progress'?'●':'○'),create('span','',item.text));$('checklist-items').append(li);}$('checklist-progress').textContent=items.filter(i=>i.status==='completed').length+'/'+items.length;}

function loadSessions(query){sessionQueryId=request('listSessions',{query});}
function sessionRow(session,canDelete=false){const row=create('div','session-row');const b=create('button','session-title');b.append(create('span','session-name',session.title),sessionTime(session.updatedAt));b.onclick=()=>{request('loadSession',{id:session.id});if($('sessions-dialog').open)$('sessions-dialog').close();};row.append(b);if(canDelete){const remove=create('button','icon-button');remove.append(choiceIcon('trash'));remove.title=window.VortexUI.language()==='pt'?'Excluir sessão':'Delete session';remove.setAttribute('aria-label',remove.title+': '+session.title);remove.onclick=()=>{remove.disabled=true;request('deleteSession',{id:session.id});};row.append(remove);}return row;}
function renderRecent(){const welcome=$('welcome');if(!welcome)return;let recent=$('recent-sessions');if(!recent){recent=create('section');recent.id='recent-sessions';recent.setAttribute('aria-label',window.VortexUI.t('Recent sessions'));welcome.prepend(recent);}recent.replaceChildren();for(const session of sessionRows.slice(0,5))recent.append(sessionRow(session,true));}
function renderSuggestions(){const container=$('welcome-suggestions');if(!container)return;const pt=window.VortexUI.language()==='pt';const suggestions=pt?[{mode:'ask',label:'Perguntar',prompt:'Explique a arquitetura deste projeto'},{mode:'plan',label:'Planejar',prompt:'Crie um plano para adicionar testes'},{mode:'agent',label:'Agente',prompt:'Implemente uma validação de formulário'}]:[{mode:'ask',label:'Ask',prompt:'Explain the architecture of this project'},{mode:'plan',label:'Plan',prompt:'Create a plan to add tests'},{mode:'agent',label:'Agent',prompt:'Implement form validation'}];container.replaceChildren();for(const s of suggestions){const card=create('button','suggestion-card');card.append(create('strong','',s.label),document.createTextNode(s.prompt));card.onclick=()=>{$('mode').value=s.mode;$('mode').dispatchEvent(new Event('change'));$('prompt').value=s.prompt;autosize();updateBusy(busy);$('prompt').focus();};container.append(card);}}
function renderSessionResults(){$('sessions-results').replaceChildren();for(const s of sessionRows)$('sessions-results').append(sessionRow(s,true));}
function openSessions(){loadSessions('');$('session-search').value='';if(!$('sessions-dialog').open)$('sessions-dialog').showModal();$('session-search').focus();}
$('history-button').onclick=openSessions;$('close-sessions').onclick=()=>$('sessions-dialog').close();$('session-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadSessions($('session-search').value),150);};
onHostMessage(m=>{if(m.type==='state')updateChoiceLabels();});

function renderContext(){
 const button=$('context-status'),ref=state.preferences.selected,pt=window.VortexUI.language()==='pt';
 const label=pt?'Contexto':'Context';
 delete button.dataset.pressure;
 const budget=state.selectedContext&&same(state.selectedContext.model,ref)?state.selectedContext:null;
 if(!ref||!budget){button.textContent=label+(ref?': …':'');localizedAttribute(button,'aria-label',button.textContent);localizedAttribute(button,'title',pt?'Configurar janela de contexto':'Configure context window');return;}
 const usage=contextUsage&&same(contextUsage.model,ref)?contextUsage:null,used=usage?.used||0;
 const compact=new Intl.NumberFormat(pt?'pt-BR':'en',{notation:'compact',maximumFractionDigits:1});
 button.textContent=label+': '+(used&&!usage?.reported?'~':'')+compact.format(used)+' / '+compact.format(budget.tokens);
 const available=Math.max(1,budget.tokens-budget.output),nearLimit=used/available>=.85;
 if(nearLimit)button.dataset.pressure='high';
 localizedAttribute(button,'title',pt?`Janela configurada: ${budget.tokens} tokens\nEntrada ${usage?.reported?'reportada pela API (última requisição)':'estimada'}: ${used}\nReserva de saída: ${budget.output}\nOrigem: ${budget.source}\nMensagens omitidas: ${usage?.removed||0}${nearLimit?'\nPróximo do limite de entrada; o contexto é gerenciado automaticamente.':''}`:`Configured window: ${budget.tokens} tokens\n${usage?.reported?'API input (last request)':'Estimated input'}: ${used}\nOutput reserve: ${budget.output}\nSource: ${budget.source}\nOmitted messages: ${usage?.removed||0}${nearLimit?'\nNear the input limit; context is managed automatically.':''}`);
 localizedAttribute(button,'aria-label',button.textContent+(nearLimit?(pt?' — Próximo do limite':' — Near the limit'):''));
}

function sessionTime(timestamp){
 const elapsed=Math.max(0,Date.now()-timestamp);const unit=elapsed<3600000?'minute':elapsed<86400000?'hour':'day';
 const amount=Math.max(0,Math.floor(elapsed/({minute:60000,hour:3600000,day:86400000}[unit])));
 const el=create('small','',new Intl.RelativeTimeFormat(window.VortexUI.language(),{numeric:'auto',style:'narrow'}).format(-amount,unit));el.title=new Date(timestamp).toLocaleString();return el;
}

const liveStreams=new Map();
onHostMessage(m=>{
 if(m.type==='stream'){
  if(m.done){const row=liveStreams.get(m.id);if(row&&m.incomplete){row.element.classList.add('incomplete');row.element.append(create('p','partial-label',window.VortexUI.t('Incomplete response')));}else row?.element.remove();liveStreams.delete(m.id);return;}
  let row=liveStreams.get(m.id);if(!row){const element=create('article','assistant streaming');$('timeline').append(element);row={element,text:''};liveStreams.set(m.id,row);}
  const follow=$('timeline').scrollHeight-$('timeline').scrollTop-$('timeline').clientHeight<100;
  row.text+=m.text;row.element.replaceChildren(markdownBody(row.text,'assistant'));if(follow)$('timeline').scrollTop=$('timeline').scrollHeight;
 }
});

const taskActions=create('div','task-actions');
for(const [type,en,pt] of [['resume','Continue','Continuar'],['implementPlan','Implement plan','Implementar plano'],['reviewChanges','Review changes','Revisar alterações'],['undoChanges','Undo task changes','Desfazer alterações']]){
 const button=create('button','',window.VortexUI.language()==='pt'?pt:en);button.type='button';button.onclick=()=>request(type);if(type==='resume')button.title=window.VortexUI.language()==='pt'?'Retoma o trabalho salvo; primeiro verifica o workspace.':'Resumes saved work after checking the workspace.';button.dataset.taskAction=type;button.dataset.en=en;button.dataset.pt=pt;taskActions.append(button);
}
$('timeline').after(taskActions);
let availableTaskActions={};
onHostMessage(m=>{if(m.type==='taskState')availableTaskActions=m;if(['taskState','history','event','status','state'].includes(m.type)){let visible=false;taskActions.querySelectorAll('button').forEach(b=>{b.hidden=busy||sessionReadOnly||!availableTaskActions[b.dataset.taskAction];if(!b.hidden)visible=true;b.disabled=busy;b.textContent=b.dataset[window.VortexUI.language()==='pt'?'pt':'en'];});taskActions.hidden=!visible;}});
taskActions.hidden=true;

onHostMessage(m=>{if(m.type==='attachments')composerUI.attachments(m.items);});

const progressTime=create('span','progress-time');progressTime.setAttribute('aria-hidden','true');runProgress.append(progressTime);
setInterval(()=>{if(runTiming&&!runProgress.hidden)progressTime.textContent=Math.max(0,Math.floor((Date.now()-runTiming.phaseStartedAt)/1000))+' s';},1000);
const jump=create('button','jump-latest','Go to latest');jump.hidden=true;$('timeline').after(jump);
const updateJump=()=>{jump.hidden=$('timeline').scrollHeight-$('timeline').scrollTop-$('timeline').clientHeight<100;};$('timeline').addEventListener('scroll',updateJump);jump.onclick=()=>{$('timeline').scrollTop=$('timeline').scrollHeight;updateJump();};new MutationObserver(updateJump).observe($('timeline'),{childList:true,subtree:true});
const recovery=create('div','recovery-actions');recovery.hidden=true;runProgress.after(recovery);
onHostMessage(m=>{
 if(m.type==='history'&&!m.busy){recovery.hidden=true;runTiming=undefined;}
 if(m.type==='runProgress'){runTiming=m.progress;progressTime.textContent='0 s';showProgress(true,m.progress.phase);}
 if(m.type==='accepted'){runTiming=undefined;recovery.replaceChildren();recovery.hidden=true;}
 if(m.type==='runFailure'){
  recovery.replaceChildren();recovery.hidden=false;
  const add=(label,type,data?:Record<string,unknown>)=>{const b=create('button','',window.VortexUI.t(label));b.onclick=()=>{request(type,data||{});if(type==='retry')recovery.hidden=true;};recovery.append(b);};
  if(m.code==='uncertain_outcome'){add('Review changes','reviewChanges');add('Undo task changes','undoChanges');}if(m.retryable)add('Try again','retry');if(m.code==='tool_validation')add('Open settings','openSettings',{section:'models'});if(['authentication','provider','first_response_timeout','idle_timeout'].includes(m.code))add('Open settings','openSettings',{section:m.code==='authentication'?'providers':'execution'});add('View diagnostics','openSettings',{section:'diagnostics'});
 }
});

let liveCommand;
onHostMessage(m=>{
 if(m.type==='activityUpdate'){const row=document.querySelector<HTMLElement>('[data-activity-id="'+CSS.escape(m.activity.id)+'"]');if(row){const next=activityRow({role:'activity',text:'',activity:m.activity}) as HTMLElement;const prevBody=row.querySelector<HTMLElement>('.activity-card-body');const nextBody=next.querySelector<HTMLElement>('.activity-card-body');if(nextBody&&prevBody)nextBody.hidden=prevBody.hidden;row.replaceWith(next);}}
 if(m.type==='commandOutput'&&(busy||starting)&&runTiming?.runId===m.runId){
  if(!liveCommand||liveCommand.dataset.id!==m.id){liveCommand?.remove();liveCommand=create('details','live-command');liveCommand.dataset.id=m.id;liveCommand.append(create('summary','',window.VortexUI.language()==='pt'?'Saída do comando':'Command output'),create('pre'));runProgress.after(liveCommand);}
  const pre=liveCommand.querySelector('pre');pre.textContent=(pre.textContent+m.text).slice(-32768);if(liveCommand.open)pre.scrollTop=pre.scrollHeight;
 }
 if(m.type==='runEnd'||m.type==='accepted'||m.type==='history'||m.type==='toolProgress'&&['success','error','denied','cancelled','uncertain'].includes(m.status)){liveCommand?.remove();liveCommand=undefined;}
});

onHostMessage(m=>{if(m.type==='sessionLoaded')sessionReadOnly=!!m.readOnly;else if(m.type==='accepted'||m.type==='history'&&!m.events.length)sessionReadOnly=false;else return;updateBusy(busy);$('prompt').readOnly=sessionReadOnly;if(sessionReadOnly)for(const id of ['send','mode-trigger','permission-trigger','model-trigger'])$(id).disabled=true;});

const persistenceWarning=create('div','notice error');persistenceWarning.setAttribute('role','alert');persistenceWarning.hidden=true;$('timeline').before(persistenceWarning);
onHostMessage(m=>{if(m.type==='persistenceState'){persistenceWarning.hidden=!m.failed;persistenceWarning.textContent=window.VortexUI.language()==='pt'?'Não foi possível salvar o progresso. Verifique o armazenamento antes de continuar.':'Progress could not be saved. Check storage before continuing.';}});
