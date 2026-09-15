export function applyEdits(content:string,edits:{oldText:string;newText:string}[]):string{
  let next=content;
  for(const [index,edit]of edits.entries()){
    if(!edit.oldText||edit.oldText===edit.newText)throw new Error(`Edit ${index+1} must change a nonempty exact match.`);
    if(next.split(edit.oldText).length!==2)throw new Error(`Edit ${index+1} must match exactly once. No changes applied.`);
    next=next.replace(edit.oldText,()=>edit.newText);
  }
  if(next.length>200000)throw new Error('Edited file exceeds 200 KB.');return next;
}
