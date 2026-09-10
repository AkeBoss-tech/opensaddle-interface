import { useProjectDirectory } from '../shell/useProjectDirectory'
import { Link } from 'react-router-dom'
import { Laptop } from 'lucide-react'
import { useStore } from '../../data/store'
import { DeviceInventory } from './DeviceInventory'
import './devices.css'

export function PersonalDevicesPage() {
  const { services } = useStore()
  const {projects,error}=useProjectDirectory()
  return <section className="devices-page"><header><span>Your workspace</span><h1>Devices</h1><p>Your devices belong to you. Project access is configured separately.</p></header>
    {error && <p role="alert">{error}</p>}
    {services?.personalDevices ? <DeviceInventory authority={services.personalDevices} identity={services.personalDevices.identity()} projects={projects} /> : <div className="devices-empty"><Laptop/><h2>Device management is unavailable</h2><p>Connect to an OpenSaddle server that supports personal devices.</p><Link to="/settings">Connection settings</Link></div>}
  </section>
}
