import React,{useEffect,useState} from 'react'
import {PersonalDevicesClient,type DeviceActivity as Activity} from '../../services/personalDevices'
void React
export function DeviceActivity({authority,deviceId,projects=[]}:{authority:PersonalDevicesClient;deviceId:string;projects?:{id:string;name:string}[]}){
 const identity=authority.identity()
 const [clock,setClock]=useState(0)
 const [open,setOpen]=useState(false),[refresh,setRefresh]=useState(0)
 const [loaded,setLoaded]=useState<{authority:PersonalDevicesClient;identity:string;deviceId:string;value:Activity}>(),[error,setError]=useState('')
 const current=loaded?.authority===authority&&loaded.identity===identity&&loaded.deviceId===deviceId?loaded.value:undefined
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>|undefined;setLoaded(undefined);setError('')
  if(!open)return
  async function read(){try{const value=await authority.activity(deviceId);if(live){setError('');setLoaded({authority,identity,deviceId,value})}}catch{if(live){setLoaded(undefined);setError('Device activity is unavailable. Check your connection and access.')}}finally{if(live)timer=setTimeout(()=>void read(),5000)}}
  void read();return()=>{live=false;clearTimeout(timer)}
 },[authority,identity,deviceId,open,refresh])
 // Expiration must update even when the next network response is stalled.
 useEffect(()=>{if(!open||!current)return;const deadline=setTimeout(()=>{setLoaded(undefined);setError('Device activity is stale. Waiting for a fresh observation.')},15000);return()=>clearTimeout(deadline)},[open,current])
 useEffect(()=>{if(!open||!current)return;const now=Date.now(),next=Math.min(...current.readiness.filter(report=>report.current).map(report=>Date.parse(report.expires_at)).filter(time=>time>now));if(!Number.isFinite(next))return;const timer=setTimeout(()=>setClock(Date.now()),Math.min(next-now,2147483647));return()=>clearTimeout(timer)},[open,current,clock])
 const name=(id:string)=>projects.find(project=>project.id===id)?.name??id
 return <section className="device-activity"><button aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Hide activity':'Show activity'}</button>{open&&<><button onClick={()=>setRefresh(value=>value+1)}>Refresh activity</button>{error&&<p role="alert">{error}</p>}{!current&&!error&&<p role="status">Loading device activity…</p>}{current&&<><p>Observed {new Date(current.generatedAt).toLocaleTimeString()}. Only projects you can currently access are shown.</p><h4>Agent reports</h4>{!current.readiness.length&&<p>No agent reports available.</p>}{current.readiness.map(report=><p key={JSON.stringify([report.worker_id,report.project_id,report.adapter_id])}>{report.adapter_id} · {name(report.project_id)} · {!report.current||Date.parse(report.expires_at)<=Date.now()?'Report unavailable or expired':report.reported_ready?'Agent reports ready':'Agent reports not ready'}</p>)}<p>Agent readiness does not grant permission to run tasks.</p><h4>Active tasks reported by Core</h4>{!current.activeRuns.length&&<p>No active tasks reported in your accessible projects.</p>}{current.activeRuns.map(run=><p key={run.run_id}><a href={`/project/${encodeURIComponent(run.project_id)}/tasks/${encodeURIComponent(run.run_id)}`}>{name(run.project_id)} · {run.run_id}</a> · {run.status}</p>)}<p>Task status does not confirm whether native processes have stopped.</p></>}</>}</section>
}
