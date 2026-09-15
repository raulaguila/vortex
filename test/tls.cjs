const {test}=require('node:test');const assert=require('node:assert/strict');const https=require('node:https');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');const {Client}=require('../dist/providers');
test('TLS insecure works for catalog and inference with a self-signed server, without changing other connections',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-tls-'));let server;
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-subj','/CN=localhost','-days','1'],{stdio:'ignore'});
    server=https.createServer({key:await fs.readFile(path.join(dir,'key.pem')),cert:await fs.readFile(path.join(dir,'cert.pem'))},(req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/v1/models'?{data:[{id:'test-model'}]}:{choices:[{message:{content:'TLS verified'}}]}));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base={id:'test',name:'TLS test',kind:'compatible',baseUrl:`https://127.0.0.1:${server.address().port}/v1`};
    const secure=new Client(base,'');const insecure=new Client({...base,tlsInsecure:true},'');
    await assert.rejects(secure.models(),/indisponível/);
    assert.deepEqual(await insecure.models(),['test-model']);
    assert.equal(await insecure.chat('test-model','test',[{role:'user',content:'test'}],new AbortController().signal),'TLS verified');
    await assert.rejects(new Client({...base,kind:'openai',tlsInsecure:true},'').models(),/indisponível/);
    await assert.rejects(secure.models(),/indisponível/);
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.rm(dir,{recursive:true,force:true});}
});
