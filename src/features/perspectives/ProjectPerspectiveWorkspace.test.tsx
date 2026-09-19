import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter,useLocation} from 'react-router-dom'
import {createHash} from 'node:crypto'
import {ProjectPerspectiveWorkspace} from './ProjectPerspectiveWorkspace'
import {PresentationSettingsClient} from '../../services/presentationSettings'
import {RemoteMalleableShellClient} from '../../services/remoteMalleableShell'
import {ProjectTaskFeedClient} from '../../services/projectTaskFeed'
import {reportAnnotatorV1} from '../../applications/fixturePackages'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
// PROJECT-VIEW-RECOVERY: fallback reauthorizes data and preserves the saved package choice.
test('failed installed view recovers to fresh built-in tasks without overwriting preference',async t=>{
 const fragment='<p>Expected</p>',renderer={...reportAnnotatorV1,authority:'core',execution_trust:'trusted_signed_publisher',input_schema:{$id:'opensaddle.project-tasks.v1'},size:Buffer.byteLength(fragment),content_digest:createHash('sha256').update(fragment).digest('hex')}
 let broken=true,revoked=false,reads=0,writes=0,contentReads=0,focusRestores=0
 const body={};const previousDocument=globalThis.document
 Object.assign(globalThis,{document:{body,activeElement:body}})
 t.after(()=>{if(previousDocument)globalThis.document=previousDocument;else delete (globalThis as any).document})
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{const url=new URL(String(input));if(init?.method==='PUT')writes++;if(revoked)return Response.json({}, {status:403});if(url.pathname.endsWith('/effective'))return Response.json({project_id:'P',values:{perspective:'plugin.'+renderer.application_id},provenance:{perspective:'user_project'}});if(url.pathname.endsWith('/user_project'))return Response.json({scope:'user_project',project_id:'P',owner_subject:'member',revision:4,can_write:true,values:{perspective:'plugin.'+renderer.application_id}});if(url.pathname.endsWith('/application-renderers'))return Response.json({project_id:'P',renderers:[renderer]});if(url.pathname.endsWith('/content')){contentReads++;return new Response(broken?'bad bytes':fragment,{headers:{'Content-Type':renderer.media_type}})}if(url.pathname.endsWith('/task-feed')){reads++;return Response.json({schema_version:'opensaddle.project-task-feed.v1',project_id:'P',items:[{id:'R',title:reads<=2?'Old task':'Fresh task',status:'queued',verification:'not_assessed'}],next_cursor:null})}throw Error('Unexpected endpoint '+url.pathname)})
 Object.assign(globalThis,{addEventListener:()=>{},removeEventListener:()=>{}})
 const services={journey:{},presentationSettings:new PresentationSettingsClient('http://core',()=> 'member'),malleableShell:new RemoteMalleableShellClient('http://core',()=> 'member'),projectTaskFeed:new ProjectTaskFeedClient('http://core',()=> 'member')} as any
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 const until=async(predicate:()=>boolean)=>{for(let i=0;i<100&&!predicate();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))});assert.ok(predicate(),JSON.stringify(view.toJSON()))}
 await act(async()=>{view=create(<MemoryRouter><ProjectPerspectiveWorkspace projectId="P" services={services}/></MemoryRouter>,{createNodeMock:node=>node.type==='p'?{focus:()=>{focusRestores++;Object.assign(globalThis.document,{activeElement:{}})}}:{contentWindow:{postMessage:()=>{}},dataset:{}}})})
 await until(()=>JSON.stringify(view.toJSON()).includes('Fresh task'))
 assert.equal(view.root.findAllByType('iframe').length,0)
 assert.match(JSON.stringify(view.toJSON()),/Showing Dialogue.*preference is preserved/)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Old task/)
 assert.ok(reads>=4,'fallback must read fresh Project data')
 assert.equal(writes,0,'recovery must not overwrite saved view preferences')
 assert.equal(focusRestores,1,'recovery must restore lost keyboard focus to its notice')
 // A background failure must not steal focus from a different host control.
 Object.assign(globalThis.document,{activeElement:{}})
 await act(async()=>view.root.findAllByType('button').find(node=>node.children.includes('Refresh workspace'))!.props.onClick())
 await until(()=>contentReads===2&&JSON.stringify(view.toJSON()).includes('Showing Dialogue'))
 assert.equal(focusRestores,1,'recovery must preserve focus on another control')
 broken=false
 await act(async()=>view.root.findAllByType('button').find(node=>node.children.includes('Refresh workspace'))!.props.onClick())
 await until(()=>view.root.findAllByType('iframe').length===1)
 assert.equal(contentReads,3,'explicit refresh retries the retained package')
 revoked=true
 await act(async()=>view.root.findAllByType('button').find(node=>node.children.includes('Refresh workspace'))!.props.onClick())
 await until(()=>JSON.stringify(view.toJSON()).includes('Could not load this project'))
 assert.equal(view.root.findAllByType('iframe').length,0)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Fresh task/)
})

