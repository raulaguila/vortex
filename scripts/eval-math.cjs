const {Worker}=require('node:worker_threads');
// Run only the arithmetic fixture, in a worker with no host objects in its VM context.
exports.verifySum=source=>new Promise(resolve=>{
 const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const vm=require('node:vm');try{const code=workerData.replace(/\\bexport\\s+(?=(?:const|function|let|var)\\b)/g,'');const result=new vm.Script(code+'; [sum(2,3),sum(-2,5),sum(0,0),sum(1.5,2.5)]').runInNewContext(Object.create(null),{timeout:100,contextCodeGeneration:{strings:false,wasm:false}});parentPort.postMessage(JSON.stringify(result)==='[5,3,0,4]');}catch{parentPort.postMessage(false);}`,{eval:true,workerData:source,resourceLimits:{maxOldGenerationSizeMb:32,stackSizeMb:2}});
 let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();resolve(value===true);};const timer=setTimeout(()=>finish(false),2000);worker.on('message',finish);worker.on('error',()=>finish(false));worker.on('exit',()=>finish(false));
});
