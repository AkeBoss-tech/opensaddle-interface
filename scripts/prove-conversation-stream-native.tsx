/** Real Codex + Core SSE + mounted conversation proof. Isolated fixture only. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {ManagerMessageDispatch} from '../src/features/command-center/ManagerMessageDispatch'
import {ManagerConversationsClient} from '../src/services/managerConversations'
import {RemoteJourneyClient} from '../src/services/remoteJourney'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const [state,receipt,authorization]=process.argv.slice(2)
assert.ok(state&&receipt);assert.equal(authorization,'--allow-native-provider')
const m=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
assert.equal(m.fixture,'conversation-context-native-v1');assert.equal(new URL(m.base_url).hostname,'127.0.0.1')
const token=readFileSync(join(state,'owner.token'),'utf8')
const journey=new RemoteJourneyClient(m.base_url,()=> 'context-owner',token,false,true)
const client=new ManagerConversationsClient(m.base_url,()=> 'context-owner',token,journey,true,m.project_id,true)
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
let ready=false
for(let i=0;i<30&&!ready;i++){const snapshot=await journey.snapshot(m.project_id);ready=Boolean(snapshot.nativeAdapters?.some(a=>a.sourceId===m.source_id&&a.adapterId==='codex-app-server'&&a.ready));if(!ready)await pause(2000)}
assert.ok(ready,'Native worker must be ready')
const conversation=await client.create('Native streaming proof',[m.project_id])
await client.append(conversation,'Write 40 numbered sentences describing how to organize a personal workspace. Use about twelve words per sentence. Start writing the numbered list immediately. Do not use tools or access files.')
const opened=await client.open(conversation.conversation_id),message=opened.messages[0]
const task=await client.dispatch(opened.conversation,message.message_id,m.project_id,m.source_id,'codex-app-server')
assert.ok(task.run_id);console.log('Native streaming Run:',task.run_id)
let view!:ReactTestRenderer,firstPreview='',firstObservedStatus='',lastPreview='',updates=0,completed=false
try{
 await act(async()=>{view=create(<MemoryRouter><ManagerMessageDispatch client={client} identity="context-owner" conversation={opened.conversation} message={message} name={id=>id} disabled={false} onBusy={()=>{}}/></MemoryRouter>)})
 await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:true}})})
 for(let i=0;i<2400;i++){
  await act(async()=>{await pause(100)})
  const preview=view.root.findAllByProps({'aria-label':'Live task preview'})[0]?.findAllByType('pre')[0]?.children.join('')??''
  if(preview&&preview!==lastPreview){updates++;lastPreview=preview;if(!firstPreview){firstPreview=preview;firstObservedStatus=(await journey.run(task.run_id)).status;console.log('First rendered preview; Run status:',firstObservedStatus)}}
  if(i%20===0){const run=await journey.run(task.run_id);if(run.status==='completed'){completed=true;break}if(['failed','cancelled','interrupted'].includes(run.status))throw Error('Native task ended '+run.status)}
  if(i%300===0)console.log('Waiting for stream; rendered updates:',updates)
 }
 assert.ok(completed,'Existing native Run must be inspected before any retry')
 const output=await client.childResult(conversation.conversation_id,message.message_id,m.project_id,task.run_id)
 assert.equal(firstObservedStatus,'running','Text must render while the native Run is still running')
 assert.ok(updates>1,'Mounted host must receive incremental native text')
 assert.ok(output.text.startsWith(firstPreview),'First preview must match the final digest-checked output prefix')
 assert.ok(output.text.startsWith(lastPreview),'Latest preview must match final output')
 writeFileSync(receipt,JSON.stringify({schema_version:'opensaddle.native-conversation-stream-proof.v1',project_id:m.project_id,conversation_id:conversation.conversation_id,message_id:message.message_id,run_id:task.run_id,first_observed_status:firstObservedStatus,rendered_updates:updates,first_preview:firstPreview,last_preview_characters:lastPreview.length,output,checks:['actual local Codex task','real Core SSE and Interface conversation client','mounted saved-message preview rendered while Run running','multiple rendered text updates','preview prefixes match digest-checked final native result'],limits:['Mounted React evidence; not a browser screenshot or keyboard acceptance','Codex only; Claude forwarding not proven']},null,2)+'\n')
 writeFileSync(join(state,'drain'),'native stream proof completed\n');console.log('Native stream proof saved; worker drained.')
}finally{if(view)await act(async()=>view.unmount())}
