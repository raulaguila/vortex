// Presentation uses observed results; the model still receives the structured result.
export function toolPresentation(tool:string,result:string):string{
 try{
  const value=JSON.parse(result);
  if(tool==='run_command'&&typeof value.output==='string')return value.execution_location+'\n'+value.output;
  if(tool==='list_files'&&Array.isArray(value.files))return value.files.join('\n')+`\n${value.files.length} of ${value.total_discovered} discovered files.`+(value.capped?' Discovery limit reached; narrow the filters.':'')+(value.next_cursor?' More files available.':'');
  if(tool==='read_file'&&typeof value.content==='string')return value.path+' · '+value.source+(value.dirty?' · unsaved changes':'')+'\n'+value.content;
  if(tool==='search_files'&&Array.isArray(value.matches))return value.matches.map((m:any)=>`${m.path}:${m.line}: ${m.text}`).join('\n')+`\n${value.scanned_files} files searched; ${value.skipped_files} skipped.`+(value.skipped_reasons?' Reasons: '+Object.entries(value.skipped_reasons).map(([k,v])=>k+': '+v).join(', ')+'.':'')+(value.next_cursor?' More matches or files available.':'')+(value.capped?' Discovery limit reached; narrow the filters.':'');
  if(tool==='get_diagnostics'&&Array.isArray(value.items))return value.items.map((d:any)=>`${d.file}:${d.line}: ${d.message}`).join('\n')||'No diagnostics reported by the IDE.';
 }catch{/* Older sessions and plain-text results remain readable. */}
 return result;
}
