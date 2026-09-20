import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { StoreProvider, useStore } from './store'
import { saveSessionConnection, loadSessionConnection } from './connectionSession'
import { connectionProfileForRuntime } from '../services'
import { connectionPresentation } from '../lib/connectionPresentation'
import { createEmptyWorkspace } from './emptyWorkspace'
import { STORAGE_KEY } from './seed'

class MemoryStorage implements Storage {
  private values = new Map<string,string>()
  get length(){return this.values.size}
  clear(){this.values.clear()}
  getItem(key:string){return this.values.get(key)??null}
  key(index:number){return [...this.values.keys()][index]??null}
  removeItem(key:string){this.values.delete(key)}
  setItem(key:string,value:string){this.values.set(key,value)}
}

// WEB-CONNECTION-1: a public website never probes localhost without a selected server.
test('public browser waits for a connection without network probes, retries or simulated actions', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const prior = {window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,React:(globalThis as typeof globalThis & {React?:typeof React}).React}
  const requests:string[]=[]; const ticks=new Set<()=>void>()
  let store:ReturnType<typeof useStore>|undefined
  Object.assign(globalThis,{React,localStorage:new MemoryStorage(),sessionStorage:new MemoryStorage(),
    window:{location:{hostname:'akashdubey.me'},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,
      setInterval(callback:()=>void){ticks.add(callback);return callback},clearInterval(callback:()=>void){ticks.delete(callback)}},
    document:{body:{dataset:{},removeAttribute(){},setAttribute(){}}},
    fetch:async(input:string|URL|Request)=>{requests.push(String(input));throw new Error('No server selected')},
  })
  function Capture(){store=useStore();return null}
  let view:ReactTestRenderer|undefined
  try {
    await act(async()=>{view=create(<StoreProvider><Capture/></StoreProvider>);await new Promise(resolve=>setTimeout(resolve,30))})
    await act(async()=>{for(let i=0;i<3;i++)for(const tick of [...ticks])tick();await new Promise(resolve=>setTimeout(resolve,30))})
    assert.deepEqual(requests,[], 'unconfigured public browser must make no server requests')
    assert.equal(store?.connection.mode,'unconfigured')
    assert.equal(connectionPresentation({connection:store!.connection,controlPlane:store!.services!.controlPlane,desktop:false}).label,'Not connected')
    await assert.rejects(store!.services!.runtime.startRun({projectId:'p',task:'hello'}),/Choose an OpenSaddle server/)
    await assert.rejects(store!.services!.tools.connect('github'),/Choose an OpenSaddle server/)
    assert.deepEqual(await store!.services!.tools.list(),[])
    assert.deepEqual(requests,[])
  } finally {
    if(view)await act(async()=>view!.unmount())
    Object.assign(globalThis,prior);globalThis.IS_REACT_ACT_ENVIRONMENT=false
  }
})

// WEB-CONNECTION-1: a new public session must not present a previous server's cached workspace.
test('unconfigured public browser hides retained project data without rewriting its cache', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const prior = {window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,React:(globalThis as typeof globalThis & {React?:typeof React}).React}
  const storage = new MemoryStorage()
  const cached = createEmptyWorkspace()
  cached.projects.push({id:'private-project',name:'Private project from prior server',parentId:null,description:'',iconColor:'#123456',knowledgeCount:0,serviceCount:0,childCount:0,autoConfidence:0,lineage:['Private project from prior server']})
  cached.activeProjectId = 'private-project'
  const originalBytes = JSON.stringify(cached)
  storage.setItem(STORAGE_KEY, originalBytes)
  const requests:string[]=[]
  let store:ReturnType<typeof useStore>|undefined
  Object.assign(globalThis,{React,localStorage:storage,sessionStorage:new MemoryStorage(),
    window:{location:{hostname:'akashdubey.me'},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,setInterval(){throw Error('Unconfigured session must not poll')}},
    document:{body:{dataset:{},removeAttribute(){},setAttribute(){}}},
    fetch:async(input:string|URL|Request)=>{requests.push(String(input));throw Error('No server selected')},
  })
  function Capture(){store=useStore();return null}
  let view:ReactTestRenderer|undefined
  try {
    await act(async()=>{view=create(<StoreProvider><Capture/></StoreProvider>);await new Promise(resolve=>setTimeout(resolve,30))})
    assert.equal(store?.connection.mode,'unconfigured')
    assert.deepEqual(store?.data.projects,[])
    assert.equal(store?.data.activeProjectId,'')
    assert.equal(JSON.stringify(store?.data).includes('Private project from prior server'),false)
    await act(async()=>{store!.setTheme('light')})
    assert.equal(storage.getItem(STORAGE_KEY),originalBytes,'prior workspace bytes stay recoverable')
    assert.deepEqual(requests,[])
  } finally {
    if(view)await act(async()=>view!.unmount())
    Object.assign(globalThis,prior);globalThis.IS_REACT_ACT_ENVIRONMENT=false
  }
})

// WEB-CONNECTION-1: intentional connections and desktop/local development keep their authority.
test('explicit server, desktop and loopback defaults remain available; session connection is retained', () => {
  for(const input of [
    {runtimeMode:'desktop' as const,browserHostname:'akashdubey.me'},
    {runtimeMode:'browser' as const,browserHostname:'localhost'},
    {runtimeMode:'browser' as const,browserHostname:'[::1]'},
    {runtimeMode:'browser' as const,browserHostname:'akashdubey.me',configuredUrl:'https://runtime.example'},
  ])assert.equal(connectionProfileForRuntime(input).mode,'remote')
  const storage=new MemoryStorage()
  const chosen={id:'chosen',name:'Chosen server',mode:'remote' as const,baseUrl:'https://runtime.example',allowMockFallback:false}
  saveSessionConnection(chosen,storage)
  const fallback=connectionProfileForRuntime({runtimeMode:'browser',browserHostname:'akashdubey.me'})
  assert.equal(loadSessionConnection(fallback,storage).baseUrl,'https://runtime.example')
  assert.equal(loadSessionConnection(fallback,storage).mode,'remote')
})
