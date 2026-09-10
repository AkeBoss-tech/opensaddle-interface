import assert from'node:assert/strict'
import test from'node:test'
import React,{StrictMode}from'react'
import{act,create}from'react-test-renderer'
import{MemoryRouter}from'react-router-dom'
import type{CommandCenterClient,CommandCenterSnapshot}from'../../services/contracts'
import{CommandCenterSurface}from'./CommandCenterSurface'
;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;void React
const snapshot=(name:string):CommandCenterSnapshot=>({generatedAt:'2026-09-07T12:00:00Z',priority:null,priorityStatus:{state:'empty'},attentionItems:[],activeRuns:[],projects:[{projectId:name,status:'active',objective:`${name} objective`}],outcomes:[{id:`${name}-outcome`,projectId:name,title:`${name} outcome`,verified:false,completedAt:'2026-09-07T12:00:00Z'}],unavailableSections:[]})
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const client=(get:()=>Promise<CommandCenterSnapshot>):CommandCenterClient=>({get})
const view=(api:CommandCenterClient|undefined,connected=true,identity:object=api??{})=><MemoryRouter><CommandCenterSurface client={api} connected={connected} identity={identity} projects={[]}/></MemoryRouter>
const markup=(renderer:ReturnType<typeof create>)=>JSON.stringify(renderer.toJSON())

test('a disconnected mounted surface cannot republish a deferred protected snapshot',async()=>{const old=deferred<CommandCenterSnapshot>();const api=client(()=>old.promise);let renderer!:ReturnType<typeof create>;await act(async()=>{renderer=create(view(api));await Promise.resolve()});await act(async()=>{renderer.update(view(undefined,false,{}));await Promise.resolve()});old.resolve(snapshot('Private old project'));await act(async()=>{await old.promise});assert.match(markup(renderer),/Command Center unavailable/);assert.doesNotMatch(markup(renderer),/Private old project|old outcome/)})

test('replacement client success and error both fence the earlier connection',async()=>{for(const oldSettles of['resolve','reject']as const){const old=deferred<CommandCenterSnapshot>(),fresh=deferred<CommandCenterSnapshot>();const a=client(()=>old.promise),b=client(()=>fresh.promise);let renderer!:ReturnType<typeof create>;await act(async()=>{renderer=create(view(a,true,{client:a}));await Promise.resolve()});await act(async()=>{renderer.update(view(b,true,{client:b}));await Promise.resolve()});fresh.resolve(snapshot('Current B'));await act(async()=>{await fresh.promise});assert.match(markup(renderer),/Current B/);if(oldSettles==='resolve')old.resolve(snapshot('Private A'));else old.reject(Error('old credential revoked'));await act(async()=>{await old.promise.catch(()=>undefined)});assert.match(markup(renderer),/Current B/);assert.doesNotMatch(markup(renderer),/Private A|old credential revoked/)}})

test('overlapping refreshes retain only the latest result or error',async()=>{for(const firstSettles of['resolve','reject']as const){const older=deferred<CommandCenterSnapshot>(),newer=deferred<CommandCenterSnapshot>();const queue:Array<Promise<CommandCenterSnapshot>>=[Promise.resolve(snapshot('Initial')),older.promise,newer.promise];const api=client(()=>queue.shift()!);let renderer!:ReturnType<typeof create>;await act(async()=>{renderer=create(view(api));await new Promise(resolve=>setTimeout(resolve,0))});const refreshNode=renderer.root.findAllByType('button').find(node=>node.findAllByType('span').some(label=>label.children.join('')==='Refresh'));assert.ok(refreshNode,markup(renderer));const clickRefresh=refreshNode.props.onClick;await act(async()=>{void clickRefresh();void clickRefresh();await Promise.resolve()});newer.resolve(snapshot('Latest'));await act(async()=>{await newer.promise});if(firstSettles==='resolve')older.resolve(snapshot('Older'));else older.reject(Error('older refresh failed'));await act(async()=>{await older.promise.catch(()=>undefined)});assert.match(markup(renderer),/Latest/);assert.doesNotMatch(markup(renderer),/Older|older refresh failed/)}})

