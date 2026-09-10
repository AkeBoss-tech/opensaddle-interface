import assert from 'node:assert/strict'
import test from 'node:test'
import {ProjectDirectoryClient} from './projectDirectory'
const page=(id:string,next:string|null,viewer='server-viewer')=>({schema_version:'opensaddle.project-directory.v1',viewer_subject:viewer,items:[{project_id:id,display_name:id,membership_role:'member'}],next_cursor:next})
// PROJECT-DIRECTORY-UI-1: complete current membership pages, never mixed accounts or silently partial.
test('directory follows authoritative cursor and preserves server identity across pages',async t=>{
 const paths:string[]=[]
 t.mock.method(globalThis,'fetch',async(url:string)=>{paths.push(url);return Response.json(paths.length===1?page('alpha','alpha'):page('beta',null))})
 assert.deepEqual(await new ProjectDirectoryClient('http://localhost',()=> 'local-hint').list(),[{id:'alpha',name:'alpha',role:'member'},{id:'beta',name:'beta',role:'member'}])
 assert.match(paths[1],/after=alpha$/)
})
test('directory rejects an account transition while reading the response',async t=>{
 let identity='old'
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>{identity='new';return page('alpha',null)}} as Response))
 await assert.rejects(new ProjectDirectoryClient('http://localhost',()=>identity).list(),/account changed/)
})
test('directory rejects a repeated cursor and a server viewer change',async t=>{
 let calls=0,mode='viewer'
 t.mock.method(globalThis,'fetch',async()=>Response.json(++calls===1?page('alpha','alpha'):mode==='viewer'?page('beta',null,'other'):page('alpha','alpha')))
 const client=new ProjectDirectoryClient('http://localhost',()=> 'hint')
 await assert.rejects(client.list(),/Invalid project directory/)
 calls=0;mode='cursor'
 await assert.rejects(client.list(),/Invalid project entry/)
})
