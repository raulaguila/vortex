export function applyEdits(content:string,edits:{old_text:string;new_text:string}[]):string{
  let next=content;
  for(const [index,edit]of edits.entries()){
    if(!edit.old_text||edit.old_text===edit.new_text)throw new Error(`Edit ${index+1} must change a nonempty exact match.`);
    if(next.split(edit.old_text).length!==2)throw new Error(`Edit ${index+1} must match exactly once. No changes applied.`);
    next=next.replace(edit.old_text,()=>edit.new_text);
  }
  if(next.length>200000)throw new Error('Edited file exceeds 200 KB.');return next;
}
