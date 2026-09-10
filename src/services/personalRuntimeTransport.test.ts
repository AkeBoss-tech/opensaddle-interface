import assert from'node:assert/strict'
import test from'node:test'

test('desktop transport keeps authorization out of renderer requests',async()=>{const originalFetch=globalThis.fetch,priorWindow=globalThis.window;let seen:unknown;(globalThis as unknown as{window:unknown}).window={opensaddle:{personalRuntimeRequest:async(value:unknown)=>{seen=value;return{status:200,contentType:'application/json',bodyBase64:'eyJvayI6dHJ1ZX0='}}}};globalThis.fetch=async()=>{throw Error('network fetch must not run')};try{const{installPersonalRuntimeTransport}=await import(`./personalRuntimeTransport?test=${Date.now()}`);installPersonalRuntimeTransport({baseUrl:'http://127.0.0.1:8766',installationId:'install',projectId:'project'});const response=await fetch('http://127.0.0.1:8766/api/v2/personal-runtime',{headers:{'X-OpenSaddle-User':'owner'}});assert.deepEqual(seen,{method:'GET',path:'/api/v2/personal-runtime',expectedBaseUrl:'http://127.0.0.1:8766',expectedInstallationId:'install',expectedProjectId:'project'});assert.deepEqual(await response.json(),{ok:true});await assert.rejects(fetch('http://127.0.0.1:8766/api/v2/personal-runtime',{headers:{Authorization:'Bearer renderer'}}),/owned by the desktop transport/)}finally{globalThis.fetch=originalFetch;(globalThis as unknown as{window:unknown}).window=priorWindow}})
test('desktop transport rejects an old response after authority switch and preserves abort',async()=>{const originalFetch=globalThis.fetch,priorWindow=globalThis.window;let resolve!:(value:{status:number;contentType:string;bodyBase64:string})=>void;(globalThis as unknown as{window:unknown}).window={opensaddle:{personalRuntimeRequest:()=>new Promise(value=>{resolve=value})}};globalThis.fetch=async()=>{throw Error('network fetch must not run')};try{const{installPersonalRuntimeTransport}=await import(`./personalRuntimeTransport?race=${Date.now()}`),a={baseUrl:'http://127.0.0.1:8766/',installationId:'A',projectId:'P'},b={...a,installationId:'B'};installPersonalRuntimeTransport(a);const pending=fetch(`${a.baseUrl}api/v2/personal-runtime`);installPersonalRuntimeTransport(b);resolve({status:200,contentType:'application/json',bodyBase64:'e30='});await assert.rejects(pending,/authority changed/);const controller=new AbortController(),aborted=fetch(`${a.baseUrl}api/v2/personal-runtime`,{signal:controller.signal});controller.abort();await assert.rejects(aborted,error=>(error as DOMException).name==='AbortError')}finally{globalThis.fetch=originalFetch;(globalThis as unknown as{window:unknown}).window=priorWindow}})

test('presentation identity comes only from the adopted owner on the matching endpoint',async()=>{
 const originalFetch=globalThis.fetch,priorWindow=globalThis.window
 ;(globalThis as unknown as{window:unknown}).window={opensaddle:{personalRuntimeRequest:async()=>({status:200,contentType:'application/json',bodyBase64:'e30='})}}
 try{
  const{installPersonalRuntimeTransport,personalRuntimeSubject}=await import(`./personalRuntimeTransport?owner=${Date.now()}`)
  assert.equal(personalRuntimeSubject('http://127.0.0.1:8766'),undefined)
  installPersonalRuntimeTransport({baseUrl:'http://127.0.0.1:8766/',installationId:'install',projectId:'P',ownerSubject:'commissioned-owner'})
  assert.equal(personalRuntimeSubject('http://127.0.0.1:8766'),'commissioned-owner')
  assert.equal(personalRuntimeSubject('http://127.0.0.1:8765'),undefined)
  installPersonalRuntimeTransport({baseUrl:'http://127.0.0.1:8766/',installationId:'new-install',projectId:'Q',ownerSubject:'new-owner'})
  assert.equal(personalRuntimeSubject('http://127.0.0.1:8766'),'new-owner')
 }finally{globalThis.fetch=originalFetch;(globalThis as unknown as{window:unknown}).window=priorWindow}
})
