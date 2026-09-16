import type {PlanController,StepReport,CommandEvidence,StepEvidence} from "./plan";

/** Checks are selected by the approved definition, never by model evidence claims. */
export async function verifyStep(plan:PlanController,report:StepReport,run:(command:string,cwd:string)=>Promise<{id:string;result:CommandEvidence}>,fingerprint:()=>Promise<string|null>):Promise<StepReport>{
 const evidence:StepReport['evidence']=[];
 if(report.outcome!=='completed')return report;
 const checked=new Map<string,string>();
 for(const criterion of plan.definition!.criteria){
  if(criterion.verification==='command'){
   const key=JSON.stringify([criterion.command,criterion.cwd]);
   let id=checked.get(key);
   if(!id){const check=await run(criterion.command!,criterion.cwd!);id=check.id;checked.set(key,id);}
   evidence.push({criterion_id:criterion.id,tool_call_ids:[id]});
  }else{
   const cited=report.evidence.find(e=>e.criterion_id===criterion.id)?.tool_call_ids;
   const mutations=new Map<string,StepEvidence>();
   for(const e of plan.attempt!.evidence)if(['write_file','edit_file','edit_file_batch','delete_file'].includes(e.tool))mutations.set(e.path||e.id,e);
   const observed=[...plan.attempt!.evidence.filter(e=>e.status==='success'&&['read_file','search_files'].includes(e.tool)&&!mutations.has(e.path||e.id)),...mutations.values()].map(e=>e.id);
   evidence.push({criterion_id:criterion.id,tool_call_ids:cited?.length?cited:observed});
  }
 }
 const verified={...report,evidence};plan.validate(verified,await fingerprint(),true);return verified;
}
