import {useParams,Link} from 'react-router-dom'
import {useStore} from '../../data/store'
import {ScopedWorkspace} from '../../perspectives/scoped/ScopedWorkspace'
export function TeamWorkspacePage(){const {teamId}=useParams(),{services}=useStore();return <ScopedWorkspace client={services?.malleableShell?.scopedRenderers} teamId={teamId}><div className="content-page connected-local-page"><h1>Team workspace</h1><p>Choose this Team’s view and manage its settings from Teams.</p><Link to="/teams">Open Teams</Link></div></ScopedWorkspace>}
