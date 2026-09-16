import type {PlanState} from '../src/plan';
import {onHostMessage} from './messages';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text?:string)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const reasons:Record<string,string>={"Human review required.": "Revisão humana necessária.", "Workspace correspondence could not be verified automatically.": "Não foi possível verificar automaticamente a correspondência do workspace.", "No matching command evidence from this attempt.": "Não há evidência do comando previsto nesta tentativa.", "The verification failed or was interrupted.": "A verificação falhou ou foi interrompida.", "Workspace changed after verification. Run the check again.": "O workspace mudou após a verificação. Execute-a novamente.", "A later verification failed.": "Uma verificação posterior falhou.", "Approved command exited successfully on the current workspace snapshot.": "O comando previsto terminou com sucesso no estado atual do workspace.", "Referenced evidence includes a failed or uncertain operation.": "As evidências citadas incluem uma operação com falha ou resultado incerto."};
const icon=(name:string,cls='')=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add(cls||'plan-icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#i-'+name);svg.append(use);return svg;};
const tr=(en:string,pt:string)=>window.VortexUI.language()==='pt'?pt:en;
export function setupPlan(send:(type:string,data:Record<string,unknown>)=>string){
 const panel=node('section','plan-panel');panel.id='plan-panel';panel.hidden=true;panel.setAttribute('aria-label',tr('Implementation plan','Plano de implementação'));document.getElementById('checklist')!.before(panel);
 let plan:PlanState|null=null,sessionId='',busy=false,readOnly=false,pending='',comment='',revising=false,legacy=false,errorText='',key='';
 const open=new Set<string>();
 let expanded=false,legacyItems:{id:string;text:string;status:string}[]=[];
 const toggle=node('button','plan-toggle');toggle.id='plan-toggle';toggle.type='button';toggle.setAttribute('aria-controls','plan-popover');
 const content=node('div','plan-popover');content.id='plan-popover';content.hidden=true;content.setAttribute('role','region');
 panel.append(toggle,content);
 function position(){
  if(!expanded)return;
  const top=panel.getBoundingClientRect().bottom;
  const bottom=document.querySelector('.composer')!.getBoundingClientRect().top;
  content.style.maxHeight=Math.max(0,Math.min(innerHeight*.45,bottom-top-8))+'px';
 }
 function collapse(focus=false){expanded=false;content.hidden=true;toggle.setAttribute('aria-expanded','false');panel.dataset.expanded='false';if(focus)toggle.focus({preventScroll:true});}
 toggle.onclick=()=>{if(expanded){collapse();return;}document.dispatchEvent(new CustomEvent('vortex:overlay-open',{detail:'plan'}));expanded=true;content.hidden=false;toggle.setAttribute('aria-expanded','true');panel.dataset.expanded='true';position();};
 document.addEventListener('vortex:overlay-open',event=>{if((event as CustomEvent).detail!=='plan')collapse(panel.contains(document.activeElement));});
 document.addEventListener('pointerdown',event=>{if(expanded&&!panel.contains(event.target as Node))collapse();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();collapse(true);}});
 window.addEventListener('resize',position);new ResizeObserver(position).observe(document.querySelector('footer')!);
 function bar(){
  const complete=plan?.executions.filter(e=>e.status==='completed').length??legacyItems.filter(i=>i.status==='completed').length;
  const count=plan?.steps.length??legacyItems.length;
  toggle.replaceChildren(icon('plan','plan-toggle-icon'),node('span','',tr('Plan','Plano')),node('span','plan-count',`${complete}/${count}`));
  const active=plan?.executions.find(e=>e.id===plan.active_step);
  const wait=active?.attempts.at(-1)?.wait_reason;
  const label=plan?.status==='proposed'?tr('Review plan','Revisar plano'):wait==='review'?tr('Manual review','Revisão manual'):wait==='approval'?tr('Tool permission','Permissão da ação'):wait==='question'?tr('Question','Pergunta'):plan?.status==='paused'?tr('Paused','Pausado'):active?.status==='validating'?tr('Verifying','Verificando'):active?.attempts.at(-1)?.correcting?tr('Correcting','Corrigindo'):active?.status==='running'?tr('Running','Executando'):plan?.status==='completed'?tr('Completed','Concluído'):'';
  if(label)toggle.append(node('span','plan-badge',label));
  const chevron=icon('chevron','plan-chevron');chevron.setAttribute('aria-hidden','true');toggle.append(chevron);
  toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',tr('Implementation plan','Plano de implementação')+` · ${complete}/${count}`+(label?' · '+label:''));
  content.setAttribute('aria-label',tr('Plan details','Detalhes do plano'));content.hidden=!expanded;
 }

 function request(type:string,data:Record<string,unknown>={}){if(pending)return;errorText='';pending=send(type,{sessionId,planId:plan?.plan_id,version:plan?.version,...data});render();}
 function button(text:string,id:string,action:()=>void){const b=node('button','',text);b.id=id;b.type='button';b.disabled=busy||readOnly||!!pending;b.onclick=action;return b;}
 function render(){
  const scroll=content.scrollTop;
  const focused=panel.contains(document.activeElement)?document.activeElement as HTMLElement:null;const focusId=focused?.id;const selection=focused instanceof HTMLTextAreaElement?[focused.selectionStart,focused.selectionEnd]:null;
  panel.hidden=!plan&&!legacy;content.replaceChildren();bar();if(panel.hidden){collapse();return;}
  if(!plan){content.append(node('p','',tr('Legacy checklist — results were not verified by Vortex.','Checklist antigo — resultados não verificados pelo Vortex.')),button(tr('Generate executable plan','Gerar plano executável'),'plan-legacy',()=>request('structureLegacyPlan')));for(const item of legacyItems)content.append(node('p','plan-data',`${item.status==='completed'?'✓':'○'} ${item.text}`));position();return;}
  const current=plan.executions.find(e=>e.id===plan!.active_step),attempt=current?.attempts.at(-1),step=plan.steps.find(s=>s.id===plan!.active_step);
  const header=node('div','plan-heading');header.append(node('strong','plan-data',plan.objective),node('span','',`${plan.executions.filter(e=>e.status==='completed').length}/${plan.steps.length} · v${plan.version}`));content.append(header);
  const statuses:Record<string,[string,string]>={pending:['Pending','Pendente'],running:['Running','Executando'],validating:['Validating','Validando'],completed:['Completed','Concluído'],waiting_user:['Waiting for you','Aguardando você'],blocked:['Blocked','Bloqueado'],failed:['Failed','Falhou'],interrupted:['Interrupted','Interrompido']};
  if(attempt?.wait_reason)content.append(node('p','plan-policy',attempt.wait_reason==='question'?tr('Waiting for your answer','Aguardando sua resposta'):attempt.wait_reason==='approval'?tr('Waiting for tool approval','Aguardando aprovação da ferramenta'):tr('Manual result review — the plan is already approved. Inspect the evidence before confirming.','Revisão manual do resultado — o plano já foi aprovado. Confira as evidências antes de confirmar.')));
  if(step)content.append(node('p','plan-current',tr(`Step ${plan.steps.indexOf(step)+1} of ${plan.steps.length}`,`Etapa ${plan.steps.indexOf(step)+1} de ${plan.steps.length}`)+' · '+step.title));
  const list=node('div','plan-steps');
  for(const definition of plan.steps){const execution=plan.executions.find(e=>e.id===definition.id)!,latest=execution.attempts.at(-1),details=node('details','plan-step');details.dataset.step=definition.id;details.dataset.status=execution.status;details.open=open.has(definition.id);details.ontoggle=()=>{if(!details.isConnected)return;details.open?open.add(definition.id):open.delete(definition.id);};
   const summary=node('summary');summary.id='plan-step-'+definition.id;const mark=node('span','plan-state-icon',execution.status==='completed'?'✓':['running','validating'].includes(execution.status)?'◌':['failed','blocked','interrupted'].includes(execution.status)?'!':'○');mark.setAttribute('aria-hidden','true');summary.append(mark,node('span','plan-data',definition.title),node('small',execution.id===plan.active_step?'':'sr-only',tr(...statuses[execution.status])));summary.setAttribute('aria-label',definition.title+' — '+tr(...statuses[execution.status]));details.append(summary,node('p','plan-data',definition.objective));
   const scope=plan.authorization?.steps.find(s=>s.step_id===definition.id);if(scope){const grants=node('div','plan-data');grants.append(node('strong','',tr('Authorized scope','Escopo autorizado')));for(const f of scope.files)grants.append(node('p','',`${tr(f.operation,f.operation==='create'?'criar':f.operation==='edit'?'editar':'excluir')} · ${f.path}`));for(const c of scope.commands)grants.append(node('p','',`${c.execution_location==='host'?tr('Computer','Computador'):tr('Sandbox','Sandbox')} · ${c.cwd} · ${c.command}${c.request_network?tr(' · network',' · rede'):''}`));details.append(grants);}
   if(definition.depends_on.length)details.append(node('small','plan-data',tr('Depends on: ','Depende de: ')+definition.depends_on.join(', ')));
   const criteria=node('ul');for(const c of definition.criteria){const result=latest?.criteria.find(r=>r.id===c.id),item=node('li','plan-data',c.description);item.append(node('small','',result?.status==='verified'?tr('Command verified','Comando verificado'):latest?.decision?.action==='confirm'&&result?.status==='review'?tr('Confirmed by you','Confirmado por você'):c.verification==='human'?tr('Human review','Revisão humana'):tr('Command check','Verificação por comando')));if(c.command)item.append(node('code','plan-data',`${c.cwd}: ${c.command}`));if(result)item.append(node('p','plan-data',window.VortexUI.language()==='pt'?(reasons[result.reason]||result.reason):result.reason));criteria.append(item);}details.append(criteria);
   if(latest?.summary)details.append(node('p','plan-data',latest.summary));
   if(latest?.evidence.length){const evidence=node('details');evidence.append(node('summary','',tr('Evidence and changes','Evidências e alterações')));for(const e of latest.evidence){const row=node('div','plan-evidence');row.append(node('code','plan-data',e.tool+(e.path?' · '+e.path:'')),node('small','',e.status));if(e.command)row.append(node('pre','plan-data',e.command.output.slice(0,4000)));evidence.append(row);}details.append(evidence);}list.append(details);
  }content.append(list);
  const actions=node('div','plan-actions');
  if(plan.approved&&plan.status!=='completed')content.append(node('p','plan-policy',tr('Approved scope runs without repeated permissions. Additional actions require authorization. Verified steps advance automatically.','O escopo aprovado executa sem repetir permissões. Ações adicionais pedem autorização. Etapas verificadas avançam automaticamente.')));
  if(plan.status==='proposed'&&plan.contract_version===2){
   const permission=document.getElementById('permission') as HTMLSelectElement;const chosen=permission?.value==='autonomous'?'autonomous':'supervised';
   content.append(node('p','plan-policy',tr('Approval authorizes the listed file operations and exact commands. Host commands can affect files beyond this list.','A aprovação autoriza as operações de arquivo e os comandos exatos listados. Comandos no computador podem afetar arquivos além desta lista.')));
   const manual=plan.steps.filter(s=>s.criteria.some(c=>c.verification==='human')).length;if(manual)content.append(node('p','plan-policy',tr(`${manual} step(s) require manual result review.`,`${manual} etapa(s) exigem revisão manual do resultado.`)));
   actions.append(button(tr('Approve and implement','Aprovar e implementar'),'plan-approve',()=>request('approvePlan',{permission:chosen})));
  }
  if(plan.contract_version!==2&&plan.status!=='completed')content.append(node('p','plan-policy',tr('Older plan: revise it to review and approve its execution scope.','Plano antigo: revise para conferir e aprovar o escopo de execução.')));
  if(plan.status==='paused'&&plan.contract_version===2){
   const ref=current&&attempt?{stepId:current.id,attempt:attempt.number}:{};
   if(current?.status==='waiting_user'&&attempt?.wait_reason==='review'){
    actions.append(button(tr('Confirm manual review','Confirmar revisão manual'),'plan-confirm',()=>request('reviewStep',{...ref,decision:'confirm',comment})));
    actions.append(button(tr('Request correction','Pedir correção'),'plan-correct',()=>{if(!comment.trim()){panel.querySelector('textarea')?.focus();return;}request('reviewStep',{...ref,decision:'correct',comment});}));
   }else actions.append(button(tr('Resume step','Retomar etapa'),'plan-resume',()=>request('resumePlan',ref)));
  }
  if(plan.status!=='running')actions.append(button(tr('Revise plan','Revisar plano'),'plan-revise',()=>{revising=!revising;render();panel.querySelector('textarea')?.focus();}));
  if(revising||current?.status==='waiting_user'&&attempt?.wait_reason==='review'){
   const label=node('label','',revising?tr('What should change in the plan?','O que deve mudar no plano?'):tr('Review comment','Comentário da revisão'));label.htmlFor='plan-comment';const input=node('textarea');input.id='plan-comment';input.rows=2;input.maxLength=4000;input.value=comment;input.disabled=busy||readOnly||!!pending;input.oninput=()=>{comment=input.value;};content.append(label,input);
   if(revising)actions.append(button(tr('Request revised plan','Solicitar revisão do plano'),'plan-submit-revision',()=>{if(comment.trim())request('revisePlan',{instruction:comment});else input.focus();}));
  }
  const error=node('p','plan-error',errorText);error.setAttribute('role','alert');error.hidden=!errorText;content.append(error,actions);
  position();content.scrollTop=scroll;
  if(focusId){const next=document.getElementById(focusId);next?.focus({preventScroll:true});if(selection&&next instanceof HTMLTextAreaElement)next.setSelectionRange(selection[0],selection[1]);}
 }
 onHostMessage(m=>{
  if(m.type==='checklist'){legacyItems=m.items;if(!plan)render();}
  if(m.type==='sessionLoaded'){readOnly=!!m.readOnly;render();}
  if(m.type==='planState'){if(sessionId!==m.sessionId||plan?.plan_id!==m.plan?.plan_id){collapse();open.clear();pending='';errorText='';}else if(plan?.version!==m.plan?.version){pending='';errorText='';}const next=m.plan?.plan_id+':'+m.plan?.version+':'+m.plan?.active_step+':'+m.plan?.executions.find(e=>e.id===m.plan?.active_step)?.attempts.at(-1)?.number;if(next!==key){key=next;comment='';revising=false;}plan=m.plan;sessionId=m.sessionId;legacy=m.legacy;render();}
  if(m.type==='status'||m.type==='state'){const changed=busy!==m.busy;busy=m.busy;if(changed||m.type==='state')render();}
  if(m.type==='result'&&m.requestId===pending){pending='';errorText=m.ok?'':m.message||tr('Could not continue.','Não foi possível continuar.');render();}
 });
 document.getElementById('permission')?.addEventListener('change',render);
}
