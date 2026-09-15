import {Worker} from 'node:worker_threads';
export interface SearchFile {path:string;text:string}
// Untrusted regular expressions run off the extension-host thread and have a deadline.
export function searchPage(files:SearchFile[],query:string,regex:boolean,caseSensitive:boolean,signal:AbortSignal):Promise<{matches:{path:string;line:number;text:string}[];truncated:boolean}>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(`const {workerData:d,parentPort}=require('node:worker_threads');try{
      const re=d.regex?new RegExp(d.query,d.caseSensitive?'':'i'):null,q=d.caseSensitive?d.query:d.query.toLocaleLowerCase();let matches=[],truncated=false;
      outer:for(const f of d.files)for(const [i,line]of f.text.split('\\n').entries()){
        if(re?re.test(line):(d.caseSensitive?line:line.toLocaleLowerCase()).includes(q)){
          if(matches.length>=1000){truncated=true;break outer;}matches.push({path:f.path,line:i+1,text:line.slice(0,500)});
        }
      }parentPort.postMessage({matches,truncated});
    }catch{parentPort.postMessage({error:true});}`,{eval:true,workerData:{files,query,regex,caseSensitive},resourceLimits:{maxOldGenerationSizeMb:64}});
    const finish=(error?:Error,value?:any)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(new Error('Search cancelled.'));
    const timer=setTimeout(()=>finish(new Error('Search exceeded its time limit. Narrow the query or simplify the regex.')),2000);
    signal.addEventListener('abort',abort,{once:true});
    worker.once('message',result=>result.error?finish(new Error('Invalid regular expression.')):finish(undefined,result));
    worker.once('error',()=>finish(new Error('Search could not complete. Narrow the query.')));
    if(signal.aborted)abort();
  });
}
