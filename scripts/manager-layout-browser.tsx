/** Presentation-only fixture: no Core connection, task execution or persistence. */
import React from 'react'
import {createRoot} from 'react-dom/client'
import {ManagerConversationsPanel} from '../src/features/command-center/ManagerConversationsPanel'
import type {ManagerConversation,ManagerConversationsAuthority} from '../src/services/managerConversations'
import '../src/styles/app.css'
import '../src/features/command-center/command-center.css'
const items:ManagerConversation[]=['Release readiness','Desktop daily-driver verification','Plan the next milestone'].map((title,index)=>({conversation_id:`fixture-${index}`,title,version:1,scope:{revision:1,project_ids:['opensaddle']},created_at:'2026-09-10',updated_at:'2026-09-10',provider_execution:false}))
const client:ManagerConversationsAuthority={
 list:async()=>items,
 open:async id=>({conversation:items.find(item=>item.conversation_id===id)!,messages:[{message_id:'m1',thread_id:id,sequence:1,role:'user',content:'Review the remaining daily-driver checks and summarize what needs attention.',payload:{manager_scope:{revision:1,project_ids:['opensaddle']},provider_status:'not_started'}}]}),
 create:async()=>{throw Error('Presentation fixture: creation unavailable')},append:async()=>{throw Error('Presentation fixture: saving unavailable')},scope:async()=>{throw Error('Presentation fixture: scope changes unavailable')},
}
document.body.style.overflow='auto'
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:'100%',width:new URLSearchParams(location.search).has('narrow')?360:1100,margin:'32px auto',padding:24,background:'var(--bg)',minHeight:'90vh'}}><h1>Manager</h1><p>Presentation fixture · no connected runtime</p><ManagerConversationsPanel client={client} identity={client} projectIds={['opensaddle']} name={id=>id}/></main>)
