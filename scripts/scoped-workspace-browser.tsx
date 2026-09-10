import '../src/styles/app.css'
import '../src/styles/thread-first.css'
import '../src/styles/liquid-glass.css'
import '../src/styles/scaffold.css'
import {TeamWorkspaceOverview} from '../src/features/teams/TeamWorkspaceOverview'
import {TeamsClient} from '../src/services/teams'
import {ProjectDirectoryClient} from '../src/services/projectDirectory'
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
createRoot(document.getElementById('root')!).render(<MemoryRouter><main><h1>Scoped workspace browser verification</h1><ScopedWorkspace client={client} teamId={teamId}>{teamId?<TeamWorkspaceOverview teamId={teamId} client={new TeamsClient(location.origin,()=> 'owner',undefined,true)} directory={new ProjectDirectoryClient(location.origin,()=> 'owner')}/>:<p>Default workspace content</p>}</ScopedWorkspace><ScopedViewCatalog client={client} teamId={teamId}/></main></MemoryRouter>)
