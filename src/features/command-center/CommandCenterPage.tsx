import { useStore } from '../../data/store'
import { CommandCenterSurface } from './CommandCenterSurface'
import './command-center.css'

const EMPTY_IDENTITY={}
export { CommandCenterSurface } from './CommandCenterSurface'
export function CommandCenterPage(){const{data,services}=useStore();const identity=services??EMPTY_IDENTITY;return <CommandCenterSurface key={data.currentUserId} client={services?.commandCenter} managerConversations={services?.managerConversations} managerContext={services?.managerContext} projectDirectory={services?.projectDirectory} dashboardSettings={services?.dashboardSettings} dashboardIdentity={services?.dashboardSettings?.identity()} connected={Boolean(services?.controlPlane.connected)} identity={identity} projects={data.projects}/>}
