const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {runCommand}=require('../dist/command');
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
test('terminal reports success, exit failure, output cap and timeout',async()=>{
 assert.match(await runCommand('echo ready',os.tmpdir(),new AbortController().signal),/Exit: 0\nready/);
 await assert.rejects(runCommand('exit 7',os.tmpdir(),new AbortController().signal),/Exit: 7/);
 await assert.rejects(runCommand('"'+process.execPath+'" -e "setTimeout(()=>{},10000)"',os.tmpdir(),new AbortController().signal,100),error=>error.code==='command_timeout'&&/timed out/.test(error.message));
 await assert.rejects(runCommand('"'+process.execPath+'" -e "process.stdout.write(String.fromCharCode(120).repeat(10000))"',os.tmpdir(),new AbortController().signal,1000,100),/output exceeded/);
});
test('Stop kills the shell and an ordinary child process before it can mutate a file',{skip:process.platform==='win32'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-command-'));
 const controller=new AbortController();
 try{
  const command='(echo started > '+quote(path.join(root,'started'))+'; sleep 1; echo bad > '+quote(path.join(root,'late'))+') & wait';
  const result=runCommand(command,root,controller.signal);const rejection=assert.rejects(result,/cancelled/);
  for(let i=0;i<100;i++){try{await fs.stat(path.join(root,'started'));break;}catch{await new Promise(r=>setTimeout(r,10));}}
  controller.abort();await rejection;await new Promise(r=>setTimeout(r,1100));
  await assert.rejects(fs.stat(path.join(root,'late')),e=>e.code==='ENOENT');
 }finally{controller.abort();await fs.rm(root,{recursive:true,force:true});}
});
