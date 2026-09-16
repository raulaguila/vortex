import {Worker} from 'node:worker_threads';
export interface SearchFile {path:string;text:string}
// Untrusted regular expressions run off the extension-host thread and have a deadline.
export function searchPage(files:SearchFile[],query:string,regex:boolean,case_sensitive:boolean,signal:AbortSignal,startLine=0):Promise<{matches:{path:string;line:number;text:string}[];truncated:boolean;next_file:number|null;next_line:number|null}>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(`const {workerData:d,parentPort}=require('node:worker_threads');try{
      const re=d.regex?new RegExp(d.query,d.case_sensitive?'':'i'):null,q=d.case_sensitive?d.query:d.query.toLocaleLowerCase();let matches=[],truncated=false,next_file=null,next_line=null;
      outer:for(const [fi,f]of d.files.entries())for(const [i,line]of f.text.split('\\n').entries()){if(fi===0&&i<d.startLine)continue;
        if(re?re.test(line):(d.case_sensitive?line:line.toLocaleLowerCase()).includes(q)){
          if(matches.length>=1000){truncated=true;next_file=fi;next_line=i;break outer;}matches.push({path:f.path,line:i+1,text:line.slice(0,500)});
        }
      }parentPort.postMessage({matches,truncated,next_file,next_line});
    }catch{parentPort.postMessage({error:true});}`,{eval:true,workerData:{files,query,regex,case_sensitive,startLine},resourceLimits:{maxOldGenerationSizeMb:64}});
    const finish=(error?:Error,value?:any)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(new Error('Search cancelled.'));
    const timer=setTimeout(()=>finish(new Error('Search exceeded its time limit. Narrow the query or simplify the regex.')),2000);
    signal.addEventListener('abort',abort,{once:true});
    worker.once('message',result=>result.error?finish(new Error('Invalid regular expression.')):finish(undefined,result));
    worker.once('error',()=>finish(new Error('Search could not complete. Narrow the query.')));
    if(signal.aborted)abort();
  });
}
