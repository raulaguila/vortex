import type {Store} from './providerManager';

/** Publish related preferences together; delayed memento events cannot split a profile. */
export class ProfileStore implements Store {
 private values:Record<string,unknown>;
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private source:Store){
  const saved=source.get<Record<string,unknown>|undefined>('vortexProfile',undefined);
  this.values=structuredClone(saved||{providers:source.get('providers',[]),modelPreferences:source.get('modelPreferences',{})});
 }
 get<T>(key:string,fallback:T):T{return structuredClone((this.values[key]??fallback) as T);}
 update(key:string,value:unknown):Promise<void>{
  const work=this.queue.then(async()=>{const next={...this.values,[key]:structuredClone(value)};await this.source.update('vortexProfile',next);this.values=next;});
  this.queue=work.catch(()=>undefined);return work;
 }
}
