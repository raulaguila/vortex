import * as http from 'node:http';
import * as https from 'node:https';
import {Readable} from 'node:stream';

/** Node HTTP transport for compatible gateways. TLS policy is local to this request. */
export function compatibleRequest(address:string,options:RequestInit,tlsInsecure:boolean):Promise<Response>{
  return new Promise((resolve,reject)=>{
    const url=new URL(address),secure=url.protocol==='https:';
    if(!secure&&url.protocol!=='http:'){reject(new Error('Unsupported protocol.'));return;}
    const headers=new Headers(options.headers);
    if(!headers.has('accept'))headers.set('accept','application/json');
    const body=typeof options.body==='string'?Buffer.from(options.body):undefined;
    if(body)headers.set('content-length',String(body.length));
    const requestHeaders:Record<string,string>={};headers.forEach((value,key)=>{requestHeaders[key]=value;});
    const req=(secure?https:http).request(url,{method:options.method||'GET',headers:requestHeaders,...(secure?{rejectUnauthorized:!tlsInsecure}:{})});
    const signal=options.signal;
    const abort=()=>req.destroy(signal?.reason instanceof Error?signal.reason:new Error('Request aborted.'));
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    req.once('error',error=>{cleanup();reject(error);});
    req.once('response',res=>{
      res.once('close',cleanup);
      const responseHeaders=new Headers();
      for(let i=0;i<res.rawHeaders.length;i+=2)responseHeaders.append(res.rawHeaders[i],res.rawHeaders[i+1]);
      const status=res.statusCode||502;
      // Redirects are returned to the caller, never followed with credentials.
      const empty=options.method==='HEAD'||[204,205,304].includes(status);
      if(empty)res.resume();
      try{resolve(new Response(empty?null:Readable.toWeb(res) as ReadableStream<Uint8Array>,{status,headers:responseHeaders}));}
      catch(error){res.destroy();cleanup();reject(error);}
    });
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    req.end(body);
  });
}

/** Only known codes are rendered; raw errors may contain credentials or internal URLs. */
export function connectionError(error:unknown):string{
  let current=error;const codes=new Set<string>();
  for(let depth=0;depth<5&&current&&typeof current==='object';depth++){
    const entry=current as {code?:unknown;name?:unknown;cause?:unknown};
    if(typeof entry.code==='string')codes.add(entry.code);
    if(entry.name==='TimeoutError')codes.add('ETIMEDOUT');
    current=entry.cause;
  }
  const messages:Record<string,string>={
    ENOTFOUND:'DNS: nome do servidor não encontrado.',EAI_AGAIN:'DNS: resolução temporariamente indisponível.',
    ECONNREFUSED:'Conexão recusada pelo servidor ou porta.',ECONNRESET:'Conexão encerrada pelo servidor ou proxy.',
    ETIMEDOUT:'Tempo de conexão esgotado.',UND_ERR_CONNECT_TIMEOUT:'Tempo de conexão esgotado.',
    ENETUNREACH:'Rede inacessível. Verifique VPN, proxy e rota.',EHOSTUNREACH:'Servidor inacessível pela rede atual.',
    DEPTH_ZERO_SELF_SIGNED_CERT:'Certificado TLS autoassinado. Confira TLS insecure nesta conexão.',
    SELF_SIGNED_CERT_IN_CHAIN:'Cadeia TLS autoassinada. Confira TLS insecure nesta conexão.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:'Não foi possível verificar a cadeia TLS.',UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'Autoridade do certificado TLS não reconhecida.',
    CERT_HAS_EXPIRED:'Certificado TLS expirado.',ERR_TLS_CERT_ALTNAME_INVALID:'Certificado TLS não corresponde ao servidor.',
    EPROTO:'Falha na negociação TLS com o servidor ou proxy.',
  };
  for(const code of codes)if(messages[code])return `${messages[code]} (${code})`;
  return 'Verifique a URL, a VPN e o proxy usado pelo VS Code.';
}
