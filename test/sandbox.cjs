const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {Sandbox}=require('../dist/policy/sandbox');
test('real container isolates workspace, protects credentials, blocks network and imports only changes',async t=>{
 const sandbox=new Sandbox();if(!await sandbox.available()){if(process.env.VORTEX_REQUIRE_SANDBOX==='1')throw new Error('Required Docker runtime unavailable.');t.skip('Local Docker runtime unavailable; isolation NOT validated');return;}
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-isolation-'));try{
  await fs.writeFile(path.join(root,'a.txt'),'original');await fs.writeFile(path.join(root,'.env'),'never-copy');
  const image=process.env.VORTEX_SANDBOX_IMAGE||'node:22-bookworm-slim';const signal=new AbortController().signal;
  const result=await sandbox.execute(root,"test ! -e .env && printf changed > a.txt && test ! -e /var/run/docker.sock",signal,10000,false,image);
  assert.equal(result.error,undefined);assert.equal(await fs.readFile(path.join(root,'a.txt'),'utf8'),'original');assert.equal(result.changes[0].after,'changed');
  const interrupted=await sandbox.execute(root,"printf partial > a.txt; sleep 30",signal,1500,false,image);
  assert.equal(interrupted.failure?.code,'command_timeout');assert.equal(await fs.readFile(path.join(root,'a.txt'),'utf8'),'original');assert.ok(interrupted.changes.some(change=>change.after==='partial'));
  const network=await sandbox.execute(root,`node -e "require('dns').lookup('example.com',error=>process.exit(error?0:1))"`,signal,10000,false,image);assert.equal(network.error,undefined);
  const outside=await sandbox.execute(root,'touch /outside-workspace',signal,10000,false,image);assert.ok(outside.error);
 }finally{await sandbox.dispose();await fs.rm(root,{recursive:true,force:true});}
});
