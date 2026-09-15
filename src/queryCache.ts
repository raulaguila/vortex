import {randomUUID} from 'node:crypto';
interface Query {id:string;key:string;files:string[];capped:boolean;excluded:string;touched:number}
export class QueryCache {
 private generation=0;
 private queries=new Map<string,Query>();
 private cursors=new Map<string,{query:string;offset:number;line:number}>();
 constructor(private now=Date.now){}
 invalidate(){this.generation++;this.queries.clear();this.cursors.clear();}
 private prune(){for(const [key,q]of this.queries)if(this.now()-q.touched>=300000)this.drop(key);}
 private drop(key:string){const q=this.queries.get(key);this.queries.delete(key);for(const [id,c]of this.cursors)if(c.query===q?.id)this.cursors.delete(id);}
 async get(key:string,cursor:string|undefined,load:()=>Promise<{files:string[];capped:boolean;excluded:string}>){
  this.prune();const point=cursor?this.cursors.get(cursor):undefined;let query=this.queries.get(key);
  if(cursor&&(!query||!point||point.query!==query.id))throw new Error('Query expired or changed. Restart the original query without cursor.');
  if(!query){
   let data:Awaited<ReturnType<typeof load>>|undefined;
   // One read-only rediscovery absorbs delayed file-watcher notifications after a save.
   for(let attempt=0;attempt<2;attempt++){const generation=this.generation;const found=await load();if(generation===this.generation){data=found;break;}}
   if(!data)throw new Error('Workspace changed during discovery. Restart the query.');
   while(this.queries.size>=8)this.drop([...this.queries].sort((a,b)=>a[1].touched-b[1].touched)[0][0]);query={id:randomUUID(),key,...data,touched:this.now()};this.queries.set(key,query);
  }
  query.touched=this.now();return {query,offset:point?.offset,line:point?.line||0};
 }
 next(query:Query,offset:number,line=0){if(this.cursors.size>=2048)this.cursors.delete(this.cursors.keys().next().value!);const id=randomUUID();this.cursors.set(id,{query:query.id,offset,line});return id;}
}
export async function mapLimited<T,R>(items:T[],limit:number,fn:(item:T,index:number)=>Promise<R>):Promise<R[]>{
 const results:R[]=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(items.length,limit)},async()=>{while(next<items.length){const i=next++;results[i]=await fn(items[i],i);}}));return results;
}