test('StrictMode replay and unmount do not publish stale work or disable a reopened surface',async()=>{const stale=deferred<CommandCenterSnapshot>();const api=client(()=>stale.promise);let renderer!:ReturnType<typeof create>;await act(async()=>{renderer=create(<StrictMode>{view(api)}</StrictMode>);await Promise.resolve()});await act(async()=>{renderer.unmount()});stale.resolve(snapshot('Unmounted private'));await act(async()=>{await stale.promise});await act(async()=>{renderer=create(<StrictMode>{view(client(async()=>snapshot('Reopened')))}</StrictMode>);await Promise.resolve()});assert.match(markup(renderer),/Reopened/);assert.doesNotMatch(markup(renderer),/Unmounted private|Loading authoritative/)})

test('render-time client replacement hides a ready old snapshot before effects run',async()=>{const a=client(async()=>snapshot('Visible A')),pending=deferred<CommandCenterSnapshot>(),b=client(()=>pending.promise),sameIdentity={connection:'same wrapper'};let renderer!:ReturnType<typeof create>;await act(async()=>{renderer=create(view(a,true,sameIdentity));await new Promise(resolve=>setTimeout(resolve,0))});assert.match(markup(renderer),/Visible A/);await act(async()=>{renderer.update(view(b,true,sameIdentity));await Promise.resolve()});assert.match(markup(renderer),/Loading authoritative Command Center/);assert.doesNotMatch(markup(renderer),/Visible A/);await act(async()=>{renderer.unmount()});pending.resolve(snapshot('Never mounted'));await pending.promise})

// DASHBOARD-EDITOR-1: saved order controls DOM order; conflicting edits survive.
test('saved dashboard layout orders visible widgets and preserves a conflicting draft',async t=>{
 const api=client(async()=>snapshot('Project A'))
 let stored={schema_version:'opensaddle.dashboard-layout.v1' as const,owner_subject:'one',revision:1,widgets:['outcomes','projects']},conflict=true
 const settings={read:async()=>stored,replace:async(revision:number,widgets:string[])=>{assert.equal(revision,stored.revision);if(conflict)throw Error('Dashboard changed elsewhere. Your draft is preserved.');return stored={...stored,revision:revision+1,widgets}}}
 let renderer!:ReturnType<typeof create>
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount())})
 await act(async()=>{renderer=create(<MemoryRouter><CommandCenterSurface client={api} dashboardSettings={settings} dashboardIdentity="one" connected identity={api} projects={[]}/></MemoryRouter>)})
 const titles=()=>renderer.root.findAllByType('h2').map(node=>node.children.join(''))
 assert.deepEqual(titles(),['Recent outcomes','Projects'],'saved layout must determine visible dashboard DOM order')
 const button=(label:string)=>renderer.root.findAllByType('button').find(node=>node.props['aria-label']===label||node.children.join('')===label)!
 await act(async()=>button('Move Projects up').props.onClick())
 // Draft order does not change the saved dashboard until Save succeeds.
 assert.deepEqual(titles(),['Recent outcomes','Projects'])
 await act(async()=>button('Save dashboard').props.onClick())
 assert.match(markup(renderer),/draft is preserved/)
 assert.equal(button('Move Projects up').props.disabled,true,'first draft widget must remain first on conflict')
 conflict=false
 await act(async()=>button('Save dashboard').props.onClick())
 assert.deepEqual(titles(),['Projects','Recent outcomes'])
 assert.deepEqual(stored.widgets,['projects','outcomes'])
 const checkbox=renderer.root.findAllByType('input').find(node=>node.parent?.children.some(child=>typeof child==='string'&&child==='Projects'))!
 await act(async()=>checkbox.props.onChange({target:{checked:false}}))
 await act(async()=>button('Save dashboard').props.onClick())
 assert.deepEqual(titles(),['Recent outcomes'])
})

