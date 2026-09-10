import { Link } from 'react-router-dom'
import { Laptop } from 'lucide-react'
import { useStore } from '../../data/store'
import { DeviceInventory } from './DeviceInventory'
import './devices.css'

export function PersonalDevicesPage() {
  const { services } = useStore()
  return <section className="devices-page"><header><span>Your workspace</span><h1>Devices</h1><p>Your devices belong to you. Project access is configured separately.</p></header>
    {services?.personalDevices ? <DeviceInventory authority={services.personalDevices} identity={services.personalDevices.identity()} /> : <div className="devices-empty"><Laptop/><h2>Device management is unavailable</h2><p>Connect to an OpenSaddle server that supports personal devices.</p><Link to="/settings">Connection settings</Link></div>}
  </section>
}
