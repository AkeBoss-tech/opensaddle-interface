/** Presentation fixture only; no runtime access or task execution. */
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {AuthoritativeRunSurface} from '../src/features/runs/AuthoritativeRunSurface'
import '../src/styles/app.css'
import '../src/features/command-center/command-center.css'
const authority={runDetail:async()=>({runId:'example',projectId:'demo',task:'Inspect the agent-support report and summarize the remaining release checks.',status:'completed',workerId:'personal-device',cancellationRequested:false,canCancel:false,codingTask:false}),review:async()=>({runId:'example',resource:{artifact_id:'retained-report',digest:'a'.repeat(64)},text:'## Agent support\n**Codex:** task execution is verified.\n- Native history import remains unverified.\n- Keep the exact result available for review.\n<script>untrusted content remains text</script>'})}
document.body.style.overflow='auto'
document.body.dataset.theme='light'
createRoot(document.getElementById('root')!).render(<div style={{containerType:'inline-size',width:new URLSearchParams(location.search).has('narrow')?360:1100,maxWidth:'100%',margin:'24px auto'}}><MemoryRouter><AuthoritativeRunSurface authority={authority} runId="example" projectId="demo"/></MemoryRouter></div>)