test('dashboard account replacement hides old layout and ignores late saves',async t=>{
 const api=client(async()=>snapshot('Shared projection')),pending=deferred<{schema_version:'opensaddle.dashboard-layout.v1';owner_subject:string;revision:number;widgets:string[]}>()
 const old={read:async()=>({schema_version:'opensaddle.dashboard-layout.v1' as const,owner_subject:'one',revision:1,widgets:['plugin.private-view']}),replace:()=>pending.promise}
 const fresh={read:async()=>({schema_version:'opensaddle.dashboard-layout.v1' as const,owner_subject:'two',revision:0,widgets:[]}),replace:()=>pending.promise}
 const surface=(settings:typeof old|typeof fresh,identity:string)=><MemoryRouter><CommandCenterSurface client={api} dashboardSettings={settings} dashboardIdentity={identity} connected identity={api} projects={[]}/></MemoryRouter>
 let renderer!:ReturnType<typeof create>
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount())})
 await act(async()=>{renderer=create(surface(old,'one'))})
 assert.match(markup(renderer),/plugin.private-view/)
 await act(async()=>renderer.root.findAllByType('button').find(node=>node.children.join('')==='Use default layout')!.props.onClick())
 await act(async()=>{void renderer.root.findAllByType('button').find(node=>node.children.join('')==='Save dashboard')!.props.onClick()})
 await act(async()=>renderer.update(surface(fresh,'two')))
 assert.doesNotMatch(markup(renderer),/plugin.private-view/)
 assert.match(markup(renderer),/Your dashboard is empty/)
 pending.resolve({schema_version:'opensaddle.dashboard-layout.v1',owner_subject:'one',revision:2,widgets:['plugin.private-view']})
 await act(async()=>{await pending.promise})
 assert.doesNotMatch(markup(renderer),/plugin.private-view/)
 assert.match(markup(renderer),/Your dashboard is empty/)
})

// MANAGER-DASHBOARD-INDEPENDENCE: projection availability is not conversation authority.
test('manager conversation survives missing failed and refreshing dashboard projections',async t=>{
 const conversation={conversation_id:'manager-one',title:'Independent manager',version:1,scope:{revision:1,project_ids:['p']},created_at:'2026-09-10T00:00:00Z',updated_at:'2026-09-10T00:00:00Z',provider_execution:false as const}
 const messages:import('../../services/managerConversations').ManagerMessage[]=[]
 const manager:import('../../services/managerConversations').ManagerConversationsAuthority={list:async()=>[conversation],open:async()=>({conversation,messages:[...messages]}),create:async()=>conversation,scope:async()=>{},append:async(value,content)=>{assert.equal(value.conversation_id,conversation.conversation_id);messages.push({thread_id:value.conversation_id,message_id:'message-one',sequence:1,role:'user',content,payload:{manager_scope:value.scope,provider_status:'not_started'}})}}
 const directory={list:async()=>[{id:'p',name:'Project P',role:'owner'}]},identity={}
 const surface=(api?:CommandCenterClient,connected=true)=><MemoryRouter><CommandCenterSurface client={api} connected={connected} identity={identity} projects={[]} managerConversations={manager} projectDirectory={directory}/></MemoryRouter>
 let renderer!:ReturnType<typeof create>;t.after(async()=>{if(renderer)await act(async()=>renderer.unmount())})
 await act(async()=>{renderer=create(surface())})
 assert.match(markup(renderer),/Independent manager/,'saved manager must remain available without dashboard or context-preview capability')
 const button=(title:string)=>renderer.root.findAllByType('button').find(node=>node.children.join('')===title)!
 await act(async()=>button('Independent manager').props.onClick())
 await act(async()=>renderer.root.findByType('textarea').props.onChange({target:{value:'Keep this manager draft'}}))
 const failed=client(async()=>{throw Error('Projection offline')})
 await act(async()=>renderer.update(surface(failed)))
 assert.match(markup(renderer),/Command Center could not load/)
 assert.equal(renderer.root.findByType('textarea').props.value,'Keep this manager draft')
 const pending=deferred<CommandCenterSnapshot>();let calls=0;const available=client(()=>++calls===1?Promise.resolve(snapshot('P')):pending.promise)
 await act(async()=>renderer.update(surface(available)))
 const refresh=renderer.root.findAllByType('button').find(node=>node.findAllByType('span').some(span=>span.children.join('')==='Refresh'))!
 await act(async()=>{void refresh.props.onClick()})
 assert.match(markup(renderer),/Loading authoritative Command Center/)
 assert.equal(renderer.root.findByType('textarea').props.value,'Keep this manager draft')
 await act(async()=>button('Save message').props.onClick())
 assert.equal(messages[0].content,'Keep this manager draft')
 await act(async()=>renderer.update(surface(available,false)))
 assert.doesNotMatch(markup(renderer),/Independent manager|Keep this manager draft/)
 pending.resolve(snapshot('Late private P'));await act(async()=>{await pending.promise})
 assert.doesNotMatch(markup(renderer),/Late private P/)
})
