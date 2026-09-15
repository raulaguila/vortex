// Presentation uses observed results; the model still receives the structured result.
export function toolPresentation(tool:string,result:string):string{
 try{
  const value=JSON.parse(result);
  if(tool==='list'&&Array.isArray(value.files))return value.files.join('\n')+(value.nextOffset!==null?'\n… More files available.':'');
  if(tool==='read'&&typeof value.content==='string')return value.path+' · '+value.source+(value.dirty?' · unsaved changes':'')+'\n'+value.content;
  if(tool==='search'&&Array.isArray(value.matches))return value.matches.map((m:any)=>`${m.path}:${m.line}: ${m.text}`).join('\n')+`\n${value.scannedFiles} files searched; ${value.skippedFiles} skipped.`+(value.nextOffset!==null?' More files available.':'');
  if(tool==='diagnostics'&&Array.isArray(value.items))return value.items.map((d:any)=>`${d.file}:${d.line}: ${d.message}`).join('\n')||'No diagnostics reported by the IDE.';
 }catch{/* Older sessions and plain-text results remain readable. */}
 return result;
}
