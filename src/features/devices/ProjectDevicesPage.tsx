import { useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import { ProjectDeviceAccess } from './ProjectDeviceAccess'
import './devices.css'

export function ProjectDevicesPage() {
  const {projectId}=useParams()
  const {services,data}=useStore()
  const authority=services?.personalDevices
  return <section className="devices-page"><header><span>{data.projects.find(project=>project.id===projectId)?.name ?? projectId} · Project settings</span><h1>Devices</h1><p>Review the task-use policies offered by device owners for this project.</p></header>{projectId && authority?.assignmentsAvailable ? <ProjectDeviceAccess key={projectId+authority.identity()} authority={authority} projectId={projectId}/> : <p>Connect to a server that supports project device access.</p>}</section>
}
