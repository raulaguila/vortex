import type {DialogReply,DialogSpec} from '../src/protocol';
import {onHostMessage} from './messages';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
export function setupDialogs(send:(reply:DialogReply)=>string){
 const dialog=el('dialog','vortex-dialog');dialog.id='vortex-dialog';dialog.setAttribute('aria-labelledby','vortex-dialog-title');document.body.append(dialog);
 let current:DialogSpec|null=null,pending='',restore:HTMLElement|null=null;
 const t=(value:string)=>window.VortexUI.t(value);
 const respond=(value:string|null)=>{if(!current||pending)return;pending=send({id:current.id,value});dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);};
 dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();respond(null);});
 dialog.addEventListener('keydown',event=>{event.stopPropagation();});
 function render(spec:DialogSpec|null){
  if(spec&&current?.id===spec.id)return;
  current=spec;pending='';
  if(!spec){if(dialog.open)dialog.close();dialog.replaceChildren();if(restore?.isConnected)restore.focus({preventScroll:true});restore=null;return;}
  if(!dialog.open)restore=document.activeElement as HTMLElement;
  dialog.replaceChildren();dialog.dataset.kind=spec.kind;
  const title=el('h2','',t(spec.title));title.id='vortex-dialog-title';title.tabIndex=-1;
  const body=el('div','vortex-dialog-body'),actions=el('div','vortex-dialog-actions');dialog.append(title,body);
  if(spec.detail)body.append(el('p','vortex-dialog-detail',t(spec.detail)));
  const error=el('p','vortex-dialog-error');error.id='vortex-dialog-error';error.setAttribute('role','alert');error.hidden=true;
  let input:HTMLInputElement|undefined;
  if(spec.kind==='pick'){
   input=el('input');input.type='search';input.placeholder=t('Search');input.setAttribute('aria-label',t('Search'));input.id='vortex-dialog-search';body.append(input);
   const list=el('div','vortex-dialog-list');list.setAttribute('role','group');list.setAttribute('aria-label',t(spec.title));body.append(list);
   const filter=()=>{list.replaceChildren();for(const item of spec.choices||[]){if(!`${item.label} ${item.description||''}`.toLocaleLowerCase().includes(input!.value.toLocaleLowerCase()))continue;
    const button=el('button','vortex-dialog-choice');button.type='button';button.dataset.choice=item.id;
    button.append(el('span','dialog-data',t(item.label)));if(item.description)button.append(el('small','dialog-data',t(item.description)));
    button.onclick=()=>respond(item.id);list.append(button);
   }if(!list.childElementCount)list.append(el('p','',t('No results.')));};input.oninput=filter;filter();
   input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();list.querySelector('button')?.focus();}};
   list.onkeydown=e=>{const rows=[...list.querySelectorAll('button')],i=rows.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();rows[Math.max(0,Math.min(rows.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus();}};
  }
  if(spec.kind==='input'){
   const form=el('form');form.id='vortex-dialog-form';input=el('input');input.id='vortex-dialog-input';input.value=spec.value||'';input.maxLength=4096;input.setAttribute('aria-label',t(spec.title));input.autocomplete='off';input.spellcheck=false;
   form.append(input);body.append(form);form.onsubmit=e=>{e.preventDefault();if(input!.value.trim())respond(input!.value.trim());};
  }
  if(spec.kind==='progress'){const progress=el('progress');progress.setAttribute('aria-label',t(spec.title));body.append(progress);}
  if(spec.kind!=='notice'){const cancel=el('button','',t('Cancel'));cancel.id='vortex-dialog-cancel';cancel.type='button';cancel.onclick=()=>respond(null);actions.append(cancel);}
  if(['confirm','input','notice'].includes(spec.kind)){
   const accept=el('button','vortex-dialog-primary',t(spec.accept||'Confirm'));accept.id='vortex-dialog-accept';accept.type='button';
   accept.onclick=()=>{if(spec.kind!=='input')respond('accept');else if(input?.value.trim())respond(input.value.trim());};actions.append(accept);
  }
  dialog.append(error,actions);if(!dialog.open)dialog.showModal();
  if(input)input.focus();else title.focus();
 }
 onHostMessage(message=>{
  if(message.type==='dialog')render(message.dialog);
  if(message.type==='result'&&message.requestId===pending){pending='';dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);if(!message.ok){const error=dialog.querySelector<HTMLElement>('#vortex-dialog-error');if(error){error.hidden=false;error.textContent=t(message.message||'Could not complete the operation.');}}}
 });
}
