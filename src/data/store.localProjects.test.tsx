import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createEmptyWorkspace } from './emptyWorkspace'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
import { hydrateRegisteredLocalProjects, StoreProvider, useStore } from './store'

// LOCAL-PROJECT-EMPTY-START-1: an authoritative registration becomes the selected Project without sample neighbors.
test('authoritative local registration hydrates and selects the fresh workspace', () => {
  const hydrated = hydrateRegisteredLocalProjects(createEmptyWorkspace(), [{ projectId: 'stale-fixture', root: '/private/tmp/gone', createdAt: 0 }, {
    projectId: 'opensaddle-local',
    root: '/Users/akashdubey/Documents/CodingProjects/opensaddle',
    createdAt: 1,
  }], 'codex')
  assert.equal(hydrated.projects.length, 2)
  assert.equal(hydrated.projects[1].id, 'opensaddle-local')
  assert.equal(hydrated.projects[1].local?.rootPath, '/Users/akashdubey/Documents/CodingProjects/opensaddle')
  assert.equal(hydrated.activeProjectId, 'opensaddle-local')
  assert.deepEqual(hydrated.members, [])
  assert.deepEqual(hydrated.chats, [])
})

// LOCAL-PROJECT-EMPTY-START-1: the mounted store loads only the registered Project on startup.
test('mounted fresh workspace selects the Project returned by the local registry', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const local = new MemoryStorage()
  const session = new MemoryStorage()
  const prior = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, React: (globalThis as typeof globalThis & { React?: typeof React }).React }
  const browserWindow = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval }
  Object.assign(globalThis, {
    localStorage: local, sessionStorage: session, window: browserWindow, React,
    document: { body: { dataset: {}, removeAttribute() {}, setAttribute() {} } },
    fetch: async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/health')) return Response.json({ mode: 'local', capabilities: ['projects'] })
      if (url.endsWith('/api/projects')) return Response.json({ projects: [{ project_id: 'opensaddle', root: '/Users/akashdubey/Documents/CodingProjects/opensaddle', created_at: '2026-09-07T00:00:00Z' }] })
      return new Response('{}', { status: 404 })
    },
  })
  function Projection() {
    const { data } = useStore()
    return React.createElement('p', null, `${data.activeProjectId}|${data.projects.map((project) => project.name).join(',')}|${data.members.length}|${data.chats.length}`)
  }
  let view!: ReactTestRenderer
  try {
    await act(async () => {
      view = create(React.createElement(StoreProvider, null, React.createElement(Projection)))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    assert.equal(view.toJSON() && JSON.stringify(view.toJSON()), JSON.stringify({ type: 'p', props: {}, children: ['opensaddle|opensaddle|0|0'] }))
    await act(async () => view.unmount())
  } finally {
    Object.assign(globalThis, prior)
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  }
})

// LOCAL-PROJECT-EMPTY-START-1: failed remote hydration cannot overwrite authority with local empty state.
test('mounted failed workspace load sends no replacement PUT', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const prior = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, React: (globalThis as typeof globalThis & { React?: typeof React }).React }
  let puts = 0
  Object.assign(globalThis, {
    localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(),
    window: { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval }, React,
    document: { body: { dataset: {}, removeAttribute() {}, setAttribute() {} } },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/health')) return Response.json({ mode: 'company', capabilities: ['workspace'] })
      if (url.endsWith('/api/v2/capabilities')) return new Response('{}', { status: 404 })
      if (url.endsWith('/api/workspace') && init?.method === 'PUT') { puts += 1; return Response.json({ updatedAt: 1, documents: 0 }) }
      if (url.endsWith('/api/workspace')) return new Response('{"error":"unavailable"}', { status: 500, headers: { 'Content-Type': 'application/json' } })
      return new Response('{}', { status: 404 })
    },
  })
  let view!: ReactTestRenderer
  try {
    await act(async () => {
      view = create(React.createElement(StoreProvider, null, React.createElement('p', null, 'mounted')))
      await new Promise((resolve) => setTimeout(resolve, 550))
    })
    assert.equal(puts, 0)
    await act(async () => view.unmount())
  } finally {
    Object.assign(globalThis, prior)
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  }
})

test('desktop bootstrap exposes pending adoption before discovery may prompt', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const local = new MemoryStorage(), session = new MemoryStorage()
  const prior = { localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,React:(globalThis as typeof globalThis & {React?:typeof React}).React }
  let reject!:(reason:Error)=>void
  Object.assign(globalThis,{
    localStorage:local,sessionStorage:session,React,
    window:{setTimeout,clearTimeout,setInterval,clearInterval,addEventListener(){},removeEventListener(){},opensaddleDesktop:true,opensaddle:{adoptPersonalRuntime:()=>new Promise((_resolve,no)=>{reject=no})}},
    document:{body:{dataset:{},removeAttribute(){},setAttribute(){}}},
    fetch:async()=>new Response('{}',{status:404}),
  })
  function Projection(){const {runtimeAdoptionPending}=useStore();return React.createElement('p',null,runtimeAdoptionPending?'adoption pending':'adoption settled')}
  let view!:ReactTestRenderer
  try{
    await act(async()=>{view=create(React.createElement(StoreProvider,null,React.createElement(Projection)));await new Promise(resolve=>setTimeout(resolve,20))})
    assert.match(JSON.stringify(view.toJSON()),/adoption pending/)
    await act(async()=>{reject(Error('no existing runtime'));await new Promise(resolve=>setTimeout(resolve,20))})
    assert.match(JSON.stringify(view.toJSON()),/adoption settled/)
    await act(async()=>view.unmount())
  }finally{Object.assign(globalThis,prior);globalThis.IS_REACT_ACT_ENVIRONMENT=false}
})
