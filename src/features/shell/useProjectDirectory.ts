import {useEffect,useState} from 'react'
import {useStore} from '../../data/store'
import type {DirectoryProject,ProjectDirectoryClient} from '../../services/projectDirectory'

export function useProjectDirectory(refreshKey='') {
  const {data,services}=useStore()
  const client=services?.projectDirectory,identity=client?.identity()
  const [snapshot,setSnapshot]=useState<{client:ProjectDirectoryClient;identity:string;projects:DirectoryProject[]}>()
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true;setSnapshot(undefined);setError('')
    if(client && identity!==undefined)client.list().then(projects=>{if(active)setSnapshot({client,identity,projects})}).catch(()=>{if(active)setError('Project list unavailable')})
    return()=>{active=false}
  },[client,identity,refreshKey])
  const projects=client ? (snapshot?.client===client && snapshot.identity===identity?snapshot.projects:[]) : data.projects
  return {projects:projects.map(project=>({id:project.id,name:data.projects.find(local=>local.id===project.id)?.name??project.name})),error,loading:Boolean(client && !snapshot && !error)}
}
