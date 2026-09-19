/** Real native-provider proof. Requires explicit --allow-native-provider and an
 * isolated Core conversation fixture with its worker already running.
 */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {ManagerConversationsClient} from '../src/services/managerConversations'
import {RemoteJourneyClient} from '../src/services/remoteJourney'
const [state,receipt,authorization]=process.argv.slice(2)
assert.ok(state&&receipt);assert.equal(authorization,'--allow-native-provider')
const m=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
assert.equal(m.fixture,'conversation-context-native-v1');assert.equal(m.project_id,'context-proof');assert.equal(new URL(m.base_url).hostname,'127.0.0.1')
const token=readFileSync(join(state,'owner.token'),'utf8')
const journey=new RemoteJourneyClient(m.base_url,()=> 'context-owner',token,false,true)
const client=new ManagerConversationsClient(m.base_url,()=> 'context-owner',token,journey,true,m.project_id,true)
const pause=()=>new Promise(resolve=>setTimeout(resolve,2000))
let ready=false
for(let i=0;i<30&&!ready;i++){const snapshot=await journey.snapshot(m.project_id);ready=Boolean(snapshot.nativeAdapters?.some(a=>a.sourceId===m.source_id&&a.adapterId==='codex-app-server'&&a.ready));if(!ready)await pause()}
assert.ok(ready,'Native worker must report authenticated readiness')
console.log('Native worker ready; creating isolated conversation.')
const conversation=await client.create('Native context proof',[m.project_id])
await client.append(conversation,'Choose a fresh eight-character uppercase alphanumeric code. Reply only CODE=<your code>. Do not use tools or access files.')
let opened=await client.open(conversation.conversation_id)
const first=opened.messages[0]
const run1=await client.dispatch(opened.conversation,first.message_id,m.project_id,m.source_id,'codex-app-server')
console.log('First task dispatched:',run1.run_id)
async function result(messageId:string,runId:string){
 for(let i=0;i<150;i++){
  const task=(await client.dispatches(conversation.conversation_id,messageId)).find(t=>t.run_id===runId)
  if(task?.status==='completed')return client.childResult(conversation.conversation_id,messageId,m.project_id,runId)
  if(task&&['failed','cancelled','interrupted'].includes(task.status))throw Error(`Native task ended ${task.status}: ${runId}`)
  if(i%15===0)console.log('Waiting for native task:',runId,task?.status)
  await pause()
 }
 throw Error('Native task remains unresolved; inspect its existing Run before retrying')
}
const output1=await result(first.message_id,run1.run_id!)
const match=output1.text.match(/CODE=([A-Z0-9]{8})\b/);assert.ok(match,'First native output must contain its chosen code')
opened=await client.open(conversation.conversation_id)
await client.append(opened.conversation,'Read the code in the previous native task output and reply only REMEMBERED=<that exact code>. Do not choose a new code. Do not use tools or access files.')
opened=await client.open(conversation.conversation_id)
const second=opened.messages[1]
const run2=await client.dispatch(opened.conversation,second.message_id,m.project_id,m.source_id,'codex-app-server',true)
console.log('Contextual follow-up dispatched:',run2.run_id)
const output2=await result(second.message_id,run2.run_id!)
assert.ok(output2.text.includes('REMEMBERED='+match[1]),'Follow-up must recover the prior native output')
const canonical=await journey.run(run2.run_id!)
assert.ok(String(canonical.task).includes(output1.text));assert.ok(String(canonical.task).includes(output1.resource.artifact_id))
assert.equal((await client.dispatch(opened.conversation,second.message_id,m.project_id,m.source_id,'codex-app-server',true)).run_id,run2.run_id)
writeFileSync(receipt,JSON.stringify({schema_version:'opensaddle.native-conversation-context-proof.v1',project_id:m.project_id,conversation_id:conversation.conversation_id,first:{message_id:first.message_id,run_id:run1.run_id,...output1},followup:{message_id:second.message_id,run_id:run2.run_id,...output2},checks:['real Codex readiness','first native output generates code','explicit context dispatch includes exact authorized output and artifact identity','second native output recalls generated code','duplicate contextual dispatch returns same Run'],limits:['New provider tasks with explicit prompt context; not session resume','No streaming assistant UI','No browser visual or arbitrary native sandbox proof']},null,2)+'\n')
writeFileSync(join(state,'drain'),'proof completed\n')
console.log('Both native tasks completed; context proof saved and worker drained.')
