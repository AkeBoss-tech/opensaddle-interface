import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { FactoryStartSurface } from './FactoryStartPage'
import { FactoryAcceptancePanel } from './FactoryAcceptancePanel'
import type { FactoryCodingClient, FactoryPlan } from '../../services/factoryCoding'
import type { JourneyAuthority } from '../onboarding/ConnectedJourneySurface'
import type { CodingResultAuthority } from '../../services/codingResultReview'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true

const h=(char:string)=>char.repeat(64)
const spec={schema_version:'opensaddle.coding-task.v1' as const,allowed_paths:['src/widget.ts'],verification_commands:[['npm','test']]}
const blueprint={contributionId:'sample/feature',packageId:'sample',packageVersion:'1',manifestDigest:h('a'),goalTemplate:'Build {feature}',acceptanceTemplate:['{feature} tests pass']}
const definition={factoryId:'factory_one',projectId:'P',version:1,name:'Widget',blueprintId:'sample/feature',packageId:'sample',packageVersion:'1',manifestDigest:h('a'),parameterDefaults:{feature:'widget'},codingTask:spec,blueprintCurrentlyEnabled:true}
const plan:FactoryPlan={factoryId:'factory_one',factoryVersion:1,projectId:'P',compileDigest:h('d'),manifestDigest:h('a'),parameters:{feature:'widget'},source:{sourceId:'src_123456',revision:'main@abc',digest:h('c')},objective:'Build widget',criteria:[{criterionId:'acceptance_1',criterion:'widget tests pass'}],task:'Build widget',adapterId:'codex-app-server',codingTask:spec,scopes:['repository:read','repository:write'],adapterVersion:'app-server-v1',adapterConfigDigest:h('b')}
const snapshot:JourneyAuthority['snapshot']=async()=>({projectId:'P',members:[],workers:[],canManage:true,sources:[{sourceId:'src_123456',label:'Repository source'}],nativeAdapters:[{workerId:'worker_one',adapterId:'codex-app-server',sourceId:'src_123456',ready:true,revision:'main@abc',digest:h('c'),executableState:'installed',authenticationState:'authenticated',protocolState:'compatible',workspaceState:'configured',observedAt:'now',expiresAt:'later',reportedAt:'now'}]})
const text=(node:any):string=>typeof node==='string'?node:(node.children??[]).map(text).join('')
const button=(view:ReactTestRenderer,label:string)=>view.root.findAllByType('button').find(node=>text(node)===label)

test('FACTORY-UI-1: mounted task journey requires preview, exact Goal preparation, and a separate launch click',async()=>{
  const calls:string[]=[];let launched=''
  const client={identity:()=> 'owner',configuredWorkerId:'worker_one',adapterBinding:{adapter_id:'codex-app-server',adapter_version:'app-server-v1',adapter_config_digest:h('b')},blueprints:async()=>[blueprint],definitions:async()=>[definition],preview:async()=>{calls.push('preview');return plan},prepare:async()=>{calls.push('prepare');return{preparationId:'fgprep_one',goalId:'goal_one',goalVersion:1,goalRevision:0,compileDigest:h('d')}},launch:async()=>{calls.push('launch');return'run_one'}} as unknown as FactoryCodingClient
  const journey={snapshot} as JourneyAuthority
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<MemoryRouter><FactoryStartSurface projectId="P" client={client} journey={journey} onLaunched={id=>{launched=id}}/></MemoryRouter>);await new Promise(resolve=>setImmediate(resolve))})
  assert.deepEqual(calls,[])
  const select=view.root.findAllByType('select').find(node=>node.props.value==='')!
  await act(async()=>select.props.onChange({target:{value:'factory_one@1'}}))
  assert.match(text(view.toJSON()),/Repository source.*src\/widget.ts.*npm test/s)
  await act(async()=>button(view,'Compile exact preview')!.props.onClick())
  assert.deepEqual(calls,['preview'])
  assert.match(text(view.toJSON()),/Build widget.*widget tests pass.*main@abc.*repository:read/s)
  assert.equal(button(view,'Launch this reviewed Run once'),undefined)
  await act(async()=>button(view,'Prepare this exact Goal')!.props.onClick())
  assert.deepEqual(calls,['preview','prepare'])
  await act(async()=>button(view,'Launch this reviewed Run once')!.props.onClick())
  assert.deepEqual(calls,['preview','prepare','launch']);assert.equal(launched,'run_one')
  await act(async()=>view.unmount())
})

test('FACTORY-UI-1: disabled pinned blueprint prevents preview and Run submission',async()=>{
  let calls=0
  const client={identity:()=> 'owner',configuredWorkerId:'worker_one',blueprints:async()=>[blueprint],definitions:async()=>[{...definition,blueprintCurrentlyEnabled:false}],preview:async()=>{calls++;return plan}} as unknown as FactoryCodingClient
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<MemoryRouter><FactoryStartSurface projectId="P" client={client} journey={{snapshot} as JourneyAuthority} onLaunched={()=>{throw Error('must not launch')}}/></MemoryRouter>);await new Promise(resolve=>setImmediate(resolve))})
  const select=view.root.findAllByType('select').find(node=>node.props.value==='')!
  await act(async()=>select.props.onChange({target:{value:'factory_one@1'}}))
  assert.match(text(view.toJSON()),/signed blueprint version is no longer enabled/)
  assert.equal(button(view,'Compile exact preview')?.props.disabled,true)
  assert.equal(calls,0)
  await act(async()=>view.unmount())
})

