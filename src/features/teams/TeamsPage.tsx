import {useStore} from '../../data/store'
import {TeamsPanel} from './TeamsPanel'
export function TeamsPage(){const {services}=useStore();return <div className="content-page connected-local-page"><header className="page-header"><h1>Teams</h1><p>Membership, shared settings and collaboration.</p></header>{services?.teams?<TeamsPanel views={services.malleableShell?.scopedRenderers} pluginSettings={services.standalonePluginSettings} key={services.teams.identity()} client={services.teams} presentation={services.presentationSettings}/>:<p>Team management is unavailable on this server.</p>}</div>}
