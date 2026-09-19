import {useParams,Link} from 'react-router-dom'
import {useStore} from '../../data/store'
import {ScopedWorkspace} from '../../perspectives/scoped/ScopedWorkspace'
import {TeamWorkspaceOverview} from './TeamWorkspaceOverview'
import {PresentationEditor} from '../settings/PresentationEditor'
import {ScopedViewCatalog} from '../settings/ScopedViewCatalog'
import {StandalonePluginSettings} from '../settings/StandalonePluginSettings'
export function TeamWorkspacePage({settings=false}:{settings?:boolean}){
 const {teamId}=useParams(),{services}=useStore()
 if(!teamId||!services?.teams)return <div className="content-page"><h1>Team workspace</h1><p>Team access is unavailable on this connection.</p></div>
 if(settings)return <div className="content-page connected-local-page"><header className="page-header"><h1>Team settings</h1><Link to={`/teams/${encodeURIComponent(teamId)}`}>Back to Team workspace</Link></header>
  {services.presentationSettings&&<PresentationEditor key={teamId} client={services.presentationSettings} scope="team" projectId={teamId}/>}
  {services.malleableShell?.scopedRenderers&&<ScopedViewCatalog key={teamId} client={services.malleableShell.scopedRenderers} teamId={teamId}/>}
  {services.standalonePluginSettings&&<StandalonePluginSettings key={teamId} client={services.standalonePluginSettings} teamId={teamId}/>}
 </div>
 return <ScopedWorkspace client={services.malleableShell?.scopedRenderers} teamId={teamId}><TeamWorkspaceOverview teamId={teamId} client={services.teams} directory={services.projectDirectory}/></ScopedWorkspace>
}