test('FACTORY-UI-1: an edited parameter discards an in-flight older preview',async()=>{
  let release!:(value:FactoryPlan)=>void
  const client={identity:()=> 'owner',configuredWorkerId:'worker_one',blueprints:async()=>[blueprint],definitions:async()=>[definition],preview:async()=>new Promise<FactoryPlan>(resolve=>{release=resolve})} as unknown as FactoryCodingClient
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<MemoryRouter><FactoryStartSurface projectId="P" client={client} journey={{snapshot} as JourneyAuthority} onLaunched={()=>{throw Error('must not launch')}}/></MemoryRouter>);await new Promise(resolve=>setImmediate(resolve))})
  const select=view.root.findAllByType('select').find(node=>node.props.value==='')!
  await act(async()=>select.props.onChange({target:{value:'factory_one@1'}}))
  await act(async()=>button(view,'Compile exact preview')!.props.onClick())
  const parameter=view.root.findAllByType('input').find(node=>node.props.value==='widget')!
  await act(async()=>parameter.props.onChange({target:{value:'different'}}))
  await act(async()=>{release(plan);await new Promise(resolve=>setImmediate(resolve))})
  assert.doesNotMatch(text(view.toJSON()),/Review exact Factory plan/)
  assert.equal(button(view,'Prepare this exact Goal'),undefined)
  await act(async()=>view.unmount())
})

test('FACTORY-UI-1: human checks every fixed criterion only after exact coding artifact review',async()=>{
  let accepts=0
  const result={projectId:'P',runId:'run_one',artifactId:'art_one',artifactDigest:h('e'),review:{decision:'accepted',reviewedBy:'owner',reviewedAt:'now'},checksStatus:'passed',executionStatus:'completed',limitations:[]} as never
  const client={runBinding:async()=>({factoryId:'factory_one',factoryVersion:1,compileDigest:h('d'),goalId:'goal_one',criteria:[{criterionId:'acceptance_1',criterion:'widget tests pass'}]}),acceptance:async()=>null,accept:async()=>{accepts++;return{projectId:'P',runId:'run_one',compileDigest:h('d'),artifactId:'art_one',artifactDigest:h('e'),state:'applied',receiptDigest:h('f')}}} as unknown as FactoryCodingClient
  const codingResults={read:async()=>result,decide:async()=>{}} as CodingResultAuthority
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<FactoryAcceptancePanel client={client} codingResults={codingResults} projectId="P" runId="run_one"/>);await new Promise(resolve=>setImmediate(resolve))})
  assert.equal(button(view,'Accept exact Factory criteria and complete Goal')?.props.disabled,true)
  assert.equal(accepts,0)
  await act(async()=>view.root.findByType('input').props.onChange({target:{checked:true}}))
  assert.equal(button(view,'Accept exact Factory criteria and complete Goal')?.props.disabled,false)
  await act(async()=>button(view,'Accept exact Factory criteria and complete Goal')!.props.onClick())
  assert.equal(accepts,1);assert.match(text(view.toJSON()),/applied.*verified at Run time/s)
  await act(async()=>view.unmount())
})

test('FACTORY-UI-1: pending acceptance can retry the same exact reviewed evidence until applied',async()=>{
  let accepts=0
  const result={projectId:'P',runId:'run_one',artifactId:'art_one',artifactDigest:h('e'),review:{decision:'accepted',reviewedBy:'owner',reviewedAt:'now'},checksStatus:'passed',executionStatus:'completed',limitations:[]} as never
  const receipt={projectId:'P',runId:'run_one',compileDigest:h('d'),artifactId:'art_one',artifactDigest:h('e'),state:'pending' as const,receiptDigest:h('f')}
  const client={runBinding:async()=>({factoryId:'factory_one',factoryVersion:1,compileDigest:h('d'),goalId:'goal_one',criteria:[{criterionId:'acceptance_1',criterion:'widget tests pass'}]}),acceptance:async()=>receipt,accept:async(_project:string,_run:string,digest:string,evidence:typeof result,criteria:FactoryPlan['criteria'])=>{accepts++;assert.equal(digest,h('d'));assert.equal(evidence.artifactId,'art_one');assert.deepEqual(criteria,[{criterionId:'acceptance_1',criterion:'widget tests pass'}]);return{...receipt,state:'applied' as const}}} as unknown as FactoryCodingClient
  const codingResults={read:async()=>result,decide:async()=>{}} as CodingResultAuthority
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<FactoryAcceptancePanel client={client} codingResults={codingResults} projectId="P" runId="run_one"/>);await new Promise(resolve=>setImmediate(resolve))})
  assert.match(text(view.toJSON()),/acceptance is pending.*Core has not confirmed Goal completion/s)
  assert.equal(button(view,'Accept exact Factory criteria and complete Goal'),undefined)
  await act(async()=>button(view,'Retry exact Factory acceptance')!.props.onClick())
  assert.equal(accepts,1)
  assert.match(text(view.toJSON()),/acceptance applied.*verified at Run time/s)
  assert.equal(button(view,'Retry exact Factory acceptance'),undefined)
  await act(async()=>view.unmount())
})
