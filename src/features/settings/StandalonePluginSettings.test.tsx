import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {StandalonePluginSettings} from './StandalonePluginSettings'
import {StandalonePluginSettingsClient} from '../../services/standalonePluginSettings'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const contract={schema_version:'opensaddle.ui-settings.v1',purpose:'presentation',settings_version:1,scopes:['user','team'],values_schema:{type:'object',additionalProperties:false,maxProperties:1,properties:{card_limit:{type:'number',minimum:1,maximum:100}}},defaults:{card_limit:20},labels:{card_limit:'Maximum cards'}}
const item={settings_key:'a'.repeat(64),application_id:'board',package_ref:{package_id:'org.example.board',version:'1.0.0',manifest_digest:'b'.repeat(64)},contract,layer:{scope:'user',revision:2,can_write:true,values:{card_limit:30}}}
// STANDALONE-PLUGIN-EDITOR: no Project dependency or executable plugin surface.
test('personal form saves standalone revisions, retains a conflict draft and hides on account change',async t=>{
 let user='owner',state=structuredClone(item),conflict=false;const writes:any[]=[]
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{const path=new URL(String(input)).pathname;assert.ok(path.startsWith('/api/v2/settings/plugins'));assert.ok(!path.includes('/projects/'));if(user!=='owner')return Response.json({schema_version:'opensaddle.standalone-plugin-settings.v1',scope:'user',team_id:null,viewer_subject:user,items:[]});if(init?.method==='PUT'){writes.push(JSON.parse(String(init.body)));if(conflict)return Response.json({}, {status:409});assert.equal(writes.at(-1).expected_revision,state.layer.revision);state.layer.values=writes.at(-1).values;state.layer.revision++}return Response.json({schema_version:'opensaddle.standalone-plugin-settings.v1',scope:'user',team_id:null,viewer_subject:user,items:[state]})})
 const client=new StandalonePluginSettingsClient('http://core',()=>user);let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<StandalonePluginSettings client={client}/>);await flush()})
 const field=()=>view.root.findByProps({'aria-label':'Maximum cards'})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 assert.equal(view.root.findAllByType('iframe').length,0)
 assert.equal(field().props.value,'30')
 await act(async()=>field().props.onChange({target:{value:'35'}}))
 await act(async()=>{button('Save plugin settings').props.onClick();await flush()})
 assert.deepEqual(writes[0],{expected_revision:2,values:{card_limit:35}})
 conflict=true
 await act(async()=>field().props.onChange({target:{value:'40'}}))
 await act(async()=>{button('Save plugin settings').props.onClick();await flush()})
 assert.equal(field().props.value,'40');assert.equal(button('Save plugin settings').props.disabled,true)
 assert.match(JSON.stringify(view.toJSON()),/Discard your draft/)
 user='other';await act(async()=>{view.update(<StandalonePluginSettings client={client}/>);await flush()})
 assert.equal(view.root.findAllByType('fieldset').length,0)
 assert.match(JSON.stringify(view.toJSON()),/No saved plugin defaults/)
})

test('team form uses explicit Team route, respects read-only role and rejects substituted directory identity',async t=>{
 let writable=false,wrongTeam=false
 t.mock.method(globalThis,'fetch',async(input:unknown)=>{assert.equal(new URL(String(input)).pathname,'/api/v2/teams/T%2F1/settings/plugins');return Response.json({schema_version:'opensaddle.standalone-plugin-settings.v1',scope:'team',team_id:wrongTeam?'OTHER':'T/1',viewer_subject:'member',items:[{...item,layer:{...item.layer,scope:'team',can_write:writable}}]})})
 const client=new StandalonePluginSettingsClient('http://core',()=> 'member');let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<StandalonePluginSettings client={client} teamId="T/1"/>);await flush()})
 assert.equal(view.root.findByType('fieldset').props.disabled,true)
 assert.match(JSON.stringify(view.toJSON()),/read-only/)
 wrongTeam=true;writable=true
 await act(async()=>{view.root.findAllByType('button').find(node=>node.children.includes('Reload plugin preferences'))!.props.onClick();await flush()})
 assert.equal(view.root.findAllByType('fieldset').length,0)
 assert.match(JSON.stringify(view.toJSON()),/identity changed/)
})
