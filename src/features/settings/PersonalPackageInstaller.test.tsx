import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {PersonalPackageInstaller} from './PersonalPackageInstaller'
import {PersonalCatalogClient,publisherFingerprint} from '../../services/personalCatalog'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
// PERSONAL-INSTALLER-1: production UI and client; publisher HTTP is external.
test('file inspection never trusts or installs before explicit actions and exact response checks',async()=>{
 const original=globalThis.fetch,posts:string[]=[],key=btoa('\0'.repeat(32)),fingerprint=await publisherFingerprint(key)
 const upload={manifest:{package_id:'org.example.view',version:'1.0.0',publisher_id:'org.example',display_name:'Example view'},key_id:'key',signature_base64:'signature',files_base64:{}}
 let changed=false,installed=0,view:ReactTestRenderer|undefined
 globalThis.fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname
  assert.equal(new Headers(init?.headers).get('X-OpenSaddle-User'),'owner')
  if(init?.method==='POST'){
   posts.push(path)
   if(path.endsWith('/publishers'))return Response.json({publisher_id:'org.example',key_id:'key',fingerprint,revoked_at:null})
   return Response.json({code_loaded:false,package:{package_id:changed?'other':upload.manifest.package_id,version:'1.0.0',publisher_id:'org.example',key_id:'key',manifest_digest:'a'.repeat(64)}})
  }
  return Response.json({detail:'not found'},{status:404})
 }
 const client=new PersonalCatalogClient('https://core.example',()=> 'owner')
 const button=(name:string)=>view!.root.findAllByType('button').find(node=>node.children.join('')===name)!
 try{
  await act(async()=>{view=create(<PersonalPackageInstaller client={client} onInstalled={()=>installed++}/> )})
  await act(async()=>{view!.root.findByProps({'aria-label':'Signed package JSON'}).props.onChange({target:{files:[{size:200,text:async()=>JSON.stringify(upload)}],value:'selected'}})})
  assert.deepEqual(posts,[]);assert.equal(button('Install package').props.disabled,true)
  await act(async()=>view!.root.findByProps({'aria-label':'Publisher public key'}).props.onChange({target:{value:key}}))
  await act(async()=>{button('Inspect key').props.onClick();await new Promise(resolve=>setTimeout(resolve,10))})
  assert.deepEqual(posts,[]);assert.match(JSON.stringify(view!.toJSON()),new RegExp(fingerprint))
  await act(async()=>button('Trust publisher key').props.onClick())
  assert.deepEqual(posts,['/api/v2/personal-runtime/catalog/publishers']);assert.equal(button('Install package').props.disabled,false)
  await act(async()=>button('Install package').props.onClick())
  assert.equal(installed,1);assert.match(JSON.stringify(view!.toJSON()),/Package installed/)
  changed=true
  await act(async()=>button('Install package').props.onClick())
  assert.equal(installed,1);assert.match(JSON.stringify(view!.toJSON()),/Exact package installation could not be confirmed/)
 }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})
