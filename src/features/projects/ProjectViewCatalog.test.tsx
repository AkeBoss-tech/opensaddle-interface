import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {ProjectViewCatalog} from './ProjectViewCatalog'
import {RemoteMalleableShellClient} from '../../services/remoteMalleableShell'
import {PresentationSettingsClient} from '../../services/presentationSettings'
import type {ApplicationRendererCandidate,EnvironmentRevision} from '../../services/contracts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const d=(letter:string)=>letter.repeat(64)
const ref={package_id:'org.example.project-board',version:'1.0.0',manifest_digest:d('a')}
const source={authority:'opensaddle://extension-package',resource_type:'application-renderer',resource_id:'org.example.project-board/renderer.html',version:'1.0.0',digest:'sha256:'+d('b')}
const application={application_id:'project-board',version:1,definition_digest:d('c'),source_ref:source,package_ref:ref,instances:[{instance_id:'project-board-main',defaults:{density:'comfortable' as const,presentation:'document' as const,order:10}}]}
const ui={schema_version:'opensaddle.ui-contract.v1',mount_kind:'perspective',scope:'project',host_api_min:1,host_api_max:1,required_capabilities:['projection.project-runs.v1']}
function candidate():ApplicationRendererCandidate{return {application_id:'project-board',title:'Project board',package_id:ref.package_id,package_version:ref.version,manifest_digest:ref.manifest_digest,content_digest:d('b'),publisher_key_fingerprint:d('f'),input_schema:{$id:'opensaddle.project-tasks.v1'},descriptor:{ui_contract:ui},size_bytes:100,state_schema_version:1,state_max_bytes:8192,state_compatibility:{accepts_from_versions:[1]},state_schema:{type:'object',additionalProperties:false,maxProperties:0,properties:{}},state_migrations:[],available:{available:true,reason:null},enablement:null,activation:{desired:false,observed_health:'unavailable',receipt:null},environment_application:application}}
function environment(revision=0,selected=false):EnvironmentRevision{return {schema_version:'opensaddle.environment.v1',project_id:'P',revision,definition_digest:d(revision?'e':'d'),definition:{commands:[],bindings:[],services:[],packages:selected?[ref]:[],applications:selected?[{...application,package_ref:{manifest_digest:ref.manifest_digest,package_id:ref.package_id,version:ref.version}}]:[]},changed_by:null,reason:null,parent_revision:revision?0:null,created_at:null}}
// PROJECT-VIEW-ACTIVATION: real Interface HTTP clients, mounted Project UI, only the Core transport is simulated.
test('signed Project view is reviewed, enabled, previewed, selected and explicitly disabled',async()=>{
 const original=globalThis.fetch,calls:string[]=[],row=candidate(),settings={scope:'user_project',project_id:'P',owner_subject:'owner',revision:0,can_write:true,values:{} as Record<string,string>}
 let env=environment(),view:ReactTestRenderer|undefined
 globalThis.fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname,body=init?.body?JSON.parse(String(init.body)):undefined,method=init?.method??'GET';calls.push(`${method} ${path}`)
  assert.equal(new Headers(init?.headers).get('X-OpenSaddle-User'),'owner')
  if(path.endsWith('/application-renderer-candidates')&&method==='GET')return Response.json({project_id:'P',candidates:[row]})
  if(path.endsWith('/application-renderer-candidates/'+ref.package_id+'/enable')){assert.equal(body.manifest_digest,ref.manifest_digest);assert.equal(body.expected_enablement_revision,row.enablement?.revision??null);row.enablement={status:'enabled',version:ref.version,revision:(row.enablement?.revision??0)+1};return Response.json({schema_version:'opensaddle.application-renderer-enablement.v1',project_id:'P',package_id:ref.package_id,package_version:ref.version,manifest_digest:ref.manifest_digest,enablement:row.enablement,activation:{desired:'enabled',observed_health:'unavailable',receipt:null}})}
  if(path.endsWith('/application-renderer-candidates/'+ref.package_id+'/disable')){assert.deepEqual(body,{version:ref.version,manifest_digest:ref.manifest_digest,expected_enablement_revision:1});row.enablement={status:'disabled',version:ref.version,revision:2};return Response.json({schema_version:'opensaddle.application-renderer-enablement.v1',project_id:'P',package_id:ref.package_id,package_version:ref.version,manifest_digest:ref.manifest_digest,enablement:row.enablement,activation:{desired:'disabled',observed_health:'unavailable',receipt:null},running_process_halted:false})}
  if(path.endsWith('/environment')&&method==='GET')return Response.json(env)
  if(path.endsWith('/environment/changes/preview')){assert.equal(row.enablement?.status,'enabled');assert.deepEqual(body.definition.applications[0].package_ref,ref);return Response.json({schema_version:'opensaddle.environment-preview.v1',project_id:'P',base_revision:env.revision,base_definition_digest:env.definition_digest,proposed_definition_digest:d('e'),diff:{commands:{added:[],removed:[]},bindings:{added:[],removed:[]},services:{added:[],removed:[]}},requirements:[],activatable:true,observed_service_health:{available:false,reason:'not observed'}})}
  if(path.endsWith('/environment/changes')&&method==='POST'){assert.equal(body.expected_revision,0);env=environment(1,true);return Response.json(env)}
  if(path.endsWith('/environment/reverts')&&method==='POST'){assert.deepEqual({expected_revision:body.expected_revision,target_revision:body.target_revision},{expected_revision:1,target_revision:0});env={...environment(2,false),definition_digest:d('d')};return Response.json(env)}
  if(path.endsWith('/application-renderers')&&method==='GET')return Response.json({project_id:'P',renderers:[{application_id:row.application_id,instance_id:'project-board-main',package_ref:ref,content_digest:d('b'),input_schema:row.input_schema,descriptor:row.descriptor,authority:'core',execution_trust:'trusted_signed_publisher'}]})
  if(path.endsWith('/settings/presentation/user_project')){if(method==='PUT'){assert.equal(body.expected_revision,settings.revision);settings.revision++;settings.values=body.values}return Response.json(settings)}
  return Response.json({detail:'unexpected request'},{status:404})
 }
 const button=(name:string)=>view!.root.findAllByType('button').find(node=>node.children.join('')===name)!
 try{
  await act(async()=>{view=create(<MemoryRouter><ProjectViewCatalog projectId="P" client={new RemoteMalleableShellClient('https://core.example',()=> 'owner')} presentation={new PresentationSettingsClient('https://core.example',()=> 'owner')} installationAvailable/></MemoryRouter>);await flush()})
  assert.match(JSON.stringify(view.toJSON()),/Publisher key fingerprint/)
  assert.equal(calls.some(value=>value.includes('/enable')),false)
  await act(async()=>{button('Enable and preview').props.onClick();await flush()})
  assert.equal(calls.some(value=>value.includes('/enable')),true)
  assert.equal(calls.some(value=>value.endsWith('/environment/changes')),false)
  assert.match(JSON.stringify(view.toJSON()),/Review Project activation/)
  const previewedEnvironment=env
  env={...env,revision:99,definition_digest:d('9')}
  await act(async()=>{button('Apply and use this view').props.onClick();await flush()})
  assert.equal(calls.some(value=>value.endsWith('/environment/changes')),false,'stale environment never reaches apply')
  assert.match(JSON.stringify(view.toJSON()),/Project configuration changed/)
  env=previewedEnvironment
  await act(async()=>{button('Enable and preview').props.onClick();await flush()})
  await act(async()=>{button('Apply and use this view').props.onClick();await flush()})
  assert.equal(settings.values.perspective,'plugin.project-board')
  assert.equal(env.revision,1)
  assert.ok(button('Use this view'),'configured signed view remains discoverable despite canonical JSON key ordering')
  await act(async()=>{button('Disable exact package').props.onClick();await flush()})
  assert.equal(row.enablement?.status,'disabled')
  assert.equal(settings.values.perspective,'plugin.project-board','disable preserves preference for fallback')
  const applied=calls.filter(value=>value.endsWith('/environment/changes')).length
  await act(async()=>{button('Re-enable exact package').props.onClick();await flush()})
  assert.equal(row.enablement?.status,'enabled')
  assert.equal(calls.filter(value=>value.endsWith('/environment/changes')).length,applied,'re-enable keeps existing exact Project configuration')
  assert.ok(button('Use this view'))
  await act(async()=>{button('Switch my workspace to Dialogue').props.onClick();await flush()})
  assert.equal(settings.values.perspective,'dialogue')
  await act(async()=>{button('Restore previous Project configuration').props.onClick();await flush()})
  assert.equal(env.revision,2)
  assert.equal(env.definition.applications?.length,0)
 }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})
