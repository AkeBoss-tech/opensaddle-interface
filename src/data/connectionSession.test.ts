import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSessionConnection, saveSessionConnection } from './connectionSession'
import type { ConnectionProfile } from '../services'

class MemoryStorage implements Storage {
  #items=new Map<string,string>()
  get length(){return this.#items.size}
  clear(){this.#items.clear()}
  getItem(key:string){return this.#items.get(key)??null}
  key(index:number){return [...this.#items.keys()][index]??null}
  removeItem(key:string){this.#items.delete(key)}
  setItem(key:string,value:string){this.#items.set(key,value)}
}

const fallback:ConnectionProfile={id:'configured-server',name:'Default',mode:'remote',baseUrl:'http://127.0.0.1:8903',allowMockFallback:false}

test('a verified connection survives reload only within the current tab session',()=>{const storage=new MemoryStorage();const profile:ConnectionProfile={id:'remote-http://127.0.0.1:8904',name:'PG fixture',mode:'remote',baseUrl:'http://127.0.0.1:8904',token:'private-token',allowMockFallback:false};saveSessionConnection(profile,storage);assert.deepEqual(loadSessionConnection(fallback,storage),profile)})

test('demo selection clears the prior authenticated session connection',()=>{const storage=new MemoryStorage();saveSessionConnection({...fallback,token:'private-token'},storage);saveSessionConnection({id:'demo',name:'Demo',mode:'demo',baseUrl:'http://127.0.0.1:8765',allowMockFallback:true},storage);assert.deepEqual(loadSessionConnection(fallback,storage),fallback)})

test('invalid persisted connection data fails closed to configured runtime',()=>{const storage=new MemoryStorage();storage.setItem('opensaddle-connection-session-v1',JSON.stringify({mode:'remote',baseUrl:'javascript:alert(1)',token:'bad'}));assert.deepEqual(loadSessionConnection(fallback,storage),fallback)})
test('personal runtime connection persists endpoint metadata without its memory-only token',()=>{const storage=new MemoryStorage();const profile:ConnectionProfile={id:'remote-http://127.0.0.1:8766',name:'Personal runtime',mode:'remote',baseUrl:'http://127.0.0.1:8766',token:'handoff-secret',allowMockFallback:false};saveSessionConnection(profile,storage,false);assert.deepEqual(loadSessionConnection(fallback,storage),{...profile,token:undefined});assert.doesNotMatch(storage.getItem('opensaddle-connection-session-v1')??'',/handoff-secret/)})
