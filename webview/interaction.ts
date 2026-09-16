import type {Interaction,InteractionReply} from "../src/ui/protocol";
import {onHostMessage} from './messages';
import type {ViewState} from './state';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string)=>{
 const el=document.createElement(tag);el.className=className;if(text!==undefined)el.textContent=text;return el;
};
const text=(en:string,pt:string)=>window.VortexUI.language()==='pt'?pt:en;
export function setupInteractions(send:(reply:InteractionReply)=>string, state:ViewState){
 const card=element('section','interaction-card');card.id='interaction-card';card.hidden=true;card.setAttribute('aria-labelledby','interaction-heading');
 document.querySelector('footer')!.before(card);
 const composer=document.querySelector<HTMLElement>('.composer')!;
 let current:Interaction|null=null,language='',pendingId='',answer='',selectedOption:string|null=null,chosen=new Set<number>();
 const saveAnswer=()=>state.patch({questionDraft:current?.kind==='question'?{id:current.id,answer,selectedOption}:null});
 const syncTranscript=()=>document.querySelectorAll<HTMLElement>('[data-interaction-id]').forEach(row=>{row.hidden=row.dataset.interactionId===document.body.dataset.questionId;});
 let updateControls=()=>{};
 function render(next:Interaction|null){
  const focused=card.contains(document.activeElement)?document.activeElement as HTMLElement:null;
  const focusId=focused?.id,focusOption=focused?.dataset.option;
  const selection=focused instanceof HTMLTextAreaElement?[focused.selectionStart,focused.selectionEnd]:null;
  const fresh=current?.id!==next?.id,hadFocus=card.contains(document.activeElement);current=next;
  if(!next){card.hidden=true;card.replaceChildren();answer='';selectedOption=null;pendingId='';delete composer.dataset.question;delete document.body.dataset.questionId;saveAnswer();syncTranscript();document.querySelector('footer')!.before(card);if(hadFocus)document.getElementById('prompt')?.focus();return;}
  if(fresh){const saved=state.read().questionDraft;answer=saved?.id===next.id&&typeof saved.answer==='string'?saved.answer:'';selectedOption=next.kind==='question'&&saved?.id===next.id&&next.options?.includes(saved.selectedOption)?saved.selectedOption:null;chosen=new Set(next.kind==='approval'?next.hunks?.map((_,i)=>i):[]);pendingId='';document.dispatchEvent(new CustomEvent('vortex:overlay-open',{detail:'interaction'}));}
  if(next.kind==='question'){composer.dataset.question='true';document.body.dataset.questionId=next.id;composer.prepend(card);}else{delete composer.dataset.question;delete document.body.dataset.questionId;document.querySelector('footer')!.before(card);}syncTranscript();
  language=window.VortexUI.language();card.hidden=false;card.replaceChildren();card.dataset.kind=next.kind;card.dataset.id=next.id;
  if(next.kind==='approval')card.dataset.operation=next.operation;else delete card.dataset.operation;
  const heading=element('h2','',next.kind==='question'?text('Vortex needs your answer','Vortex precisa da sua resposta'):text('Approve this action?','Aprovar esta ação?'));
  heading.id='interaction-heading';heading.tabIndex=-1;card.append(heading);
  const form=element('form'),body=element('div','interaction-body'),actions=element('div','interaction-actions'),error=element('p','interaction-error');error.id='interaction-error';error.setAttribute('role','alert');error.hidden=true;
  const primary=element('button','interaction-primary'),reject=element('button','interaction-reject',next.kind==='question'?text('Cancel task','Cancelar tarefa'):text('Reject','Rejeitar'));
  primary.id='interaction-approve';primary.type='submit';reject.id='interaction-reject';reject.type='button';
  reject.title=text('Decline and stop this task','Recusar e interromper esta tarefa');
  const controls:HTMLButtonElement[]=[primary,reject];
  const respond=(reply:InteractionReply)=>{if(pendingId)return;error.hidden=true;pendingId=send(reply);updateControls();};
  reject.onclick=()=>respond({id:next.id,decision:'reject'});
  let submit:()=>void;
  if(next.kind==='question'){
   body.append(element('p','interaction-data interaction-question',next.question));
   const input=element('textarea');input.id='interaction-answer';input.rows=2;input.maxLength=4000;input.value=answer;input.placeholder=text('Write your answer…','Escreva sua resposta…');
   const label=element('label','sr-only',text('Your answer','Sua resposta'));label.htmlFor=input.id;
   const options=element('div','interaction-options');options.setAttribute('role','radiogroup');options.setAttribute('aria-label',text('Suggested answers','Respostas sugeridas'));
   for(const option of next.options||[]){
    const button=element('button','interaction-option interaction-data');button.type='button';button.setAttribute('role','radio');button.dataset.option=option;
    const radio=element('span','interaction-radio');radio.setAttribute('aria-hidden','true');button.append(radio,element('span','interaction-option-label',option));
    if(option===next.recommended_option)button.append(element('small','interaction-recommended',text('Recommended','Recomendado')));
    button.onclick=()=>{selectedOption=option;answer='';input.value='';saveAnswer();updateControls();};options.append(button);controls.push(button);
   }
   if(next.options?.length){body.append(options,element('div','interaction-divider',text('or write','ou escreva')));}
   options.onkeydown=e=>{if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const rows=[...options.querySelectorAll<HTMLButtonElement>('button')],at=rows.indexOf(document.activeElement as HTMLButtonElement);const index=e.key==='Home'?0:e.key==='End'?rows.length-1:(at+(['ArrowUp','ArrowLeft'].includes(e.key)?rows.length-1:1))%rows.length;rows[index]?.focus();rows[index]?.click();};
   body.append(label,input);primary.textContent=text('Reply','Responder');
   updateControls=()=>{controls.forEach(b=>b.disabled=!!pendingId);input.disabled=!!pendingId;primary.disabled=!!pendingId||!(selectedOption||answer.trim());options.querySelectorAll<HTMLButtonElement>('button').forEach((b,i)=>{b.setAttribute('aria-checked',String(b.dataset.option===selectedOption));b.tabIndex=b.dataset.option===selectedOption||!selectedOption&&i===0?0:-1;});};
   input.oninput=()=>{answer=input.value;selectedOption=null;saveAnswer();updateControls();};
   submit=()=>{const value=selectedOption||answer.trim();if(value)respond({id:next.id,decision:'answer',answer:value});};
   input.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit();}};
  }else{
   const operations={create:['Create file','Criar arquivo'],edit:['Edit file','Editar arquivo'],delete:['Delete file','Excluir arquivo'],command:['Run on your computer','Executar no seu computador'],network:['Allow sandbox network access','Permitir rede no ambiente isolado']};
   const [en,pt]=operations[next.operation];body.append(element('p','interaction-operation',text(en,pt)));
   if(next.path)body.append(element('code','interaction-data interaction-path',next.path));
   if(next.detail)body.append(element('pre','interaction-data interaction-detail',next.detail));
   if(next.hunks?.length){
    const details=element('details','interaction-hunks');details.append(element('summary','',text('Select changes','Selecionar alterações')));
    next.hunks.forEach((h,i)=>{
     const row=element('label','interaction-hunk'),check=element('input');check.type='checkbox';check.checked=chosen.has(i);check.value=String(i);
     const title=element('span','',text('Lines ','Linhas ')+h.label);row.append(check,title,element('pre','interaction-data',h.diff));
     check.onchange=()=>{check.checked?chosen.add(i):chosen.delete(i);updateControls();};details.append(row);
    });body.append(details);
   }
   if(next.preview){const preview=element('button','interaction-preview',text('View diff','Ver diff'));preview.id='interaction-preview';preview.type='button';preview.onclick=()=>respond({id:next.id,decision:'preview'});actions.append(preview);controls.push(preview);}
   const partialNote=element('p','interaction-partial',text('Unselected changes will be rejected and the task paused.','As alterações não selecionadas serão rejeitadas e a tarefa será pausada.'));partialNote.hidden=true;body.append(partialNote);
   updateControls=()=>{
    const partial=!!next.hunks?.length&&chosen.size!==next.hunks.length;
    partialNote.hidden=!partial;
    primary.textContent=partial?text('Apply selected','Aplicar selecionadas'):text('Approve','Aprovar');
    controls.forEach(b=>b.disabled=!!pendingId);primary.disabled=!!pendingId||!!next.hunks?.length&&!chosen.size;
    body.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.disabled=!!pendingId);
   };
   submit=()=>respond({id:next.id,decision:'approve',...(next.hunks?.length&&chosen.size!==next.hunks.length?{hunks:[...chosen]}:{})});
  }
  form.onsubmit=e=>{e.preventDefault();if(!primary.disabled)submit();};
  actions.append(reject,primary);form.append(body,error,actions);card.append(form);updateControls();
  // Move focus to a heading, never to an approval button. Enter cannot approve accidentally.
  if(fresh)heading.focus({preventScroll:true});
  else if(focused){const target=focusId?document.getElementById(focusId):[...card.querySelectorAll<HTMLElement>('[data-option]')].find(b=>b.dataset.option===focusOption);target?.focus({preventScroll:true});if(selection&&target instanceof HTMLTextAreaElement)target.setSelectionRange(selection[0],selection[1]);}
 }
 onHostMessage(m=>{
  if(m.type==='interaction'){if(m.interaction?.id!==current?.id||!m.interaction)render(m.interaction);}
  if(m.type==='state'&&current&&language!==m.state.preferences.conversation.uiLanguage)queueMicrotask(()=>{if(current)render(current);});
  if(m.type==='runEnd'&&current?.runId===m.requestId)render(null);
  if(m.type==='result'&&m.requestId===pendingId){pendingId='';updateControls();if(!m.ok){const error=card.querySelector<HTMLElement>('.interaction-error');if(error){error.textContent=m.message||text('Could not send. Try again.','Não foi possível enviar. Tente novamente.');error.hidden=false;}}}
 });
 // History may arrive after the pending question snapshot on a webview reload.
 new MutationObserver(syncTranscript).observe(document.getElementById('timeline')!,{childList:true});
}
