import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {TeamWorkspaceOverview} from './TeamWorkspaceOverview'
import {TeamsClient} from '../../services/teams'
import {ProjectDirectoryClient} from '../../services/projectDirectory'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))

// TEAM-WORKSPACE-1: named scope with authorized Project intersection and recovery.
test('Team overview shows only effective accessible Projects and scoped settings',async t=>{
 let deny=false
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input))
  if(deny)return new Response(null,{status:403})
  if(url.pathname.endsWith('/presentation-projects'))return Response.json({items:[
   {project_id:'a',team_id:'T',revision:1,state:'accepted',effective:true},
   {project_id:'hidden',team_id:'T',revision:1,state:'accepted',effective:true},
   {project_id:'pending',team_id:'T',revision:1,state:'proposed',effective:false},
  ]})
  if(url.pathname==='/api/v2/projects')return Response.json({schema_version:'opensaddle.project-directory.v1',viewer_subject:'owner',next_cursor:null,items:[{project_id:'a',display_name:'Astra',membership_role:'owner'},{project_id:'pending',display_name:'Pending',membership_role:'member'}]})
  return Response.json({team_id:'T',display_name:'Research Team',revision:1,viewer_role:'owner',members:[{subject:'owner',role:'owner',state:'active'}]})
 })
 const client=new TeamsClient('http://localhost',()=> 'owner',undefined,true),directory=new ProjectDirectoryClient('http://localhost',()=> 'owner')
 let view!:ReactTestRenderer
 try {
  await act(async()=>{view=create(<MemoryRouter><TeamWorkspaceOverview client={client} directory={directory} teamId="T"/></MemoryRouter>);await flush()})
  assert.match(JSON.stringify(view.toJSON()),/Research Team/)
  const links=view.root.findAllByType('a').map(node=>node.props.href)
  assert.ok(links.includes('/teams/T/settings'))
  assert.ok(links.includes('/project/a'))
  assert.ok(!links.includes('/project/hidden')&&!links.includes('/project/pending'))
  deny=true
  await act(async()=>{view.root.findByType('button').props.onClick();await flush()})
  assert.match(JSON.stringify(view.toJSON()),/could not be loaded/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/Research Team|Astra/)
 } finally {if(view)await act(async()=>view.unmount())}
})
