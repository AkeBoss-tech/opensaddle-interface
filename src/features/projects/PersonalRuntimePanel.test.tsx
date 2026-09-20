import assert from'node:assert/strict';import test from'node:test';import React from'react';import{act,create,type ReactTestRenderer}from'react-test-renderer';import{PersonalRuntimePanel,type PersonalRuntimeAuthority}from'./PersonalRuntimePanel';import {PersonalRuntimeClient,type PersonalRuntimeStatus} from '../../services/personalRuntime'
;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const value=(revision=3,lifecycle:PersonalRuntimeStatus['lifecycle']='running'):PersonalRuntimeStatus=>({installationId:'install',ownerSubject:'owner',project:{projectId:'P',sourceId:'source',sourceRevision:'rev',sourceDigest:'digest'},lifecycle,unresolvedAssignments:[],workers:[{workerId:'worker',adapterId:'codex-app-server',state:lifecycle==='running'?'ready':'stopped',readiness:{ready:lifecycle==='running',reason:lifecycle==='running'?undefined:'worker_stopped'}}],knowledge:{available:false,reason:'authorized_packet_provider_unavailable'},stateRevision:revision,updatedAt:'2026-09-08T01:00:00Z'})
async function mount(authority?:PersonalRuntimeAuthority){let view!:ReactTestRenderer;await act(async()=>{view=create(<PersonalRuntimePanel authority={authority}/>);await Promise.resolve()});return view}
test('mounted personal runtime is explicitly unsupported without negotiated authority',async()=>{const view=await mount();assert.match(JSON.stringify(view.toJSON()),/does not advertise/);assert.equal(view.root.findAllByType('button').length,0)})
test('mounted lifecycle action uses displayed revision and shows authoritative unavailable knowledge',async()=>{let call:unknown;const authority:PersonalRuntimeAuthority={status:async()=>value(),lifecycle:async(action,revision)=>{call={action,revision};return value(4,'draining')}};const view=await mount(authority);assert.match(JSON.stringify(view.toJSON()),/authorized_packet_provider_unavailable/);const drain=view.root.findAllByType('button').find(node=>node.children.includes('Drain'))!;await act(async()=>{await drain.props.onClick();await Promise.resolve()});assert.deepEqual(call,{action:'drain',revision:3});assert.match(JSON.stringify(view.toJSON()),/draining/)})
test('revision conflict retains prior state and refreshes authority',async()=>{let reads=0;const authority:PersonalRuntimeAuthority={status:async()=>{reads++;return value(reads===1?3:4,'running')},lifecycle:async()=>{throw Error('personal_runtime_revision_conflict')}};const view=await mount(authority);const drain=view.root.findAllByType('button').find(node=>node.children.includes('Drain'))!;await act(async()=>{await drain.props.onClick();await Promise.resolve()});const text=JSON.stringify(view.toJSON());assert.match(text,/personal_runtime_revision_conflict/);assert.match(text,/running/);assert.equal(reads,2)})
test('failed refresh after mutation denial retains previously rendered state',async()=>{let reads=0;const authority:PersonalRuntimeAuthority={status:async()=>{reads++;if(reads>1)throw Error('refresh unavailable');return value()},lifecycle:async()=>{throw Error('owner required')}};const view=await mount(authority);const drain=view.root.findAllByType('button').find(node=>node.children.includes('Drain'))!;await act(async()=>{await drain.props.onClick();await Promise.resolve()});const text=JSON.stringify(view.toJSON());assert.match(text,/owner required/);assert.match(text,/running.*authorized_packet_provider_unavailable/s)})
test('late lifecycle response from replaced authority cannot overwrite current runtime',async()=>{let resolve!:(status:PersonalRuntimeStatus)=>void;const old:PersonalRuntimeAuthority={status:async()=>value(3,'running'),lifecycle:async()=>new Promise(next=>{resolve=next})},current:PersonalRuntimeAuthority={status:async()=>({...value(8,'stopped'),project:{...value().project,projectId:'Q'}}),lifecycle:async()=>{throw Error('unused')}};const view=await mount(old);const drain=view.root.findAllByType('button').find(node=>node.children.includes('Drain'))!;await act(async()=>{drain.props.onClick();await Promise.resolve()});await act(async()=>{view.update(<PersonalRuntimePanel authority={current}/>);await Promise.resolve()});await act(async()=>{resolve(value(4,'draining'));await Promise.resolve()});const text=JSON.stringify(view.toJSON());assert.match(text,/Q/);assert.match(text,/stopped/);assert.doesNotMatch(text,/draining/)})
test('intervention-required runtime names affected Run and blocks start',async()=>{const blocked={...value(9,'intervention_required'),unresolvedAssignments:[{runId:'run-9',leaseEpoch:4,leaseExpiresAt:'2026-09-08T03:00:00Z'}]};const view=await mount({status:async()=>blocked,lifecycle:async()=>{throw Error('must not mutate')}});const text=JSON.stringify(view.toJSON());assert.match(text,/run-9 lease 4/);assert.match(text,/resolve interrupted execution/);const start=view.root.findAllByType('button').find(node=>node.children.includes('Start'))!;assert.equal(start.props.disabled,true);const stop=view.root.findAllByType('button').find(node=>node.children.includes('Stop worker'))!;assert.equal(stop.props.disabled,false)})

test('post-crash orphaned worker projection stays readable and requires Core-verified cleanup', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{method: string; body?: unknown}> = []
  const projection = {
    schema_version: 'opensaddle.personal-runtime.v1', service: 'opensaddle', mode: 'local',
    installation_id: 'installation-1', owner_subject: 'owner',
    project: {project_id: 'P', registry: 'canonical_project_service', source_id: 'source', source_revision: 'rev', source_digest: 'digest', content_attested: false},
    lifecycle: 'intervention_required', unresolved_assignments: [],
    workers: [{worker_id: 'worker', adapter_id: 'codex-app-server', state: 'intervention_required', pid: null,
      readiness: {ready: false, reason: 'worker_reconciliation_required', observed_at: null, expires_at: null}}],
    knowledge: {available: true, reason: null}, state_revision: 0, updated_at: '2026-09-20T01:33:44Z',
  }
  globalThis.fetch = async (input, init) => {
    requests.push({method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined})
    if (init?.method === 'POST') return Response.json({detail: {code: 'personal_runtime_recovery_invalid'}}, {status: 409})
    return Response.json(projection)
  }
  try {
    const view = await mount(new PersonalRuntimeClient('http://127.0.0.1:1', () => 'owner'))
    let rendered = JSON.stringify(view.toJSON())
    assert.match(rendered, /worker_reconciliation_required/)
    assert.match(rendered, /prior worker.*may still be running/i)
    const start = view.root.findAllByType('button').find(node => node.children.includes('Start'))!
    assert.equal(start.props.disabled, true)
    const stop = view.root.findAllByType('button').find(node => node.children.includes('Stop worker'))!
    assert.equal(stop.props.disabled, true)
    const verify = view.root.findAllByType('button').find(node => node.children.includes('Verify cleanup and start'))!
    await act(async () => {await verify.props.onClick(); await Promise.resolve()})
    rendered = JSON.stringify(view.toJSON())
    assert.match(rendered, /personal_runtime_recovery_invalid/)
    assert.match(rendered, /intervention_required/)
    assert.deepEqual(requests.find(request => request.method === 'POST')?.body, {action: 'start', expected_revision: 0})
  } finally {globalThis.fetch = originalFetch}
})
