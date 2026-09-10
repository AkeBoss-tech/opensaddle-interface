import {useEffect,useState} from 'react'
import { useProjectDirectory } from '../shell/useProjectDirectory'
import { Link } from 'react-router-dom'
import { Laptop } from 'lucide-react'
import { useStore } from '../../data/store'
import { DeviceInventory } from './DeviceInventory'
import './devices.css'

export function PersonalDevicesPage() {
  const { services } = useStore()
  const {projects,error}=useProjectDirectory()
  const [teams,setTeams]=useState<{id:string;name:string}[]>([])
  useEffect(()=>{let live=true;setTeams([]);services?.teams?.list().then(items=>{if(live)setTeams(items.map(team=>({id:team.team_id,name:team.display_name})))}).catch(()=>{});return()=>{live=false}},[services,services?.teams?.identity()])
  return <section className="devices-page"><header><span>Your workspace</span><h1>Devices</h1><p>Your devices belong to you. Project access is configured separately.</p></header>
    {error && <p role="alert">{error}</p>}
    {services?.personalDevices ? <DeviceInventory authority={services.personalDevices} identity={services.personalDevices.identity()} projects={projects} teams={teams} /> : <div className="devices-empty"><Laptop/><h2>Device management is unavailable</h2><p>Connect to an OpenSaddle server that supports personal devices.</p><Link to="/settings">Connection settings</Link></div>}
  </section>
}