test('Dialogue mounts saved Project conversations without internal Project switching',async t=>{
 const {ManagerConversationsClient}=await import('../../services/managerConversations')
 const id='mgr_'+'a'.repeat(64);let record:any,stored:any[]=[];let revoked=false,preferred='dialogue'
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{const url=new URL(String(input));assert.ok(url.pathname.startsWith('/api/v2/projects/P/'),'workspace requests stay in Project P');if(revoked)return Response.json({}, {status:403});if(url.pathname.endsWith('/effective'))return Response.json({project_id:'P',values:{perspective:preferred},provenance:{}});if(url.pathname.endsWith('/user_project')){if(init?.method==='PUT')preferred=JSON.parse(String(init.body)).values.perspective;return Response.json({scope:'user_project',project_id:'P',revision:0,can_write:true,values:{perspective:preferred}})}if(url.pathname.endsWith('/application-renderers'))return Response.json({project_id:'P',renderers:[]});if(url.pathname.endsWith('/task-feed'))return Response.json({schema_version:'opensaddle.project-task-feed.v1',project_id:'P',items:[],next_cursor:null});const body=init?.body?JSON.parse(String(init.body)):undefined;if(url.pathname.endsWith('/conversations')){if(body){assert.equal(body.project_ids,undefined);record={conversation_id:id,project_id:'P',title:body.title,version:0,scope:{revision:0,project_ids:['P']},created_at:'now',updated_at:'now',provider_execution:false};return Response.json(record)}return Response.json({items:record?[record]:[],next_cursor:null})}if(url.pathname.endsWith('/messages')){if(body){const message={thread_id:id,message_id:'msg_'+body.request_id,client_message_id:body.request_id,sequence:1,role:'user',content:body.content,payload:{manager_scope:record.scope,provider_status:'not_started'}};stored=[message];record={...record,version:1};return Response.json({message,conversation_version:1,provider_execution:false})}return Response.json({items:stored,next_cursor:null,conversation_version:record.version,provider_execution:false})}if(url.pathname.endsWith('/'+id))return Response.json(record);throw Error('Unexpected request '+url.pathname)})
 const services={journey:{},presentationSettings:new PresentationSettingsClient('http://core',()=> 'member'),malleableShell:new RemoteMalleableShellClient('http://core',()=> 'member'),projectTaskFeed:new ProjectTaskFeedClient('http://core',()=> 'member'),projectConversations:(project:string)=>new ManagerConversationsClient('http://core',()=> 'member',undefined,undefined,false,project)} as any
 function LocationProof(){const location=useLocation();return <output data-location>{location.search}</output>}
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 const until=async(predicate:()=>boolean)=>{for(let i=0;i<100&&!predicate();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))});assert.ok(predicate(),JSON.stringify(view.toJSON()))}
 await act(async()=>{view=create(<MemoryRouter><LocationProof/><ProjectPerspectiveWorkspace projectId="P" services={services}/></MemoryRouter>)})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))
 await until(()=>Boolean(button('New conversation')))
 await act(async()=>button('New conversation')!.props.onClick())
 await until(()=>view.root.findAllByType('textarea').length>0&&button('Save message')?.props.disabled===true)
 await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'Investigate this Project change'}}))
 await until(()=>button('Save message')?.props.disabled===false)
 await act(async()=>button('Save message')!.props.onClick())
 await until(()=>stored.length===1&&JSON.stringify(view.toJSON()).includes('Message saved'))
 assert.equal(stored[0].content,'Investigate this Project change')
 assert.equal(view.root.findByProps({'data-location':true}).children.join(''),'?conversation='+id,'conversation selection must be in the Project URL')
 await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'Unsent follow-up'}}))
 const selector=()=>view.root.findAllByType('select').find(node=>node.findAllByType('option').some(option=>option.props.value==='dispatch'))!
 await act(async()=>selector().props.onChange({target:{value:'dispatch'}}))
 assert.equal(view.root.findAllByType('textarea').length,0)
 await act(async()=>selector().props.onChange({target:{value:'dialogue'}}))
 await until(()=>view.root.findAllByType('textarea').length>0)
 assert.equal(view.root.findByType('textarea').props.value,'Unsent follow-up','view switching must preserve the host conversation draft')
 assert.equal(view.root.findByProps({'data-location':true}).children.join(''),'?conversation='+id)
 await act(async()=>view.unmount())
 await act(async()=>{view=create(<MemoryRouter initialEntries={['/?conversation='+id]}><LocationProof/><ProjectPerspectiveWorkspace projectId="P" services={services}/></MemoryRouter>)})
 await until(()=>JSON.stringify(view.toJSON()).includes('Investigate this Project change'))
 assert.equal(view.root.findByType('textarea').props.value,'','unsaved drafts are memory-only across workspace remounts')

 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Apply selected Projects|Choose a project|New conversation with selected Projects/)
 revoked=true
 await act(async()=>button('Reload conversations')!.props.onClick())
 await until(()=>JSON.stringify(view.toJSON()).includes('Saved conversations could not be loaded'))
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Investigate this Project change/)
})

