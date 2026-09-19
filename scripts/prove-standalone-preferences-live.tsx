/** Actual host forms and client against a disposable live Core; no browser claim. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {StandalonePluginSettings} from '../src/features/settings/StandalonePluginSettings'
import {StandalonePluginSettingsClient} from '../src/services/standalonePluginSettings'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const [metadataPath,receiptPath]=process.argv.slice(2)
assert.ok(metadataPath&&receiptPath,'Pass fixture.json and receipt path')
const meta=JSON.parse(readFileSync(metadataPath,'utf8')),base=meta.base_url
assert.equal(new URL(base).hostname,'127.0.0.1')
const owner=new StandalonePluginSettingsClient(base,()=> 'owner'),member=new StandalonePluginSettingsClient(base,()=> 'member')
const reference={...meta.package_ref,application_id:meta.application_id}
const checks:string[]=[]
let view:ReactTestRenderer|undefined
const until=async(check:()=>boolean)=>{for(let i=0;i<150&&!check();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))});assert.ok(check(),'host form did not reach expected state')}
try{
 for(const teamId of [undefined,meta.team_id]){
  assert.deepEqual(await owner.list(teamId),[])
  await act(async()=>{view=create(<StandalonePluginSettings client={owner} teamId={teamId}/>)})
  await until(()=>view!.root.findAllByType('form').length===1)
  for(const [label,value] of [['Package ID',reference.package_id],['Package version',reference.version],['Manifest digest',reference.manifest_digest],['Application ID',reference.application_id]])await act(async()=>view!.root.findByProps({'aria-label':label}).props.onChange({target:{value}}))
  await act(async()=>view!.root.findByType('form').props.onSubmit({preventDefault(){}}))
  await until(()=>view!.root.findAllByProps({'aria-label':'Maximum cards'}).length===1)
  await until(()=>view!.root.findByProps({'aria-label':'Maximum cards'}).props.value==='20')
  await act(async()=>view!.root.findAllByType('input').find(node=>node.props.type==='checkbox')!.props.onChange({target:{checked:true}}))
  assert.equal(view!.root.findByProps({'aria-label':'Maximum cards'}).props.disabled,false)
  await act(async()=>view!.root.findByProps({'aria-label':'Maximum cards'}).props.onChange({target:{value:teamId?'42':'31'}}))
  await act(async()=>view!.root.findAllByType('button').find(node=>node.children.includes('Save plugin settings'))!.props.onClick())
  await until(()=>view!.root.findByType('fieldset').props.disabled===false&&view!.root.findAllByType('button').find(node=>node.children.includes('Discard changes'))!.props.disabled===true)
  const fresh=new StandalonePluginSettingsClient(base,()=> 'owner'),rows=await fresh.list(teamId)
  assert.equal(rows.length,1);assert.equal(rows[0].layer.values.card_limit,teamId?42:31);assert.equal(rows[0].layer.revision,2)
  await assert.rejects(owner.enroll(reference,teamId),/changed/)
  assert.equal((await fresh.list(teamId))[0].layer.revision,2)
  checks.push(`${teamId?'Team':'Personal'} host setup, edit, fresh-client persistence and duplicate rejection`)
  await act(async()=>{view!.unmount();view=undefined})
 }
 assert.deepEqual(await member.list(),[])
 const shared=(await member.list(meta.team_id))[0];assert.equal(shared.layer.can_write,false);assert.equal(shared.layer.values.card_limit,42)
 await assert.rejects(member.editor(shared,meta.team_id).replace('',{} as any,'team',2,{card_limit:99}),/unavailable/)
 assert.equal((await owner.list(meta.team_id))[0].layer.values.card_limit,42)
 checks.push('Private personal defaults and readable, non-writable member Team defaults')
 const projects=await fetch(base+'/api/v2/projects',{headers:{'X-OpenSaddle-User':'owner'}}).then(response=>response.json());assert.deepEqual(projects.items,[])
 writeFileSync(receiptPath,JSON.stringify({checked_at:new Date().toISOString(),fixture:meta,checks,projects:0,scope:'Mounted production host forms and real HTTP/Core signed catalog. Development identity, not browser visuals or production auth.'},null,2)+'\n')
 console.log('Live standalone personal and Team settings walkthrough passed.')
}finally{if(view)await act(async()=>view!.unmount())}
