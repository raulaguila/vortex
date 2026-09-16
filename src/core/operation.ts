import {ExecutionError} from "./execution";
export type OperationOutcome='not_applied'|'applied'|'partial'|'uncertain';
export type OperationPhase='prepared'|'applying'|'applied'|'saved'|'recorded';
export interface OperationState {id:string;path:string;phase:OperationPhase;outcome:OperationOutcome;undo?:boolean}

/** Persist intent before effects, then stop on any unconfirmed post-effect failure. */
export async function performMutation(
 operation:OperationState,
 persist:(state:OperationState)=>Promise<void>,
 apply:()=>Promise<void>,save:()=>Promise<void>,record:()=>Promise<void>
){
 const state={...operation,phase:'prepared' as OperationPhase,outcome:'not_applied' as OperationOutcome};
 try{await persist({...state});state.phase='applying';state.outcome='uncertain';await persist({...state});}
 catch{throw new ExecutionError('persistence','Operation could not be recorded. No new changes were started.');}
 try{
  await apply();state.phase='applied';state.outcome='partial';await persist({...state});
  await save();state.phase='saved';await persist({...state});
  await record();state.phase='recorded';state.outcome='applied';await persist({...state});
  return state;
 }catch{
  if(state.phase==='recorded')state.outcome='uncertain';
  try{await persist({...state});}catch{/* Earlier durable intent remains available for recovery. */}
  throw new ExecutionError('uncertain_outcome',`Operation ${state.id} on ${state.path} stopped at ${state.phase}. Changes may already exist. Review before continuing; the operation was not repeated.`,false,{...state});
 }
}