// PROJECT-VIEW-SCOPE: recovery and in-flight state belong to one Project mount.
for(const scopeChange of ['Project','account','connection'] as const)
test(`a failed package does not suppress the same package after ${scopeChange} change`,async t=>{
 const fragment='<p>Project board</p>',renderer={...reportAnnotatorV1,authority:'core',execution_trust:'trusted_signed_publisher',input_schema:{$id:'opensaddle.project-tasks.v1'},size:Buffer.byteLength(fragment),content_digest:createHash('sha256').update(fragment).digest('hex')}
 const packageChoice='plugin.'+renderer.application_id
 let subject='member',base='http://core'
 const contentProjects:string[]=[];let releaseQ!:()=>void
 const qGate=new Promise<void>(resolve=>{releaseQ=resolve})
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{
  const url=new URL(String(input)),project=url.pathname.split('/projects/')[1]?.split('/')[0]
  assert.ok(project==='P'||project==='Q');assert.notEqual(init?.method,'PUT','scope switching must not rewrite preferences')
  const oldScope=project==='P'&&new Headers(init?.headers).get('X-OpenSaddle-User')==='member'&&url.hostname==='core'
  if(!oldScope&&url.pathname.endsWith('/effective'))await qGate
  if(url.pathname.endsWith('/effective'))return Response.json({project_id:project,values:{perspective:packageChoice},provenance:{perspective:'user_project'}})
  if(url.pathname.endsWith('/user_project'))return Response.json({scope:'user_project',project_id:project,owner_subject:'member',revision:4,can_write:true,values:{perspective:packageChoice}})
  if(url.pathname.endsWith('/application-renderers'))return Response.json({project_id:project,renderers:[renderer]})
  if(url.pathname.endsWith('/content')){contentProjects.push(oldScope?'old':'new');return new Response(oldScope?'bad bytes':fragment,{headers:{'Content-Type':renderer.media_type}})}
  if(url.pathname.endsWith('/task-feed'))return Response.json({schema_version:'opensaddle.project-task-feed.v1',project_id:project,items:[{id:project+'-run',title:(oldScope?'old':'new')+' private task',status:'queued',verification:'not_assessed'}],next_cursor:null})
  throw Error('Unexpected endpoint '+url.pathname)
 })
 Object.assign(globalThis,{addEventListener:()=>{},removeEventListener:()=>{}})
 const makeServices=()=>({journey:{},presentationSettings:new PresentationSettingsClient(base,()=>subject),malleableShell:new RemoteMalleableShellClient(base,()=>subject),projectTaskFeed:new ProjectTaskFeedClient(base,()=>subject)}) as any
 let services=makeServices()
 let view!:ReactTestRenderer;t.after(async()=>{releaseQ();if(view)await act(async()=>view.unmount())})
 const until=async(predicate:()=>boolean)=>{for(let i=0;i<100&&!predicate();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))});assert.ok(predicate(),'new scope must mount its selected package independently of prior recovery')}
 const render=(project:string)=><MemoryRouter><ProjectPerspectiveWorkspace projectId={project} services={services}/></MemoryRouter>
 await act(async()=>{view=create(render('P'),{createNodeMock:()=>({contentWindow:{postMessage:()=>{}},dataset:{}})})})
 await until(()=>JSON.stringify(view.toJSON()).includes('old private task'))
 assert.match(JSON.stringify(view.toJSON()),/Showing Dialogue/)
 if(scopeChange==='account')subject='new-member'
 if(scopeChange==='connection'){base='http://other-core';services=makeServices()}
 await act(async()=>view.update(render(scopeChange==='Project'?'Q':'P')))
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/old private task|Showing Dialogue/,'pending Project scope must clear prior recovery and content')
 await act(async()=>releaseQ())
 await until(()=>view.root.findAllByType('iframe').length===1)
 assert.deepEqual(contentProjects,['old','new'],'new scope must load and authorize its own package bytes')
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/old private task|Showing Dialogue/)
})
