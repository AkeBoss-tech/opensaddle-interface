/** Live fixture proof. Start Core's dev_project_perspective_fixture first.
 * Usage: node --import tsx scripts/prove-renderer-settings-live.tsx STATE_DIR RECEIPT_PATH
 * Uses fixture bearer files; removes the fixture's selected environment at the end.
 * Executes real signed plugin code in a DOM adapter, not a visual browser.
 */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import vm from 'node:vm'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {RemoteMalleableShellClient} from '../src/services/remoteMalleableShell'
import {RendererSettingsClient} from '../src/services/rendererSettings'
import {ProjectTaskFeedClient} from '../src/services/projectTaskFeed'
import {InstalledProjectView} from '../src/perspectives/project/InstalledProjectView'
import {RendererSettingsEditor} from '../src/features/settings/RendererSettingsEditor'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const [stateDir,receiptPath]=process.argv.slice(2)
assert.ok(stateDir&&receiptPath,'Provide fixture state directory and receipt output path')
const metadata=JSON.parse(readFileSync(join(stateDir,'fixture.json'),'utf8'))
const base=metadata.base_url,project=metadata.project_id
assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal(project,'renderer-proof')
const memberToken=readFileSync(join(stateDir,'member.token'),'utf8'),ownerToken=readFileSync(join(stateDir,'owner.token'),'utf8')
const shell=new RemoteMalleableShellClient(base,()=> 'renderer-member',memberToken)
const member=new RendererSettingsClient(base,()=> 'renderer-member',memberToken)
const owner=new RendererSettingsClient(base,()=> 'renderer-owner',ownerToken)
const renderer=(await shell.applicationRenderers(project)).find(row=>row.application_id==='project-board')!
assert.ok(renderer);assert.equal(renderer.package_ref.package_id,'dev.opensaddle.project-starter')
const model=await new ProjectTaskFeedClient(base,()=> 'renderer-member',memberToken).read(project)
assert.ok(model.tasks.some(task=>task.status==='completed'))
const listeners=new Set<(event:any)=>void>(),messages:any[]=[]
Object.assign(globalThis,{addEventListener:(_:string,callback:any)=>listeners.add(callback),removeEventListener:(_:string,callback:any)=>listeners.delete(callback)})
let pluginHandler:(event:any)=>void
class Element {
 children:Element[]=[];dataset:Record<string,string>={};value='';className='';textContent='';disabled=false
 constructor(public tag:string){}
 append(...children:Element[]){this.children.push(...children)}
 replaceChildren(){this.children=[]}
 focus(){dom.activeElement=this}
}
const nodes=Object.fromEntries(['tasks','filter','project','empty','new'].map(id=>[id,new Element(id==='filter'?'input':'div')]))
nodes.tasks.className='board'
const dom={activeElement:null as Element|null,getElementById:(id:string)=>nodes[id],createElement:(tag:string)=>new Element(tag)}
const source={postMessage:(message:any)=>{messages.push(message);pluginHandler({source:parent,data:message})}}
const parent={postMessage:(message:any)=>{for(const listener of listeners)listener({source,data:message})}}
const node={contentWindow:source,dataset:{}}
const walk=(node:Element):Element[]=>[node,...node.children.flatMap(walk)]
const cards=()=>walk(nodes.tasks).filter(node=>node.tag==='button')
let view:ReactTestRenderer|undefined,editor:ReactTestRenderer|undefined
async function until(predicate:()=>boolean){for(let i=0;i<160&&!predicate();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))});assert.ok(predicate(),'Live proof condition timed out')}
try {
 await act(async()=>{view=create(<InstalledProjectView client={shell} settingsClient={member} renderer={renderer} model={model} connectionKey="live-member" onOpenTask={()=>{}} onNewTask={()=>{}}/>,{createNodeMock:()=>node})})
 await until(()=>Boolean(view!.root.findAllByType('iframe').length))
 const html=view!.root.findByType('iframe').props.srcDoc
 vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{document:dom,parent,addEventListener:(_:string,callback:any)=>{pluginHandler=callback},setTimeout,clearTimeout})
 await act(async()=>view!.root.findByType('iframe').props.onLoad())
 assert.equal(cards().length,model.tasks.length)
 const initialNonce=messages[0].nonce
 await act(async()=>{editor=create(<RendererSettingsEditor client={member} projectId={project} renderer={renderer}/>)})
 await until(()=>Boolean(editor!.root.findAllByType('fieldset').length))
 const toggle=()=>editor!.root.findAllByType('label').find(label=>label.children.includes('Override Show finished tasks'))!.findByType('input')
 await act(async()=>toggle().props.onChange({target:{checked:true}}))
 await act(async()=>editor!.root.findByProps({'aria-label':'Show finished tasks'}).props.onChange({target:{checked:false}}))
 await act(async()=>{editor!.root.findAllByType('button').find(button=>button.children.includes('Save plugin settings'))!.props.onClick()})
 await until(()=>cards().length===0)
 assert.equal(messages.at(-1).nonce,initialNonce)
 assert.equal(messages.at(-1).kind,'settings')
 assert.equal(view!.root.findByType('iframe').props.srcDoc,html)
 const reopened=await new RendererSettingsClient(base,()=> 'renderer-member',memberToken).read(project,renderer)
 assert.equal(reopened.effective.values.show_finished,false)
 assert.equal((await owner.read(project,renderer)).effective.values.show_finished,true)
 await assert.rejects(member.replace(project,renderer,'project',0,{show_finished:false}),/unavailable/)
 const revision=reopened.layers.find(layer=>layer.scope==='user_project')!.revision
 await member.replace(project,renderer,'user_project',revision,{})
 await until(()=>cards().length===model.tasks.length)
 const removed=await fetch(`${base}/api/v2/projects/${project}/environment/changes`,{method:'POST',headers:{Authorization:'Bearer '+ownerToken,'Content-Type':'application/json'},body:JSON.stringify({expected_revision:2,definition:{commands:[],bindings:[],services:[],packages:[],applications:[]},reason:'finish disposable settings live proof'})})
 assert.equal(removed.status,201)
 await until(()=>view!.root.findAllByType('iframe').length===0)
 const receipt={invariant:'RENDERER-SETTINGS-LIVE',project,package_ref:renderer.package_ref,content_digest:renderer.content_digest,checks:['real signed catalog and bytes','member generated editor saves private override','poll delivers same-frame settings to actual plugin JavaScript','completed task becomes hidden','new client reads durable value','owner private values isolated','member shared write denied','empty override restores displayed task','environment removal revokes frame'],transport:'real loopback HTTP, fixture bearer authentication',renderer:'actual signed JavaScript in minimal DOM adapter; mounted React host',limitations:['fixture task, not native agent execution','not browser visual acceptance','not OS/network sandbox proof'],completed_at:new Date().toISOString()}
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2))
}finally{await act(async()=>{editor?.unmount();view?.unmount()})}
