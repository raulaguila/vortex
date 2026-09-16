// Fixed, append-only run directory. The driver cannot change prompts/allowlists during a run.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),sourceVsix=process.env.VORTEX_VSIX_PATH||path.join(root,'vortex-agent.vsix');
 if(!process.env.VORTEX_EVAL_URL)throw new Error('Set VORTEX_EVAL_URL to the local Ollama endpoint.');
 const run='stability-'+new Date().toISOString().replace(/[:.]/g,'-'),directory=path.join(root,'test-results',run);await fs.mkdir(directory,{recursive:true});const vsix=path.join(directory,'tested.vsix');await fs.copyFile(sourceVsix,vsix);
 const report={run,simulated:false,protocol:'native',package_sha256:crypto.createHash('sha256').update(await fs.readFile(vsix)).digest('hex'),driver_sha256:crypto.createHash('sha256').update(await fs.readFile(path.join(root,'test/ollama-host.cjs'))).digest('hex'),required_per_scenario:5,models:['gemma4:26b','qwen3.8:27b'],runs:[],accepted:false};
 const save=()=>fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await save();
 report.evaluator_sha256=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'scripts/eval-math.cjs'))).digest('hex');await save();
 for(const model of report.models)for(let repetition=0;repetition<5;repetition++){
  const label=run+'-'+model.replace(/[^a-z0-9]/gi,'_')+'-'+repetition;
  console.log('Starting',model,'repetition',repetition+1);
  const log=await fs.open(path.join(directory,label+'.log'),'w');
  const exit=await new Promise(resolve=>{const child=spawn(process.execPath,['test/ollama-host.cjs'],{cwd:root,env:{...process.env,VORTEX_VSIX_PATH:vsix,VORTEX_EVAL_MODEL:model,VORTEX_EVAL_LABEL:label,VORTEX_EVAL_REPEAT:String(repetition),VORTEX_EVAL_MATRIX:'1'},stdio:['ignore',log.fd,log.fd]});child.on('error',error=>resolve({error:error.message}));child.on('exit',code=>resolve({code}));});await log.close();
  let result;try{result=JSON.parse(await fs.readFile(path.join(root,'test-results/ollama-host',label,'report.json'),'utf8'));}catch(error){result={error:error.message};}
  report.runs.push({model,repetition:repetition+1,...exit,result});await save();console.log('Finished',model,repetition+1,result.accepted?'PASS':'FAIL');
 }
 report.accepted=report.runs.length===10&&report.runs.every(r=>r.code===0&&r.result.accepted&&r.result.results.length===6);await save();console.log('Report:',path.join(directory,'report.json'));if(!report.accepted)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
