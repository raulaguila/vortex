import {randomUUID} from 'node:crypto';
// Execution-scoped output pages. Bound memory, and never silently pretend a preview is complete.
export class ToolOutputs {
 private values=new Map<string,string>();
 private size=0;
 preserve(value:string,limit:number){
  if(value.length<=limit)return value;
  while(this.size+value.length>8_000_000&&this.values.size){const id=this.values.keys().next().value!;this.size-=this.values.get(id)!.length;this.values.delete(id);}
  if(value.length>8_000_000)return JSON.stringify({preview:value.slice(0,limit),truncated:true,instruction:'Result exceeds retention limit. Narrow the original query.'});
  const id=randomUUID();this.values.set(id,value);this.size+=value.length;
  return JSON.stringify({preview:value.slice(0,limit),truncated:true,outputId:id,nextOffset:limit,totalCharacters:value.length,instruction:'Use readOutput with outputId as id and nextOffset as offset. Pages remain available during this execution.'});
 }
 read(id:string,offset=0,limit=2000){
  const value=this.values.get(id);if(value===undefined)throw new Error('Output expired or unavailable. Run a narrower original query.');
  const end=Math.min(value.length,offset+limit);
  return JSON.stringify({text:value.slice(offset,end),nextOffset:end<value.length?end:null,totalCharacters:value.length});
 }
}
