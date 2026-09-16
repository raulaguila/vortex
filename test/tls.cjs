const {test}=require('node:test');const assert=require('node:assert/strict');const https=require('node:https');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');const {Client}=require('../dist/providers/providers');
test('compatible Node transport preserves custom paths, key and streaming; redirects never forward credentials',async()=>{
 const http=require('node:http');let redirected=false;const requests=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,key:req.headers.authorization,body});
  if(req.url==='/gateway/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'model'}]}));}
  else if(req.url==='/gateway/chat/completions'){res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'Hello'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
  else if(req.url==='/redirect/models'){res.writeHead(302,{location:'/destination'});res.end();}
  else{redirected=true;res.end('{}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const base=`http://127.0.0.1:${server.address().port}`;const client=new Client({id:'p',name:'Gateway',kind:'compatible',baseUrl:base+'/gateway'},'fixture-key');
 assert.deepEqual(await client.models(),['model']);let streamed='';const turn=await client.turn('model','system',[{role:'user',content:'hello'}],new AbortController().signal,{tokens:8192,output:256},[],text=>streamed+=text);
 assert.equal(turn.text,'Hello');assert.equal(streamed,'Hello');assert.ok(requests.every(r=>r.key==='Bearer fixture-key'));assert.equal(JSON.parse(requests[1].body).stream,true);
 await assert.rejects(new Client({id:'p',name:'Gateway',kind:'compatible',baseUrl:base+'/redirect'},'fixture-key').models(),/HTTP 302.*redirecionou/);assert.equal(redirected,false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('compatible transport aborts an active response',async()=>{
 const http=require('node:http');const {compatibleRequest}=require('../dist/providers/httpTransport');
 const server=http.createServer((_req,res)=>{res.writeHead(200);res.write('partial');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const controller=new AbortController();const response=await compatibleRequest(`http://127.0.0.1:${server.address().port}`,{signal:controller.signal},false);const body=response.text();controller.abort();await assert.rejects(body);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('network diagnostics expose known cause codes without raw secret-bearing messages',()=>{
 const {connectionError}=require('../dist/providers/httpTransport');const outer=new Error('https://secret@internal');outer.cause=Object.assign(new Error('private-key'),{code:'ENOTFOUND'});
 assert.match(connectionError(outer),/DNS.*ENOTFOUND/);assert.ok(!connectionError(outer).includes('secret'));assert.ok(!connectionError(outer).includes('private-key'));
});
test('TLS insecure works for catalog and inference with a self-signed server, without changing other connections',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vortex-tls-'));let server;
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-subj','/CN=localhost','-days','1'],{stdio:'ignore'});
    server=https.createServer({key:await fs.readFile(path.join(dir,'key.pem')),cert:await fs.readFile(path.join(dir,'cert.pem'))},(req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/gateway/inference/models'?{data:[{id:'test-model'}]}:{choices:[{message:{content:'TLS verified'}}]}));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base={id:'test',name:'TLS test',kind:'compatible',baseUrl:`https://127.0.0.1:${server.address().port}/gateway/inference`};
    const secure=new Client(base,'');const insecure=new Client({...base,tlsInsecure:true},'');
    await assert.rejects(secure.models(),/indisponível/);
    assert.deepEqual(await insecure.models(),['test-model']);
    assert.equal(await insecure.chat('test-model','test',[{role:'user',content:'test'}],new AbortController().signal),'TLS verified');
    await assert.rejects(new Client({...base,kind:'openai',tlsInsecure:true},'').models(),/indisponível/);
    await assert.rejects(secure.models(),/indisponível/);
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.rm(dir,{recursive:true,force:true});}
});
