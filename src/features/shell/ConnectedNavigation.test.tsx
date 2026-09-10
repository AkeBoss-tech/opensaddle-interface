import React from 'react'
import assert from 'node:assert/strict'
import test from 'node:test'
import {registerHooks} from 'node:module'
import {renderToStaticMarkup} from 'react-dom/server'
import {MemoryRouter} from 'react-router-dom'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {StoreProvider} from '../../data/store'
import {SurfaceErrorBoundary} from '../../ui/SurfaceHost'

// CSS is exercised by browser evidence, not by the server-rendered navigation check.
const hooks=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {}',shortCircuit:true}:next(url,context)}})
const {ConnectedWorkspaceSidebar}=await import('./ConnectedWorkspace')
hooks.deregister()

// CONNECTED-SHELL-1
 test('connected sidebar exposes the active task route without fabricated Projects or mutation controls',()=>{
 const storage={getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null,clear(){}}
 const prior={localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,window:globalThis.window,React:(globalThis as any).React}
 Object.assign(globalThis,{localStorage:storage,sessionStorage:storage,window:{},React})
 try{
  const markup=renderToStaticMarkup(<MemoryRouter initialEntries={['/start']}><StoreProvider><ConnectedWorkspaceSidebar onAddProject={()=>{throw Error('render must not create a Project')}}/></StoreProvider></MemoryRouter>)
  assert.match(markup,/aria-label="Connected workflow"/)
  assert.match(markup,/<a[^>]*aria-current="page"[^>]*href="\/start"/)
  for(const path of ['/home','/work','/operations','/settings'])assert.ok(markup.includes(`href="${path}"`))
  assert.match(markup,/New task/)
  assert.match(markup,/Your projects will appear here/)
  assert.doesNotMatch(markup,/Add project|Corporate Base|DEMO DATA/)
 }finally{Object.assign(globalThis,prior)}
})

test('a mounted failing surface leaves shell navigation available and retry recovers',async()=>{
 let broken=true,retries=0,view!:ReactTestRenderer
 const previous=(globalThis as any).IS_REACT_ACT_ENVIRONMENT
 ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 function Surface(){if(broken)throw Error('controlled surface failure');return <p>Recovered task</p>}
 try{
  await act(async()=>{view=create(<><nav aria-label="Workspace">Home</nav><SurfaceErrorBoundary onRetry={()=>{broken=false;retries++}}><Surface/></SurfaceErrorBoundary></>)})
  assert.equal(view.root.findByType('nav').props['aria-label'],'Workspace')
  assert.equal(view.root.findByProps({role:'alert'}).type,'section')
  await act(async()=>view.root.findByType('button').props.onClick())
  assert.equal(retries,1)
  assert.match(JSON.stringify(view.toJSON()),/Recovered task/)
  assert.equal(view.root.findAllByProps({role:'alert'}).length,0)
 }finally{if(view)await act(async()=>view.unmount());(globalThis as any).IS_REACT_ACT_ENVIRONMENT=previous}
})
