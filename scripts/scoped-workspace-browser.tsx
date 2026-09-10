import '../src/perspectives/scoped/scoped-workspace.css'
/** Manual browser proof harness. Serve through a loopback Vite proxy that injects
 * the disposable fixture credential server-side. Never use a personal runtime. */
import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {ScopedRendererClient} from '../src/services/scopedRenderers'
import {ScopedWorkspace} from '../src/perspectives/scoped/ScopedWorkspace'
import {ScopedViewCatalog} from '../src/features/settings/ScopedViewCatalog'
const teamId=new URLSearchParams(location.search).get('team')??undefined
const client=new ScopedRendererClient(location.origin,()=> 'owner')
createRoot(document.getElementById('root')!).render(<MemoryRouter><main><h1>Scoped workspace browser verification</h1><ScopedWorkspace client={client} teamId={teamId}><p>Default workspace content</p></ScopedWorkspace><ScopedViewCatalog client={client} teamId={teamId}/></main></MemoryRouter>)
