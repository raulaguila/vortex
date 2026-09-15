// Presentation uses observed results; the model still receives the structured result.
export function toolPresentation(tool:string,result:string):string{
 try{
  const value=JSON.parse(result);
  if(tool==='run_command'&&typeof value.output==='string')return value.execution_location+'\n'+value.output;
  if(tool==='list_files'&&Array.isArray(value.files))return value.files.join('\n')+(value.next_offset!==null?'\n… More files available.':'');
  if(tool==='read_file'&&typeof value.content==='string')return value.path+' · '+value.source+(value.dirty?' · unsaved changes':'')+'\n'+value.content;
  if(tool==='search_files'&&Array.isArray(value.matches))return value.matches.map((m:any)=>`${m.path}:${m.line}: ${m.text}`).join('\n')+`\n${value.scanned_files} files searched; ${value.skipped_files} skipped.`+(value.next_offset!==null?' More files available.':'');
  if(tool==='get_diagnostics'&&Array.isArray(value.items))return value.items.map((d:any)=>`${d.file}:${d.line}: ${d.message}`).join('\n')||'No diagnostics reported by the IDE.';
 }catch{/* Older sessions and plain-text results remain readable. */}
 return result;
}
