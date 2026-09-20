import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act, create, type ReactTestRenderer} from 'react-test-renderer'
import {StoreProvider, useStore} from './store'
import {createEmptyWorkspace} from './emptyWorkspace'
import {STORAGE_KEY} from './seed'

// DESKTOP-RESPONSIVENESS-1: selecting work and streamed deltas retain unrelated history.
test('navigation and streaming do not copy retained history or synchronously save every update', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const prior={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,React:(globalThis as typeof globalThis & {React?:typeof React}).React}
  const data=createEmptyWorkspace()
  data.messages=Array.from({length:10000},(_,i)=>({id:`m${i}`,chatId:'history',role:'assistant' as const,text:'retained evidence '.repeat(100),createdAt:i}))
  const listeners=new Map<string,()=>void>()
  const values=new Map([[STORAGE_KEY,JSON.stringify(data)]])
  let writes=0
  const storage={get length(){return values.size},getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{writes++;values.set(k,v)},removeItem:(k:string)=>values.delete(k),key:(i:number)=>[...values.keys()][i]??null,clear:()=>values.clear()}
  Object.assign(globalThis,{React,localStorage:storage,sessionStorage:{...storage,getItem:()=>null,setItem:()=>{}},window:{addEventListener(name:string,callback:()=>void){listeners.set(name,callback)},removeEventListener(name:string){listeners.delete(name)},setTimeout,clearTimeout,setInterval,clearInterval},document:{body:{dataset:{},removeAttribute(){},setAttribute(){}}},fetch:async()=>new Response('{}',{status:404})})
  let store!:ReturnType<typeof useStore>
  function Capture(){store=useStore();return null}
  let view:ReactTestRenderer|undefined
  try{
    await act(async()=>{view=create(<StoreProvider><Capture/></StoreProvider>);await new Promise(resolve=>setTimeout(resolve,20))})
    const before=store.data
    const beforeWrites=writes
    await act(async()=>store.setActiveProject('next'))
    assert.equal(store.data.messages===before.messages,true,'project navigation must retain the history array')
    await act(async()=>store.setActiveChat('history'))
    assert.equal(store.data.messages===before.messages,true,'task navigation must retain the history array')
    await act(async()=>store.updateMessage('m0',{text:'updated'}))
    assert.equal(store.data.messages[1]===before.messages[1],true,'stream updates must retain unrelated messages')
    assert.equal(before.messages[0].text,'retained evidence '.repeat(100),'previous state stays immutable')
    assert.equal(store.data.messages[0].text,'updated')
    assert.equal(writes,beforeWrites,'navigation and streaming must not immediately serialize the workspace')
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100))})
    assert.equal(JSON.parse(values.get(STORAGE_KEY)!).messages[0].text,'updated','bounded deferred save persists latest state')
    await act(async()=>store.updateMessage('m0',{text:'saved on close'}))
    listeners.get('pagehide')!()
    assert.equal(JSON.parse(values.get(STORAGE_KEY)!).messages[0].text,'saved on close','normal close flushes pending state')
  }finally{if(view)await act(async()=>view!.unmount());Object.assign(globalThis,prior);globalThis.IS_REACT_ACT_ENVIRONMENT=false}
})
