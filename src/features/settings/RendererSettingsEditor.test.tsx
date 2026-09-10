import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {ProjectRendererSettings} from './RendererSettingsEditor'
import {RendererSettingsClient} from '../../services/rendererSettings'
import type {ApplicationRendererDescriptor} from '../../services/contracts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const contract={schema_version:'opensaddle.ui-settings.v1',purpose:'presentation',settings_version:1,scopes:['project','user_project'],values_schema:{type:'object',additionalProperties:false,maxProperties:2,properties:{show_finished:{type:'boolean'},card_limit:{type:'number',minimum:1,maximum:100}}},defaults:{show_finished:true,card_limit:20},labels:{show_finished:'Show finished tasks',card_limit:'Maximum task cards'}}
const renderer={application_id:'board',instance_id:'main',package_ref:{package_id:'org.example.board',version:'1.0.0',manifest_digest:'a'.repeat(64)},authority:'core',execution_trust:'trusted_signed_publisher',descriptor:{settings_contract:contract}} as unknown as ApplicationRendererDescriptor
function response(projectValues:Record<string,unknown>={},privateValues:Record<string,unknown>={},revision=0){return {schema_version:'opensaddle.renderer-settings.v1',project_id:'P',application_id:'board',instance_id:'main',package_ref:renderer.package_ref,settings_version:1,contract,layers:[{scope:'project',revision:0,can_write:false,values:projectValues},{scope:'user_project',revision,can_write:true,values:privateValues}],effective:{values:{...contract.defaults,...projectValues,...privateValues},provenance:Object.fromEntries(Object.keys(contract.defaults).map(key=>[key,Object.hasOwn(privateValues,key)?'user_project':Object.hasOwn(projectValues,key)?'project':'default']))}}}
// RENDERER-SETTINGS-EDITOR: generated fields preserve authority, scope and revisions.
test('signed catalog forms save private overrides, inherit shared defaults, retain conflicts and respect read-only roles',async t=>{
 let state=response({card_limit:30}),conflict=false;const writes:any[]=[]
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{const url=new URL(String(input));assert.equal(url.searchParams.get('manifest_digest'),renderer.package_ref.manifest_digest);assert.equal(url.searchParams.get('instance_id'),'main');assert.equal(new Headers(init?.headers).get('X-OpenSaddle-User'),'member');if(init?.method==='PUT'){assert.equal(url.pathname,'/api/v2/projects/P/application-renderers/board/settings/user_project');const body=JSON.parse(String(init.body));writes.push(body);if(conflict)return Response.json({}, {status:409});assert.equal(body.expected_revision,state.layers[1].revision);state=response({card_limit:30},body.values,state.layers[1].revision+1)}return Response.json(state)})
 const client=new RendererSettingsClient('http://core',()=> 'member'),catalog={applicationRenderers:async()=>[renderer,{...renderer,application_id:'unsigned',execution_trust:'untrusted'} as ApplicationRendererDescriptor]}
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<ProjectRendererSettings client={client} catalog={catalog} projectId="P"/>);await flush()})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 const field=()=>view.root.findByProps({'aria-label':'Maximum task cards'})
 const scope=()=>view.root.findByProps({'aria-label':'Settings scope'})
 const toggle=()=>view.root.findAllByType('label').find(node=>node.children.includes('Override Maximum task cards'))!.findByType('input')
 assert.equal(view.root.findAllByType('details').length,1)
 assert.equal(field().props.value,'30');assert.equal(field().props.disabled,true)
 await act(async()=>toggle().props.onChange({target:{checked:true}}))
 await act(async()=>field().props.onChange({target:{value:'101'}}))
 assert.equal(button('Save plugin settings').props.disabled,true)
 await act(async()=>field().props.onChange({target:{value:'45'}}))
 await act(async()=>{button('Save plugin settings').props.onClick();await flush()})
 assert.deepEqual(writes[0],{expected_revision:0,values:{card_limit:45}})
 await act(async()=>scope().props.onChange({target:{value:'project'}}))
 assert.equal(view.root.findByType('fieldset').props.disabled,true)
 assert.match(JSON.stringify(view.toJSON()),/read-only for your role/)
 await act(async()=>scope().props.onChange({target:{value:'user_project'}}))
 await act(async()=>button('Use inherited values').props.onClick())
 await act(async()=>{button('Save plugin settings').props.onClick();await flush()})
 assert.deepEqual(writes[1],{expected_revision:1,values:{}});assert.equal(field().props.value,'30')
 conflict=true
 await act(async()=>toggle().props.onChange({target:{checked:true}}))
 await act(async()=>field().props.onChange({target:{value:'50'}}))
 await act(async()=>{button('Save plugin settings').props.onClick();await flush()})
 assert.equal(field().props.value,'50');assert.equal(button('Save plugin settings').props.disabled,true)
 assert.match(JSON.stringify(view.toJSON()),/draft is retained/)
 await act(async()=>button('Discard changes').props.onClick())
 await act(async()=>{button('Reload settings').props.onClick();await flush()})
 assert.equal(field().props.value,'30');assert.equal(toggle().props.checked,false)
})

test('client rejects changed package, forged resolution, invalid override and account changes',async t=>{
 let user='member',body:any=response(),change=false,requests=0
 t.mock.method(globalThis,'fetch',async()=>{requests++;if(change)user='other';return Response.json(body)})
 const client=new RendererSettingsClient('http://core',()=>user)
 assert.equal((await client.read('P',renderer)).effective.values.card_limit,20)
 body={...response(),package_ref:{...renderer.package_ref,version:'2.0.0'}}
 await assert.rejects(client.read('P',renderer),/identity or declaration/)
 body=response();body.effective.values.card_limit=99
 await assert.rejects(client.read('P',renderer),/resolution/)
 const before=requests;await assert.rejects(client.replace('P',renderer,'user_project',0,{card_limit:true}),/Invalid settings override/);assert.equal(requests,before)
 body=response();change=true;await assert.rejects(client.read('P',renderer),/identity or declaration/)
})

test('changing account hides a pending private settings response',async t=>{
 let user='first',resolveFirst!:(value:Response)=>void
 t.mock.method(globalThis,'fetch',async(_input:unknown,init?:RequestInit)=>new Headers(init?.headers).get('X-OpenSaddle-User')==='first'?new Promise<Response>(resolve=>{resolveFirst=resolve}):Response.json({}, {status:403}))
 const client=new RendererSettingsClient('http://core',()=>user),catalog={applicationRenderers:async()=>[renderer]}
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<ProjectRendererSettings client={client} catalog={catalog} projectId="P"/>);await flush()})
 user='second';await act(async()=>{view.update(<ProjectRendererSettings client={client} catalog={catalog} projectId="P"/>);await flush()})
 await act(async()=>{resolveFirst(Response.json(response({}, {card_limit:77})));await flush()})
 assert.equal(view.root.findAllByType('fieldset').length,0)
 assert.match(JSON.stringify(view.toJSON()),/unavailable for this account/)
})
